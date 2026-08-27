const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { classifyFrames, classifyFramesWithOllama, normalizeAiSettings, normalizeSceneAnalysis } = require("./ai-classifier.cjs");
const { verifyCaptionRepair } = require("./caption-verification-service.cjs");
const { auditVideoCaptions, inspectCaptionRepairRuntime, manualZonesFromAudit, manualZonesFromRegions, planHighDifficultyCaptionRepair, repairCaptionRanges, timedRangeOverlapSeconds } = require("./caption-repair-service.cjs");
const { DECISIONS, STANDARD_VERSION, auditSlice, decideCaptionTreatment, finalMaterialDestination, gateFinalCaptionAudit, shouldAttemptCaptionSecondPass } = require("./fashion-video-standard-service.cjs");
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

const INTERNAL_TASKS_FOLDER = "_裁库任务";
const INTERNAL_ROOT_PREFIX = "_裁库";

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

function isInternalRootFolder(folderName) {
  return String(folderName || "").startsWith(INTERNAL_ROOT_PREFIX);
}

function assertUsableSku(sku) {
  if (!sku || isInternalRootFolder(sku) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(sku)) {
    throw Object.assign(new Error("该款号名称为软件保留名称，请更换款号"), { code: "SKU_RESERVED" });
  }
}

function planBatchStorage({ rootDir, sku, batchName, date = new Date(), taskTag = "" }) {
  const resolvedRoot = path.resolve(rootDir);
  const libraryDir = path.join(resolvedRoot, sku);
  const taskRoot = path.join(resolvedRoot, INTERNAL_TASKS_FOLDER, sku);
  const taskSuffix = taskTag ? `_${sanitizeFileSegment(taskTag, "task").slice(-12)}` : "";
  return {
    libraryDir,
    taskRoot,
    batchBaseDir: path.join(taskRoot, `${dateStamp(date)}_${batchName}${taskSuffix}`)
  };
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
  const batchDir = path.resolve(manifest.batchDir || path.dirname(manifestPath));
  const sku = String(manifest.sku || "").trim();
  const libraryDir = manifest.libraryDir
    ? path.resolve(manifest.libraryDir)
    : manifest.rootDir && sku && path.basename(sku) === sku
      ? path.join(path.resolve(manifest.rootDir), sku)
      : path.dirname(batchDir);
  return { ...manifest, batchDir, libraryDir, materials: (manifest.materials || []).map(serializeMaterial) };
}

