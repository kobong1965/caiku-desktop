const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { checkCoverage, checkText, RULE_VERSION } = require("./compliance-engine.cjs");
const { runFfmpeg, runProcess } = require("./process-runner.cjs");
const { probeVideo, generateThumbnail, MINIMUM_CLIP_SECONDS } = require("./video-engine.cjs");
const { sanitizeFileSegment } = require("./workspace-service.cjs");

function seededShuffle(items, seed) {
  const result = [...items];
  let state = (seed + 1) * 2654435761;
  for (let index = result.length - 1; index > 0; index -= 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const swapIndex = state % (index + 1);
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function scriptText(script) {
  return (script?.blocks || []).map((block) => block.subtitleText || block.voiceText || block.text || block.name || "").filter(Boolean).join("。") || script?.name || "";
}

function voiceScriptText(script) {
  if (script?.voiceMode === "music_only") return "";
  return (script?.blocks || [])
    .filter((block) => script?.voiceMode === "full_voice" || block.voiceEnabled !== false)
    .map((block) => block.voiceText || block.text || "")
    .filter(Boolean)
    .join("。") || script?.name || "";
}

function concatListLine(filePath) {
  return `file '${filePath.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`;
}

function createMixError(message, code, details = null) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  return error;
}

function buildPlannedTimeline(editingPlan, materials, variantIndex = 0) {
  if (!editingPlan || typeof editingPlan !== "object") throw createMixError("尚未生成 AI 剪辑计划", "AI_EDITOR_PLAN_REQUIRED");
  if (editingPlan.status === "blocked") throw createMixError("AI 剪辑计划存在阻断项，不能开始生成", "AI_EDITOR_PLAN_BLOCKED");
  if (editingPlan.confirmed !== true) throw createMixError("请先确认 AI 剪辑师的逐段安排", "AI_EDITOR_PLAN_UNCONFIRMED");
  const materialMap = new Map((materials || []).map((material) => [String(material.id), material]));
  const timeline = [];
  for (const decision of Array.isArray(editingPlan.decisions) ? editingPlan.decisions : []) {
    const candidates = (decision.selectedMaterialIds || []).map((id) => materialMap.get(String(id))).filter((material) => material?.filePath);
    const decisionTimeline = Array.isArray(decision.timeline) ? decision.timeline : [];
    for (let itemIndex = 0; itemIndex < decisionTimeline.length; itemIndex += 1) {
      const item = decisionTimeline[itemIndex];
      const requestedMaterialId = String(item?.materialId || "");
      let material = materialMap.get(requestedMaterialId);
      const requestedDuration = Number(item.duration || 0);
      if (variantIndex > 0 && candidates.length > 1) {
        const originalIndex = Math.max(0, candidates.findIndex((candidate) => String(candidate.id) === requestedMaterialId));
        const rotated = candidates[(originalIndex + variantIndex + itemIndex) % candidates.length];
        if (Number(rotated.duration || 0) >= requestedDuration) material = rotated;
      }
      const materialId = String(material?.id || requestedMaterialId);
      if (!material?.filePath) {
        throw createMixError(`剪辑计划引用了未勾选或不可用的素材：${requestedMaterialId || "空"}`, "AI_EDITOR_MATERIAL_NOT_SELECTED");
      }
      const duration = requestedDuration;
      const materialDuration = Number(material.duration || 0);
      const rawSourceStart = Number(item.sourceStart || 0);
      const sourceStart = materialId === requestedMaterialId ? rawSourceStart : Math.min(rawSourceStart, Math.max(0, materialDuration - duration));
      if (!Number.isFinite(sourceStart) || !Number.isFinite(duration) || sourceStart < 0 || duration <= 0.05 || sourceStart + duration > materialDuration + 0.001) {
        throw createMixError(`剪辑计划中的素材时间越界：${material.name || materialId}`, "AI_EDITOR_TIMELINE_OUT_OF_RANGE", {
          materialId,
          sourceStart,
          duration,
          materialDuration
        });
      }
      timeline.push({
        blockId: String(decision.blockId || ""),
        materialId,
        material,
        sourceStart: Number(sourceStart.toFixed(3)),
        duration: Number(duration.toFixed(3))
      });
    }
  }
  if (!timeline.length) throw createMixError("AI 剪辑计划没有可执行的镜头", "AI_EDITOR_TIMELINE_EMPTY");
  return timeline;
}

async function synthesizeWindowsVoice(text, outputPath) {
  if (process.platform !== "win32" || !text.trim()) return null;
  const encodedText = Buffer.from(text, "utf8").toString("base64");
  const encodedPath = Buffer.from(outputPath, "utf8").toString("base64");
  const command = [
    "Add-Type -AssemblyName System.Speech",
    `$t=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedText}'))`,
    `$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedPath}'))`,
    "$s=New-Object System.Speech.Synthesis.SpeechSynthesizer",
    "$v=$s.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -like 'zh-*' } | Select-Object -First 1",
    "if($v){$s.SelectVoice($v.VoiceInfo.Name)}",
    "$s.Rate=1",
    "$s.Volume=100",
    "$s.SetOutputToWaveFile($p)",
    "$s.Speak($t)",
    "$s.Dispose()"
  ].join(";");
  const encodedCommand = Buffer.from(command, "utf16le").toString("base64");
  await runProcess("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encodedCommand]);
  return outputPath;
}

async function buildConcatList(materials, targetDuration, variantIndex, tempDir) {
  const valid = materials.filter((material) => Number(material.duration) >= MINIMUM_CLIP_SECONDS && material.filePath);
  if (!valid.length) throw Object.assign(new Error("没有可用于混剪的合格素材"), { code: "NO_VALID_MATERIALS" });
  const chosen = [];
  let duration = 0;
  let round = 0;
  while (duration < targetDuration + 1 && round < 100) {
    const shuffled = seededShuffle(valid, variantIndex * 97 + round);
    for (const material of shuffled) {
      if (chosen.at(-1)?.id === material.id && shuffled.length > 1) continue;
      chosen.push(material);
      duration += Number(material.duration);
      if (duration >= targetDuration + 1) break;
    }
    round += 1;
  }
  const listPath = path.join(tempDir, `concat-${variantIndex + 1}.txt`);
  await fs.writeFile(listPath, `${chosen.map((material) => concatListLine(material.filePath)).join("\n")}\n`, "utf8");
  return { chosen, duration, listPath };
}

async function buildPlannedConcatList(materials, editingPlan, variantIndex, tempDir, options = {}) {
  const timeline = buildPlannedTimeline(editingPlan, materials, variantIndex);
  const chosen = [];
  const plannedFiles = [];
  let totalDuration = 0;
  for (let index = 0; index < timeline.length; index += 1) {
    const item = timeline[index];
    const clipPath = path.join(tempDir, `planned-${variantIndex + 1}-${String(index + 1).padStart(3, "0")}.mp4`);
    options.onProgress?.(index / timeline.length);
    await runFfmpeg([
      "-y",
      "-ss", item.sourceStart.toFixed(3),
      "-i", item.material.filePath,
      "-t", item.duration.toFixed(3),
      "-map", "0:v:0",
      "-map", "0:a:0?",
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "20",
      "-pix_fmt", "yuv420p",
      "-r", "30",
      "-c:a", "aac",
      "-b:a", "192k",
      "-ar", "48000",
      "-ac", "2",
      "-movflags", "+faststart",
      clipPath
    ], { signal: options.signal });
    plannedFiles.push(clipPath);
    chosen.push(item.material);
    totalDuration += item.duration;
  }
  const listPath = path.join(tempDir, `concat-planned-${variantIndex + 1}.txt`);
  await fs.writeFile(listPath, `${plannedFiles.map(concatListLine).join("\n")}\n`, "utf8");
  options.onProgress?.(1);
  return { chosen, duration: totalDuration, listPath, planned: true };
}

function buildAudioGraph({ hasVoice, hasMusic, musicOnly = false }) {
  const chains = ["[0:a:0]volume=0,aresample=48000[a0]"];
  const inputs = ["[a0]"];
  let inputIndex = 1;
  if (hasVoice) {
    chains.push(`[${inputIndex}:a:0]volume=1.0,aresample=48000[a_voice]`);
    inputs.push("[a_voice]");
    inputIndex += 1;
  }
  if (hasMusic) {
    chains.push(`[${inputIndex}:a:0]volume=0.10,aresample=48000[a_music]`);
    inputs.push("[a_music]");
  }
  chains.push(`${inputs.join("")}amix=inputs=${inputs.length}:duration=first:dropout_transition=2,loudnorm=I=-14:TP=-1.5:LRA=11[aout]`);
  return chains.join(";");
}

async function createVariant(payload, variantIndex, context) {
  const requestedDuration = Math.min(120, Math.max(6, Number(payload.script?.duration || 30)));
  const tempDir = path.join(context.outputDir, ".working");
  await fs.mkdir(tempDir, { recursive: true });
  const concat = payload.editingPlan
    ? await buildPlannedConcatList(payload.materials, payload.editingPlan, variantIndex, tempDir, {
      signal: context.signal,
      onProgress: (progress) => context.onProgress?.(progress * 0.55)
    })
    : await buildConcatList(payload.materials, requestedDuration, variantIndex, tempDir);
  const targetDuration = payload.editingPlan
    ? Math.min(120, Math.max(0.5, Number(concat.duration.toFixed(3))))
    : requestedDuration;
  const outputNumber = String(variantIndex + 1).padStart(2, "0");
  const projectName = sanitizeFileSegment(payload.projectName || payload.script?.name || "混剪成片");
  const outputPath = path.join(context.outputDir, `${projectName}_${outputNumber}_1080x1920.mp4`);
  const args = ["-y", "-f", "concat", "-safe", "0", "-i", concat.listPath];

  const musicOnly = payload.script?.voiceMode === "music_only";
  let voicePath = musicOnly ? null : payload.voicePath || context.syntheticVoicePath || null;
  let musicPath = payload.musicPath || null;
  try { if (voicePath) await fs.access(voicePath); } catch { voicePath = null; }
  try { if (musicPath) await fs.access(musicPath); } catch { musicPath = null; }
  if (voicePath) args.push("-stream_loop", "-1", "-i", voicePath);
  if (musicPath) args.push("-stream_loop", "-1", "-i", musicPath);
  args.push(
    "-filter_complex", buildAudioGraph({ hasVoice: Boolean(voicePath), hasMusic: Boolean(musicPath), musicOnly }),
    "-map", "0:v:0", "-map", "[aout]",
    "-t", targetDuration.toFixed(3),
    "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
    "-movflags", "+faststart", outputPath
  );
  let stderr = "";
  await runFfmpeg(args, {
    signal: context.signal,
    onStderr: (chunk) => {
      stderr += chunk;
      const matches = [...stderr.matchAll(/time=(\d+):(\d+):([\d.]+)/g)];
      const last = matches.at(-1);
      if (last) {
        const seconds = Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]);
        context.onProgress?.(Math.min(0.98, seconds / targetDuration));
      }
      if (stderr.length > 12000) stderr = stderr.slice(-6000);
    }
  });
  const info = await probeVideo(outputPath);
  const thumbnailPath = path.join(context.outputDir, `.thumb-${outputNumber}.jpg`);
  await generateThumbnail(outputPath, thumbnailPath, 1);
  const technicalPassed = info.width === 1080 && info.height === 1920 && info.hasAudio && info.videoCodec === "h264" && info.audioCodec === "aac" && info.sampleRate === 48000;
  const technical = {
    status: technicalPassed ? "pass" : "blocked",
    width: info.width,
    height: info.height,
    aspectRatio: "9:16",
    videoCodec: info.videoCodec,
    audioCodec: info.audioCodec,
    sampleRate: info.sampleRate,
    duration: info.duration,
    expected: "1080×1920 · 9:16 · H.264 · AAC 48 kHz"
  };
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: "offline_baseline",
    ruleVersion: RULE_VERSION,
    outputPath,
    script: context.scriptCheck,
    materialCoverage: context.coverage,
    technical,
    editingPlan: payload.editingPlan ? {
      id: payload.editingPlan.id,
      status: payload.editingPlan.status,
      confirmed: payload.editingPlan.confirmed === true,
      provider: payload.editingPlan.provider,
      model: payload.editingPlan.model,
      summary: payload.editingPlan.summary,
      generatedAt: payload.editingPlan.generatedAt,
      planPath: context.editingPlanPath,
      decisions: (payload.editingPlan.decisions || []).map((decision) => ({
        blockId: decision.blockId,
        blockName: decision.blockName,
        evidenceStatus: decision.evidenceStatus,
        selectedMaterialIds: decision.selectedMaterialIds,
        unsupportedClaims: decision.unsupportedClaims,
        rewriteRequired: decision.rewriteRequired
      }))
    } : null,
    voice: {
      status: musicOnly ? "not_required" : voicePath ? "generated_or_selected" : "not_selected",
      source: musicOnly ? "music_only" : payload.voicePath ? "user_file" : context.syntheticVoicePath ? "windows_offline_tts" : musicPath ? "music_without_voice" : "silent",
      sourceAudioMuted: true,
      note: musicOnly ? "脚本设置为纯音乐，已关闭独立口播和素材原声。" : "素材原声固定为 0；成片只保留已选配音和音乐。离线基础版核对音轨存在与导出时长。"
    },
    visualSemantic: {
      status: context.coverage.status,
      mode: "category_alignment",
      note: "离线基础版按脚本段落分类与素材标签检查；云端多模态模型可在后续版本逐帧复核。"
    },
    status: technical.status === "pass" && context.scriptCheck.status !== "blocked" ? (context.coverage.status === "pass" ? "pass" : "review") : "blocked",
    disclaimer: "质检报告是发布前辅助筛查；投放前仍需人工确认商品资质、价格、库存和抖音平台实时规则。"
  };
  const reportPath = path.join(context.reportDir, `${projectName}_${outputNumber}_质检.json`);
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return {
    id: `output-${Date.now()}-${variantIndex}`,
    name: `${projectName}_${outputNumber}`,
    filePath: outputPath,
    fileUrl: pathToFileURL(outputPath).href,
    image: pathToFileURL(thumbnailPath).href,
    thumbnailPath,
    reportPath,
    duration: info.duration,
    status: report.status,
    score: Math.max(0, Math.round((context.scriptCheck.score + (technical.status === "pass" ? 100 : 0) + (context.coverage.status === "pass" ? 100 : 75)) / 3)),
    report,
    materialIds: concat.chosen.map((material) => material.id)
  };
}

