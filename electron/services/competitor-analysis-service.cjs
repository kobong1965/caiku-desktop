const fs = require("node:fs/promises");
const path = require("node:path");
const { analyzeCompetitorFrames } = require("./ai-classifier.cjs");
const { generateAnalysisFrames, probeVideo } = require("./video-engine.cjs");

async function analyzeCompetitorVideo(filePath, options = {}) {
  const sourcePath = path.resolve(filePath);
  const source = await probeVideo(sourcePath);
  if (source.duration < 2) {
    const error = new Error("竞品视频不能短于 2 秒");
    error.code = "COMPETITOR_VIDEO_TOO_SHORT";
    throw error;
  }

  const taskFolder = `caiku-competitor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tempDir = path.join(options.tempRoot, taskFolder);
  options.onProgress?.({ stage: "frames", progress: 0.08, message: "正在抽取竞品视频关键帧…" });
  try {
    const framePaths = await generateAnalysisFrames(
      sourcePath,
      tempDir,
      { start: 0, end: source.duration, duration: source.duration },
      8,
      { signal: options.signal }
    );
    options.onProgress?.({ stage: "ai", progress: 0.32, message: "千问正在分析镜头结构、可见文字与剪辑节奏…" });
    const analysis = await analyzeCompetitorFrames({
      framePaths,
      duration: source.duration,
      sourceName: source.fileName,
      settings: options.settings,
      apiKey: options.apiKey,
      signal: options.signal
    });
    options.onProgress?.({ stage: "done", progress: 1, message: "竞品结构脚本已生成，可继续编辑并保存" });
    return {
      source: {
        filePath: source.filePath,
        fileName: source.fileName,
        duration: source.duration,
        width: source.width,
        height: source.height
      },
      ...analysis
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { analyzeCompetitorVideo };