async function saveManifest(manifest) {
  const manifestPath = path.join(manifest.batchDir, "manifest.json");
  const temporaryPath = `${manifestPath}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await fs.rename(temporaryPath, manifestPath);
  return manifestPath;
}

async function createBatchWorkFolders(batchDir) {
  const folders = [
    "00_原视频",
    "98_低复用待复核",
    "99_不可用",
    ".staging",
    ".thumbnails",
    "成片",
    "质检报告"
  ];
  await Promise.all(folders.map((folder) => fs.mkdir(path.join(batchDir, folder), { recursive: true })));
}

async function createSkuLibraryFolders(skuDir) {
  await Promise.all(CLASSIFICATIONS.map((classification) => fs.mkdir(path.join(skuDir, classification.folder), { recursive: true })));
}

function isLibraryCategoryFolder(folder) {
  return CLASSIFICATIONS.some((classification) => classification.folder === folder);
}

function destinationPath({ libraryDir, batchDir, folder, fileName }) {
  const baseDir = isLibraryCategoryFolder(folder) ? libraryDir : batchDir;
  return path.join(baseDir, folder, fileName);
}

async function classifyMaterialSegment({ sourcePath, sourceInfo, segment, segmentIndex, segmentCount, batchDir, runtime, signal }) {
  const settings = normalizeAiSettings(runtime?.settings || {});
  const route = runtime?.route || {
    mode: runtime?.apiKey ? "cloud_accuracy" : "legacy",
    primary: { provider: "qwen", model: settings.model },
    fallback: null,
    settings: {}
  };
  const analysisDirectory = path.join(batchDir, ".analysis", `source-${runtime?.sourceIndex || 0}-segment-${segmentIndex + 1}`);
  try {
    if (!settings.enabled) {
      const error = new Error("视觉大模型分类未启用");
      error.code = "AI_DISABLED";
      throw error;
    }
    if (route.primary.provider === "qwen" && !runtime?.apiKey) {
      const error = new Error("尚未配置千问 API Key，请先到“设置 > 大模型”完成配置");
      error.code = "AI_KEY_REQUIRED";
      throw error;
    }
    const framePaths = await generateAnalysisFrames(sourcePath, analysisDirectory, segment, settings.framesPerClip, { signal });
    const runStep = async (step) => {
      if (step.provider === "ollama") {
        return classifyFramesWithOllama({
          framePaths,
          duration: segment.duration,
          sourceName: sourceInfo.fileName,
          settings,
          productProfile: runtime.productProfile,
          localSettings: {
            endpoint: route.settings?.localEndpoint,
            model: step.model,
            timeoutMs: 180000,
            contextLength: 32768,
            maxOutputTokens: 1200
          },
          signal
        });
      }
      return classifyFrames({
        framePaths,
        duration: segment.duration,
        sourceName: sourceInfo.fileName,
        settings: { ...settings, model: step.model },
        apiKey: runtime.apiKey,
        productProfile: runtime.productProfile,
        signal
      });
    };
    let aiResult;
    try {
      aiResult = await runStep(route.primary);
    } catch (primaryError) {
      if (!route.fallback) throw primaryError;
      try {
        aiResult = await runStep(route.fallback);
      } catch (fallbackError) {
        fallbackError.details = {
          ...(fallbackError.details || {}),
          primary: { code: primaryError.code || "AI_PRIMARY_FAILED", message: primaryError.message },
          fallback: { code: fallbackError.code || "AI_FALLBACK_FAILED", message: fallbackError.message }
        };
        fallbackError.message = `云端分类失败：${primaryError.message}；本地兜底也失败：${fallbackError.message}`;
        throw fallbackError;
      }
      aiResult.fallbackUsed = true;
      aiResult.fallbackReason = primaryError.message;
      aiResult.primaryModel = route.primary.model;
      aiResult.needsReview = true;
    }
    aiResult.routeMode = route.mode;
    const classification = CLASSIFICATIONS.find((item) => item.type === aiResult.type) || CLASSIFICATIONS.find((item) => item.type === "other");
    return { ...classification, ...aiResult };
  } catch (error) {
    if (!settings.allowOfflineFallback) throw error;
    const fallback = classifySegment(segment, segmentIndex, segmentCount);
    const analysis = normalizeSceneAnalysis({}, runtime?.productProfile);
    return {
      ...fallback,
      confidence: 0.25,
      title: `${fallback.label}（离线兜底）`,
      tags: ["离线兜底"],
      reason: `视觉模型不可用，已按用户允许的离线规则临时分配：${error.message}`,
      detected: {},
      analysis,
      productIdentity: analysis.productIdentity,
      shot: analysis.shot,
      actions: analysis.actions,
      visibleTexts: analysis.visibleTexts,
      captionRegions: analysis.captionRegions,
      overlayAssessment: analysis.overlayAssessment,
      evidence: analysis.evidence,
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
  const sku = sanitizeFileSegment(payload.sku, "");
  assertUsableSku(sku);
  const batchName = sanitizeFileSegment(payload.batchName, "未命名批次");
  const rootDir = path.resolve(payload.rootDir);
  const sourcePaths = [...new Set((payload.sourcePaths || []).map((item) => path.resolve(item)))];
  if (!sourcePaths.length) throw Object.assign(new Error("至少需要一个原视频"), { code: "NO_SOURCE_FILES" });
  if (!Number.isFinite(Number(payload.minimumClipSeconds)) || Number(payload.minimumClipSeconds) < MINIMUM_CLIP_SECONDS) {
    throw Object.assign(new Error("片段时长下限不能低于 2 秒"), { code: "MINIMUM_DURATION_LOCKED" });
  }
  const aiSettings = normalizeAiSettings(options.classificationRuntime?.settings || {});
  const route = options.classificationRuntime?.route;
  const requiresCloudKey = route ? route.primary?.provider === "qwen" : true;
  if (aiSettings.enabled && requiresCloudKey && !options.classificationRuntime?.apiKey && !aiSettings.allowOfflineFallback) {
    const error = new Error("尚未配置千问 API Key，请先到“设置 > 大模型”完成配置后再开始分类");
    error.code = "AI_KEY_REQUIRED";
    throw error;
  }
  await fs.mkdir(rootDir, { recursive: true });
  const ownershipTag = sanitizeFileSegment(payload.taskId || `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, "task").slice(-12);
  const storage = planBatchStorage({ rootDir, sku, batchName, taskTag: ownershipTag });
  const skuDir = storage.libraryDir;
  await fs.mkdir(skuDir, { recursive: true });
  await createSkuLibraryFolders(skuDir);
  await fs.mkdir(storage.taskRoot, { recursive: true });
  const batchDir = await uniqueDirectory(storage.batchBaseDir);
  await createBatchWorkFolders(batchDir);
  const captionRepairRuntime = options.captionRepairRuntime || await inspectCaptionRepairRuntime(options.captionRepairSettings || {}, {
    signal: options.signal,
    resourcesPath: options.resourcesPath
  });

  const manifest = {
    schemaVersion: 3,
    storageLayout: "sku_category_v1",
    appVersion: options.appVersion || "0.1.0",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "processing",
    processingMode: route?.mode || (options.classificationRuntime?.apiKey ? "qwen_vision" : "offline_fallback"),
    taskId: payload.taskId || null,
    ownershipTag,
    sku,
    batchName,
    rootDir,
    libraryDir: skuDir,
    batchDir,
    minimumClipSeconds: MINIMUM_CLIP_SECONDS,
    outputSpec: { width: 1080, height: 1920, aspectRatio: "9:16", fps: 30, videoCodec: "H.264", audioCodec: "AAC", sampleRate: 48000 },
    classification: {
      provider: route?.primary?.provider || (options.classificationRuntime?.apiKey ? "qwen" : "offline"),
      model: route?.primary?.model || (options.classificationRuntime?.apiKey ? aiSettings.model : "heuristic-v1"),
      routeMode: route?.mode || "legacy",
      region: aiSettings.region,
      framesPerClip: aiSettings.framesPerClip,
      confidenceThreshold: aiSettings.confidenceThreshold,
      allowOfflineFallback: aiSettings.allowOfflineFallback
    },
    productProfile: options.classificationRuntime?.productProfile ? {
      schemaVersion: options.classificationRuntime.productProfile.schemaVersion || 1,
      sku: options.classificationRuntime.productProfile.sku,
      name: options.classificationRuntime.productProfile.name,
      category: options.classificationRuntime.productProfile.category,
      color: options.classificationRuntime.productProfile.color,
      silhouette: options.classificationRuntime.productProfile.silhouette,
      fabric: options.classificationRuntime.productProfile.fabric,
      audience: options.classificationRuntime.productProfile.audience,
      allowedClaims: options.classificationRuntime.productProfile.allowedClaims || [],
      verificationRequired: options.classificationRuntime.productProfile.verificationRequired || [],
      referenceImageCount: options.classificationRuntime.productProfile.referenceImages?.length || 0,
      updatedAt: options.classificationRuntime.productProfile.updatedAt || null
    } : null,
    captionTreatment: {
      mode: payload.captionMode || "smart_mask",
      standardVersion: STANDARD_VERSION,
      label: (payload.captionMode || "smart_mask") === "smart_mask" ? "4fps 检测 + 字幕难度分级 + 全尺寸 LaMa 补画 + 复杂图文分流" : "保留原画面，仅分类",
      note: "原文件不修改；普通硬字幕使用字形蒙版和 LaMa 修复；高难动态字幕自动升级为 1080 分析宽度，仅补画字形，内部复杂转场进入低复用待复核；全流程禁止裁切放大或拉丝。",
      runtime: {
        auditAvailable: captionRepairRuntime.auditAvailable === true,
        repairAvailable: captionRepairRuntime.repairAvailable === true,
        acceleration: captionRepairRuntime.acceleration || "unavailable",
        opencvVersion: captionRepairRuntime.opencvVersion || null,
        torchVersion: captionRepairRuntime.torchVersion || null
      }
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
  if (!manifest.productProfile) manifest.warnings.push(`款号 ${sku} 尚未建立目标商品资料卡，商品身份需要人工复核且成片不得进入可投放目录`);
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
        maximumSeconds: Number(payload.maximumClipSeconds || 6),
        threshold: Number(payload.sceneThreshold || 0.32)
      });
      if (segments.some((segment) => segment.duration < MINIMUM_CLIP_SECONDS - 0.001)) {
        throw new Error("内部校验失败：检测到低于 2 秒的片段");
      }
      const sourceRecord = { ...sourceInfo, originalPath: sourcePath, archivedPath, status: "processed", segmentCount: segments.length, segmentIds: [] };
      manifest.sources.push(sourceRecord);
      sourceRecord.captionMode = sourceCaptionMode;

      options.onProgress?.({
        stage: "caption-detect",
        progress: (sourceIndex + 0.1) / totalSources,
        message: `按 4fps 检测硬字幕与描边文字：${sourceInfo.fileName}`
      });
      let sourceCaptionAudit;
      try {
        sourceCaptionAudit = await auditVideoCaptions(sourcePath, captionRepairRuntime, {
          signal: options.signal,
          resourcesPath: options.resourcesPath,
          sampleFps: 4
        });
      } catch (error) {
        sourceCaptionAudit = { available: false, sampleFps: 4, samples: [], positiveFrames: 0, reason: error.message };
        manifest.warnings.push(`${sourceInfo.fileName} 的本机 4fps 字幕检测未完成：${error.message}`);
      }
      sourceRecord.captionAudit = {
        available: sourceCaptionAudit.available !== false,
        sampleFps: Number(sourceCaptionAudit.sampleFps || 4),
        checkedFrames: Number(sourceCaptionAudit.checkedFrames || 0),
        positiveFrames: Number(sourceCaptionAudit.positiveFrames || 0),
        positiveRatio: Number(sourceCaptionAudit.positiveRatio || 0),
        wallSeconds: Number(sourceCaptionAudit.wallSeconds || 0)
      };

      const segmentPlans = [];
      for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
        const segment = segments[segmentIndex];
        options.onProgress?.({
          stage: "ai-classify",
          progress: (sourceIndex + (segmentIndex + 0.05) / segments.length * 0.45) / totalSources,
          message: `千问识别镜头 ${segmentIndex + 1}/${segments.length}：服装语义、字幕与复杂覆盖层`
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
        } else if (classification.fallbackUsed) {
          manifest.warnings.push(`${sourceInfo.fileName} 第 ${segmentIndex + 1} 段云端不可用，已由本地 Qwen 分类并标记待复核`);
        }
        const segmentCaptionAudit = auditSlice(sourceCaptionAudit, segment);
        const captionTreatment = decideCaptionTreatment({
          analysis: classification,
          captionMode: sourceCaptionMode,
          audit: segmentCaptionAudit
        });
        if (captionTreatment.decision === DECISIONS.LOW_REUSE) {
          manifest.warnings.push(`${sourceInfo.fileName} 第 ${segmentIndex + 1} 段包含复杂图文，已保留原画并放入低复用待复核：${captionTreatment.reason}`);
        }
        segmentPlans.push({ segment, classification, segmentCaptionAudit, captionTreatment });
      }

      const highDifficultyPlan = planHighDifficultyCaptionRepair(sourceCaptionAudit, sourceInfo, {
        ranges: segments,
        minimumSeconds: MINIMUM_CLIP_SECONDS
      });
      if (sourceCaptionMode === "smart_mask" && highDifficultyPlan.level === "high") {
        for (const plan of segmentPlans) {
          const contaminatedSeconds = highDifficultyPlan.excludedRanges.reduce((sum, range) => sum + timedRangeOverlapSeconds(plan.segment, range), 0);
          if (contaminatedSeconds >= Math.max(0.5, Number(plan.segment.duration || 0) * 0.4)) {
            plan.captionTreatment = {
              ...plan.captionTreatment,
              decision: DECISIONS.LOW_REUSE,
              reason: "高难动态字幕位于复杂运动纹理上；为保护清晰度，本段不放大、不裁切，自动转入低复用待复核",
              difficultyScore: highDifficultyPlan.score,
              repairStrategy: highDifficultyPlan.strategy
            };
          }
        }
      }
      sourceRecord.captionRepairPlan = {
        version: highDifficultyPlan.version,
        level: highDifficultyPlan.level,
        score: highDifficultyPlan.score,
        strategy: highDifficultyPlan.strategy,
        analysisWidth: highDifficultyPlan.analysisWidth,
        excludedRanges: highDifficultyPlan.excludedRanges,
        evidence: highDifficultyPlan.evidence
      };
      const auditCandidateRanges = segmentPlans
        .filter((plan) => plan.captionTreatment.decision === DECISIONS.REPAIR)
        .map((plan) => plan.segment);
      const auditManualZones = highDifficultyPlan.level === "high"
        ? highDifficultyPlan.manualZones
        : manualZonesFromAudit(sourceCaptionAudit, auditCandidateRanges, sourceInfo);
      let repairedSourcePath = null;
      let repairedSourceAudit = null;
      let sourceRepairError = null;
      if (sourceCaptionMode === "smart_mask" && auditCandidateRanges.length && captionRepairRuntime.repairAvailable) {
        repairedSourcePath = path.join(batchDir, ".analysis", `source-${sourceIndex + 1}-caption-repaired.mp4`);
        options.onProgress?.({
          stage: "caption-repair",
          progress: (sourceIndex + 0.14) / totalSources,
            message: highDifficultyPlan.level === "high"
              ? `GPU 高难字幕全尺寸补画：${sourceInfo.fileName}`
              : `GPU 安全修复普通硬字幕候选：${sourceInfo.fileName}`
        });
        try {
          await repairCaptionRanges(sourcePath, repairedSourcePath, auditCandidateRanges, captionRepairRuntime, {
            signal: options.signal,
            resourcesPath: options.resourcesPath,
            manualZones: auditManualZones,
            manualOnly: highDifficultyPlan.manualOnly,
            analysisWidth: highDifficultyPlan.analysisWidth,
            onProgress: ({ sourceSecond }) => options.onProgress?.({
              stage: "caption-repair",
              progress: (sourceIndex + Math.min(0.42, 0.14 + 0.28 * sourceSecond / Math.max(1, sourceInfo.duration))) / totalSources,
              message: `逐帧修复 ${sourceInfo.fileName} · ${sourceSecond.toFixed(1)} / ${sourceInfo.duration.toFixed(1)} 秒`
            })
          });
          options.onProgress?.({
            stage: "caption-final-audit",
            progress: (sourceIndex + 0.43) / totalSources,
            message: `按 4fps 终检修复结果：${sourceInfo.fileName}`
          });
          repairedSourceAudit = await auditVideoCaptions(repairedSourcePath, captionRepairRuntime, {
            signal: options.signal,
            resourcesPath: options.resourcesPath,
            sampleFps: 4
          });
        } catch (error) {
          sourceRepairError = { code: error.code || "CAPTION_REPAIR_FAILED", message: error.message };
          if (repairedSourcePath) await fs.rm(repairedSourcePath, { force: true }).catch(() => {});
          repairedSourcePath = null;
          repairedSourceAudit = { available: false, sampleFps: 4, samples: [], positiveFrames: 0, reason: error.message };
          manifest.warnings.push(`${sourceInfo.fileName} 的普通字幕修复失败，相关片段将进入低复用待复核：${error.message}`);
        }
      } else if (sourceCaptionMode === "smart_mask" && auditCandidateRanges.length && !captionRepairRuntime.repairAvailable) {
        sourceRepairError = { code: "CAPTION_REPAIR_UNAVAILABLE", message: "本机缺少 OpenCV + LaMa 字幕修复运行环境" };
        manifest.warnings.push(`${sourceInfo.fileName} 检测到字幕，但本机修复引擎不可用，相关片段将进入低复用待复核`);
      }
      sourceRecord.captionRepair = {
        candidateRangeCount: auditCandidateRanges.length,
        repaired: Boolean(repairedSourcePath),
        acceleration: captionRepairRuntime.acceleration || "unavailable",
        finalAuditAvailable: repairedSourcePath ? repairedSourceAudit?.available !== false : null,
        finalAuditCheckedFrames: repairedSourcePath ? Number(repairedSourceAudit?.checkedFrames || 0) : 0,
        finalAuditPositiveFrames: repairedSourcePath ? Number(repairedSourceAudit?.positiveFrames || 0) : 0,
        planVersion: highDifficultyPlan.version,
        difficultyLevel: highDifficultyPlan.level,
        difficultyScore: highDifficultyPlan.score,
        strategy: highDifficultyPlan.strategy,
        error: sourceRepairError
      };

      for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
        const { segment, classification, segmentCaptionAudit, captionTreatment } = segmentPlans[segmentIndex];
        const canUseRepair = captionTreatment.decision !== DECISIONS.REPAIR || Boolean(repairedSourcePath);
        if (captionTreatment.decision === DECISIONS.REPAIR && !repairedSourcePath) {
          manifest.warnings.push(`${sourceInfo.fileName} 第 ${segmentIndex + 1} 段检测到普通硬字幕，但修复结果不可用，已放入低复用待复核`);
        }
        const segmentCaptionMaskPath = null;
        const sourceBase = sanitizeFileSegment(path.basename(sourcePath, path.extname(sourcePath))).slice(0, 42);
        const serial = String(segmentIndex + 1).padStart(3, "0");
        const fileName = `${sourceBase}_${ownershipTag}_${serial}_${classification.label}_${segment.duration.toFixed(2)}s.mp4`;
        let outputPath = await uniqueFile(path.join(batchDir, ".staging", fileName));
        const exportSourcePath = captionTreatment.decision === DECISIONS.REPAIR && repairedSourcePath
          ? repairedSourcePath
          : sourcePath;
        const overall = (sourceIndex + (segmentIndex + 0.1) / segments.length) / totalSources;
        options.onProgress?.({
          stage: "export",
          progress: overall,
          message: `生成 ${sourceIndex + 1}/${totalSources} · 片段 ${segmentIndex + 1}/${segments.length} · ${classification.label}`
        });
        let outputInfo = await exportSegment(exportSourcePath, outputPath, segment, sourceInfo, {
          captionMode: "keep",
          captionMaskPath: segmentCaptionMaskPath,
          captionRegions: classification.captionRegions,
          signal: options.signal,
          onProgress: (clipProgress) => options.onProgress?.({
            stage: "export",
            progress: (sourceIndex + (segmentIndex + clipProgress) / segments.length) / totalSources,
            message: `处理片段 ${segmentIndex + 1}/${segments.length}：${classification.label}`
          })
        });
        options.onProgress?.({
          stage: "caption-verify",
          progress: (sourceIndex + (segmentIndex + 0.88) / segments.length) / totalSources,
          message: `复检片段 ${segmentIndex + 1}/${segments.length}：确认原字幕和水印已清除`
        });
        let postRepairAnalysis = null;
        let postRepairError = null;
        const postRepairRuntime = {
          ...options.classificationRuntime,
          sourceIndex: `post-${sourceIndex}`,
          settings: { ...(options.classificationRuntime?.settings || {}), framesPerClip: 8 },
          productProfile: options.classificationRuntime?.productProfile
            ? { ...options.classificationRuntime.productProfile, referenceImages: [] }
            : null
        };
        try {
          postRepairAnalysis = await classifyMaterialSegment({
            sourcePath: outputPath,
            sourceInfo: { ...outputInfo, fileName },
            segment: { start: 0, end: outputInfo.duration, duration: outputInfo.duration },
            segmentIndex,
            segmentCount: segments.length,
            batchDir,
            runtime: postRepairRuntime,
            signal: options.signal
          });
        } catch (error) {
          postRepairError = { code: error.code || "CAPTION_POST_OCR_FAILED", message: error.message };
          manifest.warnings.push(`${sourceInfo.fileName} 第 ${segmentIndex + 1} 段修复后 OCR 未完成：${error.message}`);
        }
        let captionVerification = verifyCaptionRepair({
          beforeTexts: classification.visibleTexts,
          afterTexts: postRepairAnalysis?.visibleTexts,
          treatmentMode: sourceCaptionMode,
          afterAvailable: Boolean(postRepairAnalysis && postRepairAnalysis.mode !== "offline_fallback")
        });
        let finalCaptionAudit = captionTreatment.decision === DECISIONS.REPAIR
          ? auditSlice(repairedSourceAudit || { available: false, sampleFps: 4, samples: [] }, segment)
          : segmentCaptionAudit;
        captionVerification = gateFinalCaptionAudit(captionVerification, finalCaptionAudit, {
          required: sourceCaptionMode === "smart_mask" && captionTreatment.decision === DECISIONS.REPAIR
        });
        const supportsLamaSecondPass = shouldAttemptCaptionSecondPass({
          treatment: captionTreatment,
          captionVerification,
          captionRegions: postRepairAnalysis?.captionRegions,
          repairAvailable: captionRepairRuntime.repairAvailable
        });
        if (supportsLamaSecondPass && sourceCaptionMode === "smart_mask") {
          options.onProgress?.({
            stage: "caption-repair-2",
            progress: (sourceIndex + (segmentIndex + 0.92) / segments.length) / totalSources,
            message: `二次清除片段 ${segmentIndex + 1}/${segments.length}：避开新识别到的字幕区域`
          });
          const secondPassPath = `${outputPath}.caption-pass2.mp4`;
          try {
            const secondPassZones = manualZonesFromRegions(postRepairAnalysis.captionRegions, outputInfo.duration);
            await repairCaptionRanges(outputPath, secondPassPath, [{
              start: 0,
              end: outputInfo.duration,
              duration: outputInfo.duration
            }], captionRepairRuntime, {
              signal: options.signal,
              resourcesPath: options.resourcesPath,
              manualZones: secondPassZones,
              manualOnly: highDifficultyPlan.manualOnly,
              analysisWidth: highDifficultyPlan.analysisWidth,
              onProgress: ({ sourceSecond }) => options.onProgress?.({
                stage: "caption-repair-2",
                progress: (sourceIndex + (segmentIndex + 0.92) / segments.length) / totalSources,
                message: `二次清除片段 ${segmentIndex + 1}/${segments.length} · ${Number(sourceSecond || 0).toFixed(1)} 秒`
              })
            });
            const secondPassInfo = await probeVideo(secondPassPath);
            const secondPassAnalysis = await classifyMaterialSegment({
              sourcePath: secondPassPath,
              sourceInfo: { ...secondPassInfo, fileName },
              segment: { start: 0, end: secondPassInfo.duration, duration: secondPassInfo.duration },
              segmentIndex,
              segmentCount: segments.length,
              batchDir,
              runtime: { ...postRepairRuntime, sourceIndex: `post2-${sourceIndex}` },
              signal: options.signal
            });
            let secondPassVerification = verifyCaptionRepair({
              beforeTexts: classification.visibleTexts,
              afterTexts: secondPassAnalysis.visibleTexts,
              treatmentMode: sourceCaptionMode,
              afterAvailable: secondPassAnalysis.mode !== "offline_fallback"
            });
            const secondPassAudit = await auditVideoCaptions(secondPassPath, captionRepairRuntime, {
              signal: options.signal,
              resourcesPath: options.resourcesPath,
              sampleFps: 4
            });
            secondPassVerification = gateFinalCaptionAudit(secondPassVerification, secondPassAudit, { required: true });
            const statusRank = { blocked: 0, review: 1, pass: 2 };
            const secondPassImproved = Number(statusRank[secondPassVerification.status] || 0) > Number(statusRank[captionVerification.status] || 0)
              || (secondPassVerification.status === captionVerification.status
                && Number(secondPassVerification.residualCount || 0) < Number(captionVerification.residualCount || 0));
            if (secondPassImproved) {
              await fs.copyFile(secondPassPath, outputPath);
              outputInfo = secondPassInfo;
              postRepairAnalysis = secondPassAnalysis;
              captionVerification = secondPassVerification;
              finalCaptionAudit = secondPassAudit;
            }
          } finally {
            await fs.rm(secondPassPath, { force: true });
          }
        }
        if (captionVerification.status !== "pass") {
          manifest.warnings.push(`${sourceInfo.fileName} 第 ${segmentIndex + 1} 段字幕复检${captionVerification.status === "blocked" ? "阻断" : "待人工确认"}：${captionVerification.reasons.join("；")}`);
        }
        const finalDestination = finalMaterialDestination({
          treatment: captionTreatment,
          captionVerification,
          repairAvailable: canUseRepair
        });
        const finalOutputPath = await uniqueFile(destinationPath({
          libraryDir: skuDir,
          batchDir,
          folder: finalDestination.folder || classification.folder,
          fileName
        }));
        const id = `material-${Date.now()}-${sourceIndex}-${segmentIndex}`;
        const thumbnailPath = path.join(batchDir, ".thumbnails", `${id}.jpg`);
        await generateThumbnail(outputPath, thumbnailPath, Math.min(1, segment.duration / 2));
        const material = {
          id,
          name: `${classification.label} ${serial}`,
          type: classification.type,
          typeLabel: classification.label,
          categoryFolder: finalDestination.folder || classification.folder,
          intendedCategoryFolder: classification.folder,
          storageLayout: "sku_category_v1",
          libraryDir: skuDir,
          sku,
          batch: batchName,
          duration: outputInfo.duration,
          width: outputInfo.width,
          height: outputInfo.height,
          fps: 30,
          filePath: finalOutputPath,
          thumbnailPath,
          sourcePath,
          sourceStart: segment.start,
          sourceEnd: segment.end,
          sourceAudioMuted: true,
          audioMode: "silent_track",
          captionStatus: finalDestination.lowReuse
            ? captionTreatment.decision === DECISIONS.LOW_REUSE ? "complex_overlay_low_reuse" : captionVerification.status === "blocked" ? "residual_blocked" : "verification_required"
            : "clean_verified",
          captionTreatment,
          captionAudit: segmentCaptionAudit,
          finalCaptionAudit,
          captionRepair: {
            attempted: captionTreatment.decision === DECISIONS.REPAIR,
            applied: captionTreatment.decision === DECISIONS.REPAIR && Boolean(repairedSourcePath),
            acceleration: captionRepairRuntime.acceleration || "unavailable",
            error: captionTreatment.decision === DECISIONS.REPAIR ? sourceRepairError : null
          },
          captionVerification,
          captionPostRepairOcrError: postRepairError,
          classificationMode: classification.mode,
          classificationProvider: classification.provider,
          classificationModel: classification.model,
          classificationConfidence: classification.confidence,
          classificationReason: classification.reason,
          classificationTags: classification.tags,
          classificationDetected: classification.detected,
          productIdentity: classification.productIdentity,
          shot: classification.shot,
          actions: classification.actions,
          visibleTexts: classification.visibleTexts,
          captionRegions: classification.captionRegions,
          overlayAssessment: classification.overlayAssessment,
          captionMaskPath: segmentCaptionMaskPath,
          visualFidelity: {
            status: "pass",
            framingPolicy: "preserve_full_frame",
            cropFactor: 1,
            zoomFactor: 1,
            sourceScale: Number(Math.min(1, 1080 / sourceInfo.width, 1920 / sourceInfo.height).toFixed(4)),
            sourceWasUpscaled: false,
            sourceWidth: sourceInfo.width,
            sourceHeight: sourceInfo.height,
            note: "完整构图等比缩小或原尺寸输出；不裁切、不放大。"
          },
          evidence: classification.evidence,
          classificationFrameCount: classification.frameCount,
          classificationNeedsReview: classification.needsReview,
          classificationTitle: classification.title,
          classificationRouteMode: classification.routeMode || route?.mode || "legacy",
          classificationFallbackUsed: classification.fallbackUsed === true,
          classificationFallbackReason: classification.fallbackReason || "",
          classificationPrimaryModel: classification.primaryModel || classification.model,
          lowReuse: finalDestination.lowReuse,
          lowReuseReasons: finalDestination.reasons,
          eligibleForMix: !finalDestination.lowReuse && classification.productIdentity?.status === "matched" && captionVerification.status === "pass" && classification.needsReview !== true,
          eligibilityReasons: [
            ...finalDestination.reasons,
            classification.productIdentity?.status !== "matched" ? `商品身份${classification.productIdentity?.status || "unknown"}` : "",
            captionVerification.status !== "pass" ? `字幕复检${captionVerification.status}` : "",
            classification.needsReview === true ? "视觉分类待复核" : ""
          ].filter(Boolean),
          uses: 0
        };
        manifest.materials.push(material);
        sourceRecord.segmentIds.push(id);
        try {
          await fs.rename(outputPath, finalOutputPath);
          outputPath = finalOutputPath;
          await saveManifest(manifest);
        } catch (error) {
          manifest.materials = manifest.materials.filter((item) => item.id !== id);
          sourceRecord.segmentIds = sourceRecord.segmentIds.filter((item) => item !== id);
          await fs.rm(outputPath, { force: true }).catch(() => {});
          await fs.rm(finalOutputPath, { force: true }).catch(() => {});
          await fs.rm(thumbnailPath, { force: true }).catch(() => {});
          throw error;
        }
      }
      if (repairedSourcePath) await fs.rm(repairedSourcePath, { force: true }).catch(() => {});
    }
    manifest.status = "ready_for_review";
    await fs.rm(path.join(batchDir, ".staging"), { recursive: true, force: true }).catch(() => {});
    manifest.updatedAt = new Date().toISOString();
    const reusableMaterials = manifest.materials.filter((material) => !material.lowReuse);
    const lowReuseMaterials = manifest.materials.filter((material) => material.lowReuse);
    manifest.summary = {
      sourceCount: manifest.sources.length,
      materialCount: reusableMaterials.length,
      totalSegmentCount: manifest.materials.length,
      lowReuseCount: lowReuseMaterials.length,
      unusableCount: manifest.sources.filter((source) => source.status.startsWith("unusable")).length,
      minimumDuration: reusableMaterials.length ? Math.min(...reusableMaterials.map((material) => material.duration)) : 0,
      aiClassifiedCount: manifest.materials.filter((material) => ["qwen_vision", "ollama_vision"].includes(material.classificationMode)).length,
      localClassifiedCount: manifest.materials.filter((material) => material.classificationMode === "ollama_vision").length,
      fallbackCount: manifest.materials.filter((material) => material.classificationMode === "offline_fallback").length,
      lowConfidenceCount: manifest.materials.filter((material) => material.classificationNeedsReview).length,
      reviewCount: lowReuseMaterials.length + manifest.materials.filter((material) => material.classificationNeedsReview && !material.lowReuse).length,
      captionRepairedCount: reusableMaterials.filter((material) => material.captionRepair?.applied).length,
      captionCleanCount: reusableMaterials.filter((material) => material.captionTreatment?.decision === DECISIONS.CLEAN).length,
      categories: Object.fromEntries(CLASSIFICATIONS.map((classification) => [classification.label, reusableMaterials.filter((material) => material.type === classification.type).length]))
    };
    await saveManifest(manifest);
    options.onProgress?.({ stage: "done", progress: 1, message: `处理完成：${reusableMaterials.length} 个可复用，${lowReuseMaterials.length} 个低复用待复核` });
    return { ...manifest, manifestPath, materials: manifest.materials.map(serializeMaterial) };
  } catch (error) {
    await fs.rm(path.join(batchDir, ".staging"), { recursive: true, force: true }).catch(() => {});
    manifest.status = options.signal?.aborted ? "cancelled" : "failed";
    manifest.updatedAt = new Date().toISOString();
    manifest.error = { message: error.message, code: error.code || "PROCESS_FAILED" };
    await saveManifest(manifest);
    throw Object.assign(error, { batchDir, manifestPath });
  }
}

