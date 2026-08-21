const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { generateCaptionMask } = require("./caption-mask-engine.cjs");
const { classifyFrames, normalizeAiSettings } = require("./ai-classifier.cjs");
const {
  CLASSIFICATIONS,
  MINIMUM_CLIP_SECONDS,
  classifySegment,
  detectScenes,
  exportSegment,
  generateAnalysisFrames,
  generateThumbnail,
  probeVideo
} = require("./video-engine.cjs");

function sanitizeFileSegment(value, fallback = "未命名") {
  const cleaned = String(value || "")
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/[. ]+$/g, "")
    .trim();
  return (cleaned || fallback).slice(0, 80);
}

function dateStamp(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function uniqueDirectory(basePath) {
  if (!(await pathExists(basePath))) return basePath;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${basePath}_${String(index).padStart(2, "0")}`;
    if (!(await pathExists(candidate))) return candidate;
  }
  throw new Error("无法创建唯一批次目录，请整理同名批次后重试");
}

async function uniqueFile(targetPath) {
  if (!(await pathExists(targetPath))) return targetPath;
  const extension = path.extname(targetPath);
  const base = targetPath.slice(0, -extension.length);
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base}_${index}${extension}`;
    if (!(await pathExists(candidate))) return candidate;
  }
  throw new Error("无法生成唯一文件名");
}

function serializeMaterial(material) {
  return {
    ...material,
    image: material.thumbnailPath ? pathToFileURL(material.thumbnailPath).href : "",
    videoUrl: material.filePath ? pathToFileURL(material.filePath).href : ""
  };
}

async function loadManifest(manifestPath) {
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  return { ...manifest, materials: (manifest.materials || []).map(serializeMaterial) };
}

