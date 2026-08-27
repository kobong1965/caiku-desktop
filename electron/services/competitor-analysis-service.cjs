const fs = require("node:fs/promises");
const path = require("node:path");
const { analyzeCompetitorFrames, analyzeCompetitorFramesWithOllama } = require("./ai-classifier.cjs");
const { createMarketScriptRecipe, USER_REFERENCE_SOURCE } = require("./editing-case-analysis-service.cjs");
const { generateAnalysisFrames, probeVideo } = require("./video-engine.cjs");

function attachMarketScriptRecipe(analysis = {}, source = {}) {
  const normalizedSource = {
    filePath: path.resolve(source.filePath),
    fileName: source.fileName,
    duration: source.duration,
    width: source.width,
    height: source.height,
    sourceType: USER_REFERENCE_SOURCE
  };
  return {
    source: normalizedSource,
    ...analysis,
    learningRecipe: createMarketScriptRecipe(analysis, normalizedSource)
  };
}

async function analyzeCompetitorVideo(filePath, options = {}) {
  const sourcePath = path.resolve(filePath);
  const source = await probeVideo(sourcePath);
  if (source.duration < 2) {
    const error = new Error("投喂的参考视频不能短于 2 秒");
    error.code = "COMPETITOR_VIDEO_TOO_SHORT";
    throw error;
  }

  const taskFolder = `caiku-competitor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tempDir = path.join(options.tempRoot, taskFolder);
  options.onProgress?.({ stage: "frames", progress: 0.08, message: "正在抽取投喂视频关键帧…" });
  try {
    const framePaths = await generateAnalysisFrames(
      sourcePath,
      tempDir,
      { start: 0, end: source.duration, duration: source.duration },
      8,
      { signal: options.signal }
    );
    const route = options.route || {
      mode: "cloud_accuracy",
      primary: { provider: "qwen", model: options.settings?.model },
      fallback: null,
      reviewer: null,
      settings: {}
    };
    const runStep = async (step) => {
      if (step.provider === "ollama") {
        return analyzeCompetitorFramesWithOllama({
          framePaths,
          duration: source.duration,
          sourceName: source.fileName,
          localSettings: {
            endpoint: route.settings?.localEndpoint,
            model: step.model,
            timeoutMs: 240000,
            contextLength: 8192,
            maxOutputTokens: 2600
          },
          signal: options.signal,
          fetchImpl: options.fetchImpl
        });
      }
      return analyzeCompetitorFrames({
        framePaths,
        duration: source.duration,
        sourceName: source.fileName,
        settings: { ...options.settings, model: step.model },
        apiKey: options.apiKey,
        signal: options.signal,
        fetchImpl: options.fetchImpl
      });
    };
    options.onProgress?.({ stage: "ai", progress: 0.32, message: route.primary.provider === "qwen" ? "千问正在分析镜头结构、可见文字与剪辑节奏…" : "本地 Qwen 正在分析镜头结构，素材不会上传云端…" });
    let analysis;
    try {
      analysis = await runStep(route.primary);
    } catch (primaryError) {
      const invalidStructure = ["AI_INVALID_JSON", "AI_COMPETITOR_BLOCKS_MISSING", "AI_EMPTY_RESPONSE"].includes(primaryError?.code);
      if (route.reviewer && invalidStructure) {
        analysis = { ...(await runStep(route.reviewer)), reviewerUsed: true, primaryModel: route.primary.model };
      } else if (route.fallback) {
        options.onProgress?.({ stage: "ai_fallback", progress: 0.55, message: "云端分析不可用，正在转由本地 Qwen 继续…" });
        analysis = { ...(await runStep(route.fallback)), fallbackUsed: true, fallbackReason: primaryError.message, primaryModel: route.primary.model };
      } else {
        throw primaryError;
      }
    }
    analysis.routeMode = route.mode;
    options.onProgress?.({ stage: "done", progress: 1, message: "投喂视频的剪辑思路已生成，可继续编辑并保存" });
    return attachMarketScriptRecipe(analysis, source);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { analyzeCompetitorVideo, attachMarketScriptRecipe };