async function findManifests(rootDir) {
  const results = new Set();
  async function walk(directory, depth, maximumDepth) {
    if (depth > maximumDepth) return;
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isFile() && entry.name === "manifest.json") results.add(entryPath);
      else if (entry.isDirectory() && !entry.name.startsWith(".") && !isInternalRootFolder(entry.name) && !(depth > 0 && isLibraryCategoryFolder(entry.name))) await walk(entryPath, depth + 1, maximumDepth);
    }
  }
  await walk(rootDir, 0, 3);
  await walk(path.join(rootDir, INTERNAL_TASKS_FOLDER), 0, 3);
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
    if (entry.isDirectory() && !entry.name.startsWith(".") && !isInternalRootFolder(entry.name)) {
      grouped.set(entry.name, { sku: entry.name, batchCount: 0, materialCount: 0, lastUpdatedAt: null });
    }
  }
  for (const batch of batches) {
    const sku = String(batch.sku || path.basename(path.dirname(batch.batchDir || batch.manifestPath || "")) || "未分款");
    const option = grouped.get(sku) || { sku, batchCount: 0, materialCount: 0, lastUpdatedAt: null };
    option.batchCount += 1;
    option.materialCount += Number(batch.summary?.materialCount ?? batch.materials?.length ?? 0);
    if (!option.lastUpdatedAt || String(batch.updatedAt) > String(option.lastUpdatedAt)) option.lastUpdatedAt = batch.updatedAt || null;
    grouped.set(sku, option);
  }
  return [...grouped.values()].sort((a, b) => String(b.lastUpdatedAt || "").localeCompare(String(a.lastUpdatedAt || "")) || a.sku.localeCompare(b.sku, "zh-CN"));
}

module.exports = { INTERNAL_TASKS_FOLDER, findManifests, listSkuOptions, loadManifest, planBatchStorage, processBatch, sanitizeFileSegment, serializeMaterial };