async function saveManifest(manifest) {
  const manifestPath = path.join(manifest.batchDir, "manifest.json");
  const temporaryPath = `${manifestPath}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await fs.rename(temporaryPath, manifestPath);
  return manifestPath;
}

async function createBatchFolders(batchDir) {
  const folders = [
    "00_原视频",
    ...CLASSIFICATIONS.map((classification) => classification.folder),
    "99_不可用",
    ".thumbnails",
    "成片",
    "质检报告"
  ];
  await Promise.all(folders.map((folder) => fs.mkdir(path.join(batchDir, folder), { recursive: true })));
}

async function classifyMaterialSegment({ sourcePath, sourceInfo, segment, segmentIndex, segmentCount, batchDir, runtime, signal }) {
  const settings = normalizeAiSettings(runtime?.settings || {});
  const analysisDirectory = path.join(batchDir, ".analysis", `source-${runtime?.sourceIndex || 0}-segment-${segmentIndex + 1}`);
  try {
    if (!settings.enabled) {
      const error = new Error("视觉大模型分类未启用");
      error.code = "AI_DISABLED";
      throw error;
    }
    if (!runtime?.apiKey) {
      const error = new Error("尚未配置千问 API Key，请先到“设置 > 大模型”完成配置");
      error.code = "AI_KEY_REQUIRED";
      throw error;
    }
    const framePaths = await generateAnalysisFrames(sourcePath, analysisDirectory, segment, settings.framesPerClip, { signal });
    const aiResult = await classifyFrames({
      framePaths,
      duration: segment.duration,
      sourceName: sourceInfo.fileName,
      settings,
      apiKey: runtime.apiKey,
      signal
    });
    const classification = CLASSIFICATIONS.find((item) => item.type === aiResult.type) || CLASSIFICATIONS.find((item) => item.type === "other");
    return { ...classification, ...aiResult };
  } catch (error) {
    if (!settings.allowOfflineFallback) throw error;
    const fallback = classifySegment(segment, segmentIndex, segmentCount);
    return {
      ...fallback,
      confidence: 0.25,
      title: `${fallback.label}（离线兜底）`,
      tags: ["离线兜底"],
      reason: `视觉模型不可用，已按用户允许的离线规则临时分配：${error.message}`,
      detected: {},
      needsReview: true,
      provider: "offline",
      model: "heuristic-v1",
      mode: "offline_fallback",
      frameCount: 0,
      fallbackErrorCode: error.code || "AI_CLASSIFICATION_FAILED"
    };
  } finally {
    await fs.rm(analysisDirectory, { recursive: true, force: true }).catch(() => {});
  }
}

async function processBatch(payload, options = {}) {
  const sku = sanitizeFileSegment(payload.sku, "未填写款号");
  const batchName = sanitizeFileSegment(payload.batchName, "未命名批次");
  const rootDir = path.resolve(payload.rootDir);
  const sourcePaths = [...new Set((payload.sourcePaths || []).map((item) => path.resolve(item)))];
  if (!sourcePaths.length) throw Object.assign(new Error("至少需要一个原视频"), { code: "NO_SOURCE_FILES" });
  if (!Number.isFinite(Number(payload.minimumClipSeconds)) || Number(payload.minimumClipSeconds) < MINIMUM_CLIP_SECONDS) {
    throw Object.assign(new Error("片段时长下限不能低于 2 秒"), { code: "MINIMUM_DURATION_LOCKED" });
  }
  const aiSettings = normalizeAiSettings(options.classificationRuntime?.settings || {});
  if (aiSettings.enabled && !options.classificationRuntime?.apiKey && !aiSettings.allowOfflineFallback) {
    const error = new Error("尚未配置千问 API Key，请先到“设置 > 大模型”完成配置后再开始分类");
    error.code = "AI_KEY_REQUIRED";
    throw error;
  }
  await fs.mkdir(rootDir, { recursive: true });
  const skuDir = path.join(rootDir, sku);
  await fs.mkdir(skuDir, { recursive: true });
  const batchDir = await uniqueDirectory(path.join(skuDir, `${dateStamp()}_${batchName}`));
  await createBatchFolders(batchDir);

  const manifest = {
    schemaVersion: 1,
    appVersion: options.appVersion || "0.1.0",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "processing",
    processingMode: options.classificationRuntime?.apiKey ? "qwen_vision" : "offline_fallback",
    taskId: payload.taskId || null,
    sku,
    batchName,
    rootDir,
    batchDir,
    minimumClipSeconds: MINIMUM_CLIP_SECONDS,
    outputSpec: { width: 1080, height: 1920, aspectRatio: "9:16", fps: 30, videoCodec: "H.264", audioCodec: "AAC", sampleRate: 48000 },
    classification: {
      provider: options.classificationRuntime?.apiKey ? "qwen" : "offline",
      model: options.classificationRuntime?.apiKey ? aiSettings.model : "heuristic-v1",
      region: aiSettings.region,
      framesPerClip: aiSettings.framesPerClip,
      confidenceThreshold: aiSettings.confidenceThreshold,
      allowOfflineFallback: aiSettings.allowOfflineFallback
    },
    captionTreatment: {
      mode: payload.captionMode || "crop_reframe",
      label: (payload.captionMode || "smart_mask") === "smart_mask" ? "多帧字幕像素遮罩修复" : (payload.captionMode || "smart_mask") === "crop_reframe" ? "顶部字幕安全区重构裁切" : "字幕区内容感知柔化（本地兜底）",
      note: "原文件不修改；装饰字、移动贴纸或复杂背景需要在分类校对页人工复核。"
    },
    audioPolicy: {
      sourceAudioMuted: true,
      mixSourceVolume: 0,
      note: "归档原视频保持不变；分类片段使用静音轨，混剪仅输出配音与音乐。"
    },
    sources: [],
    materials: [],
    warnings: []
  };
  const manifestPath = await saveManifest(manifest);
  const totalSources = sourcePaths.length;

  try {
    for (let sourceIndex = 0; sourceIndex < sourcePaths.length; sourceIndex += 1) {
      const sourcePath = sourcePaths[sourceIndex];
      options.onProgress?.({ stage: "probe", progress: sourceIndex / totalSources, message: `读取视频 ${sourceIndex + 1}/${totalSources}：${path.basename(sourcePath)}` });
      const sourceInfo = await probeVideo(sourcePath);
      const sourceCaptionMode = payload.captionModeBySource?.[sourceIndex] || payload.captionMode || "smart_mask";
      if (sourceInfo.duration < MINIMUM_CLIP_SECONDS) {
        manifest.warnings.push(`${sourceInfo.fileName} 只有 ${sourceInfo.duration.toFixed(2)} 秒，已放入不可用目录`);
        const unusableTarget = await uniqueFile(path.join(batchDir, "99_不可用", sanitizeFileSegment(sourceInfo.fileName)));
        await fs.copyFile(sourcePath, unusableTarget);
        manifest.sources.push({ ...sourceInfo, originalPath: sourcePath, archivedPath: unusableTarget, status: "unusable_too_short" });
        await saveManifest(manifest);
        continue;
      }

      let archivedPath = sourcePath;
      if (payload.keepOriginals !== false) {
        const safeOriginalName = sanitizeFileSegment(path.basename(sourcePath));
        archivedPath = await uniqueFile(path.join(batchDir, "00_原视频", safeOriginalName));
        await fs.copyFile(sourcePath, archivedPath);
      }
      options.onProgress?.({ stage: "detect", progress: (sourceIndex + 0.08) / totalSources, message: `检测镜头变化：${sourceInfo.fileName}` });
      const segments = await detectScenes(sourcePath, sourceInfo.duration, {
        signal: options.signal,
        minimumSeconds: MINIMUM_CLIP_SECONDS,
        maximumSeconds: Number(payload.maximumClipSeconds || 9),
        threshold: Number(payload.sceneThreshold || 0.32)
      });
      if (segments.some((segment) => segment.duration < MINIMUM_CLIP_SECONDS - 0.001)) {
        throw new Error("内部校验失败：检测到低于 2 秒的片段");
      }
      const sourceRecord = { ...sourceInfo, originalPath: sourcePath, archivedPath, status: "processed", segmentCount: segments.length, segmentIds: [] };
      manifest.sources.push(sourceRecord);
      let captionMaskPath = null;
      if (sourceCaptionMode === "smart_mask") {
        options.onProgress?.({ stage: "caption-mask", progress: (sourceIndex + 0.12) / totalSources, message: `提取多帧字幕遮罩：${sourceInfo.fileName}` });
        captionMaskPath = path.join(batchDir, ".thumbnails", `.caption-mask-${sourceIndex + 1}.pgm`);
        const maskResult = await generateCaptionMask(sourcePath, sourceInfo, captionMaskPath, {
          zones: payload.captionZonesBySource?.[sourceIndex],
          samples: payload.captionSamples || [0.25, 0.5, 0.75],
          dilationRadius: 2,
          width: 540,
          height: 960
        });
        sourceRecord.captionMaskPath = captionMaskPath;
        sourceRecord.captionMaskedPixels = maskResult.maskedPixels;
      }
      sourceRecord.captionMode = sourceCaptionMode;

      for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
        const segment = segments[segmentIndex];
        options.onProgress?.({
          stage: "ai-classify",
          progress: (sourceIndex + (segmentIndex + 0.05) / segments.length) / totalSources,
          message: `千问正在识别片段 ${segmentIndex + 1}/${segments.length}：人物、服装、细节与测评意图`
        });
        const classification = await classifyMaterialSegment({
          sourcePath,
          sourceInfo,
          segment,
          segmentIndex,
          segmentCount: segments.length,
          batchDir,
          runtime: { ...options.classificationRuntime, sourceIndex },
          signal: options.signal
        });
        if (classification.mode === "offline_fallback") {
          manifest.warnings.push(`${sourceInfo.fileName} 第 ${segmentIndex + 1} 段未经过视觉模型：${classification.reason}`);
        }
        const sourceBase = sanitizeFileSegment(path.basename(sourcePath, path.extname(sourcePath))).slice(0, 42);
        const serial = String(segmentIndex + 1).padStart(3, "0");
        const fileName = `${sourceBase}_${serial}_${classification.label}_${segment.duration.toFixed(2)}s.mp4`;
        const outputPath = path.join(batchDir, classification.folder, fileName);
        const overall = (sourceIndex + (segmentIndex + 0.1) / segments.length) / totalSources;
        options.onProgress?.({
          stage: "export",
          progress: overall,
          message: `生成 ${sourceIndex + 1}/${totalSources} · 片段 ${segmentIndex + 1}/${segments.length} · ${classification.label}`
        });
        const outputInfo = await exportSegment(sourcePath, outputPath, segment, sourceInfo, {
          captionMode: sourceCaptionMode,
          captionMaskPath,
          signal: options.signal,
          onProgress: (clipProgress) => options.onProgress?.({
            stage: "export",
            progress: (sourceIndex + (segmentIndex + clipProgress) / segments.length) / totalSources,
            message: `处理片段 ${segmentIndex + 1}/${segments.length}：${classification.label}`
          })
        });
        const id = `material-${Date.now()}-${sourceIndex}-${segmentIndex}`;
        const thumbnailPath = path.join(batchDir, ".thumbnails", `${id}.jpg`);
        await generateThumbnail(outputPath, thumbnailPath, Math.min(1, segment.duration / 2));
        const material = {
          id,
          name: `${classification.label} ${serial}`,
          type: classification.type,
          typeLabel: classification.label,
          categoryFolder: classification.folder,
          sku,
          batch: batchName,
          duration: outputInfo.duration,
          width: outputInfo.width,
          height: outputInfo.height,
          fps: 30,
          filePath: outputPath,
          thumbnailPath,
          sourcePath,
          sourceStart: segment.start,
          sourceEnd: segment.end,
          sourceAudioMuted: true,
          audioMode: "silent_track",
          captionStatus: payload.captionMode === "keep" ? "kept" : "treated_needs_review",
          classificationMode: classification.mode,
          classificationProvider: classification.provider,
          classificationModel: classification.model,
          classificationConfidence: classification.confidence,
          classificationReason: classification.reason,
          classificationTags: classification.tags,
          classificationDetected: classification.detected,
          classificationFrameCount: classification.frameCount,
          classificationNeedsReview: classification.needsReview,
          classificationTitle: classification.title,
          uses: 0
        };
        manifest.materials.push(material);
        sourceRecord.segmentIds.push(id);
        await saveManifest(manifest);
      }
    }
    manifest.status = "ready_for_review";
    manifest.updatedAt = new Date().toISOString();
    manifest.summary = {
      sourceCount: manifest.sources.length,
      materialCount: manifest.materials.length,
      unusableCount: manifest.sources.filter((source) => source.status.startsWith("unusable")).length,
      minimumDuration: manifest.materials.length ? Math.min(...manifest.materials.map((material) => material.duration)) : 0,
      aiClassifiedCount: manifest.materials.filter((material) => material.classificationMode === "qwen_vision").length,
      fallbackCount: manifest.materials.filter((material) => material.classificationMode === "offline_fallback").length,
      lowConfidenceCount: manifest.materials.filter((material) => material.classificationNeedsReview).length,
      categories: Object.fromEntries(CLASSIFICATIONS.map((classification) => [classification.label, manifest.materials.filter((material) => material.type === classification.type).length]))
    };
    await saveManifest(manifest);
    options.onProgress?.({ stage: "done", progress: 1, message: `处理完成：${manifest.materials.length} 个合格片段` });
    return { ...manifest, manifestPath, materials: manifest.materials.map(serializeMaterial) };
  } catch (error) {
    manifest.status = options.signal?.aborted ? "cancelled" : "failed";
    manifest.updatedAt = new Date().toISOString();
    manifest.error = { message: error.message, code: error.code || "PROCESS_FAILED" };
    await saveManifest(manifest);
    throw Object.assign(error, { batchDir, manifestPath });
  }
}

async function findManifests(rootDir) {
  const results = [];
  async function walk(directory, depth) {
    if (depth > 3) return;
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isFile() && entry.name === "manifest.json") results.push(entryPath);
      else if (entry.isDirectory() && !entry.name.startsWith(".")) await walk(entryPath, depth + 1);
    }
  }
  await walk(rootDir, 0);
  const manifests = [];
  for (const manifestPath of results) {
    try {
      const manifest = await loadManifest(manifestPath);
      manifests.push({ ...manifest, manifestPath });
    } catch {
      // A damaged manifest should not prevent other batches from loading.
    }
  }
  return manifests.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

async function listSkuOptions(rootDir) {
  const resolvedRoot = path.resolve(rootDir);
  let entries = [];
  try {
    entries = await fs.readdir(resolvedRoot, { withFileTypes: true });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const batches = await findManifests(resolvedRoot);
  const grouped = new Map();
  for (const entry of entries) {
    if (entry.isDirectory() && !entry.name.startsWith(".")) {
      grouped.set(entry.name, { sku: entry.name, batchCount: 0, materialCount: 0, lastUpdatedAt: null });
    }
  }
  for (const batch of batches) {
    const sku = String(batch.sku || path.basename(path.dirname(batch.batchDir || batch.manifestPath || "")) || "未分款");
    const option = grouped.get(sku) || { sku, batchCount: 0, materialCount: 0, lastUpdatedAt: null };
    option.batchCount += 1;
    option.materialCount += Number(batch.summary?.materialCount || batch.materials?.length || 0);
    if (!option.lastUpdatedAt || String(batch.updatedAt) > String(option.lastUpdatedAt)) option.lastUpdatedAt = batch.updatedAt || null;
    grouped.set(sku, option);
  }
  return [...grouped.values()].sort((a, b) => String(b.lastUpdatedAt || "").localeCompare(String(a.lastUpdatedAt || "")) || a.sku.localeCompare(b.sku, "zh-CN"));
}

module.exports = { findManifests, listSkuOptions, loadManifest, processBatch, sanitizeFileSegment, serializeMaterial };