async function mixBatch(payload, options = {}) {
  const materials = (payload.materials || []).filter((material) => Number(material.duration) >= MINIMUM_CLIP_SECONDS);
  if (!materials.length) throw Object.assign(new Error("请至少选择一个不低于 2 秒的素材"), { code: "NO_VALID_MATERIALS" });
  if ((payload.materials || []).some((material) => Number(material.duration) < MINIMUM_CLIP_SECONDS)) {
    throw Object.assign(new Error("所选素材中包含低于 2 秒的片段，已阻止混剪"), { code: "MATERIAL_TOO_SHORT" });
  }
  const scriptCheck = checkText(scriptText(payload.script));
  if (scriptCheck.status === "blocked" && !payload.allowComplianceOverride) {
    throw Object.assign(new Error("脚本包含阻断级风险词，请修改后再生成"), { code: "COMPLIANCE_BLOCKED", report: scriptCheck });
  }
  const coverage = checkCoverage(payload.script, materials);
  if (payload.requireEditingPlan === true && !payload.editingPlan) {
    throw createMixError("请先让 AI 剪辑师安排镜头并确认计划", "AI_EDITOR_PLAN_REQUIRED");
  }
  if (payload.editingPlan) {
    if (payload.editingPlan.scriptId && String(payload.editingPlan.scriptId) !== String(payload.script?.id || "")) {
      throw createMixError("脚本已变化，请重新让 AI 剪辑师安排", "AI_EDITOR_PLAN_STALE");
    }
    if (Array.isArray(payload.editingPlan.inputMaterialIds)) {
      const plannedIds = [...payload.editingPlan.inputMaterialIds].map(String).sort();
      const currentIds = materials.map((material) => String(material.id)).sort();
      if (JSON.stringify(plannedIds) !== JSON.stringify(currentIds)) {
        throw createMixError("所选素材已变化，请重新让 AI 剪辑师安排", "AI_EDITOR_PLAN_STALE");
      }
    }
    buildPlannedTimeline(payload.editingPlan, materials);
  }
  const count = Math.min(20, Math.max(1, Number(payload.outputCount || 1)));
  const outputDir = path.join(payload.batchDir, "成片");
  const reportDir = path.join(payload.batchDir, "质检报告");
  await fs.mkdir(outputDir, { recursive: true });
  await fs.mkdir(reportDir, { recursive: true });

  let editingPlanPath = null;
  if (payload.editingPlan) {
    const planDir = path.join(payload.batchDir, "剪辑计划");
    await fs.mkdir(planDir, { recursive: true });
    const planName = sanitizeFileSegment(payload.editingPlan.id || `edit-plan-${Date.now()}`);
    editingPlanPath = path.join(planDir, `${planName}.json`);
    await fs.writeFile(editingPlanPath, `${JSON.stringify(payload.editingPlan, null, 2)}\n`, "utf8");
  }

  let syntheticVoicePath = null;
  if (payload.script?.voiceMode !== "music_only" && !payload.voicePath && payload.useOfflineVoice !== false) {
    syntheticVoicePath = path.join(outputDir, ".working", "offline-voice.wav");
    await fs.mkdir(path.dirname(syntheticVoicePath), { recursive: true });
    try {
      await synthesizeWindowsVoice(voiceScriptText(payload.script), syntheticVoicePath);
    } catch {
      syntheticVoicePath = null;
    }
  }
  const outputs = [];
  for (let index = 0; index < count; index += 1) {
    options.onProgress?.({ stage: "mix", progress: index / count, message: `正在生成成片 ${index + 1}/${count}` });
    const output = await createVariant({ ...payload, materials }, index, {
      outputDir,
      reportDir,
      scriptCheck,
      coverage,
      editingPlanPath,
      syntheticVoicePath,
      signal: options.signal,
      onProgress: (variantProgress) => options.onProgress?.({
        stage: "mix",
        progress: (index + variantProgress) / count,
        message: `混剪与规格校验 ${index + 1}/${count}`
      })
    });
    outputs.push(output);
  }
  options.onProgress?.({ stage: "done", progress: 1, message: `${outputs.length} 条成片与逐条质检报告已生成` });
  return { outputs, outputDir, reportDir, editingPlanPath, scriptCheck, coverage };
}

module.exports = { buildAudioGraph, buildConcatList, buildPlannedConcatList, buildPlannedTimeline, mixBatch, scriptText, seededShuffle, synthesizeWindowsVoice, voiceScriptText };
