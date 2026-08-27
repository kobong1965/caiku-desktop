const fs = require("node:fs/promises");
const path = require("node:path");
const { auditOutputFrames, auditOutputFramesWithOllama } = require("./ai-classifier.cjs");
const { applyQualityContract } = require("./quality-score-service.cjs");
const { generateAnalysisFrames, probeVideo } = require("./video-engine.cjs");

function finalizeQualityReport(report = {}) {
  return applyQualityContract(report);
}

async function auditGeneratedOutput(output, options = {}) {
  const source = await probeVideo(output.filePath);
  const tempDir = path.join(options.tempRoot, `caiku-quality-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  try {
    const framePaths = await generateAnalysisFrames(
      output.filePath,
      tempDir,
      { start: 0, end: source.duration, duration: source.duration },
      8,
      { signal: options.signal }
    );
    const route = options.route || {
      mode: "cloud_accuracy",
      primary: { provider: "qwen", model: options.settings?.model },
      fallback: null,
      settings: {}
    };
    const runStep = (step) => step.provider === "ollama"
      ? auditOutputFramesWithOllama({
        framePaths,
        duration: source.duration,
        sourceName: source.fileName,
        script: options.script,
        materialSummary: options.materialSummary,
        localSettings: { endpoint: route.settings?.localEndpoint, model: step.model, timeoutMs: 240000, contextLength: 8192 },
        signal: options.signal,
        fetchImpl: options.fetchImpl
      })
      : auditOutputFrames({
        framePaths,
        duration: source.duration,
        sourceName: source.fileName,
        script: options.script,
        materialSummary: options.materialSummary,
        settings: { ...options.settings, model: step.model },
        apiKey: options.apiKey,
        signal: options.signal,
        fetchImpl: options.fetchImpl
      });
    let visualSemantic;
    try {
      visualSemantic = await runStep(route.primary);
    } catch (primaryError) {
      if (!route.fallback) throw primaryError;
      visualSemantic = {
        ...(await runStep(route.fallback)),
        fallbackUsed: true,
        fallbackReason: primaryError.message,
        primaryModel: route.primary.model
      };
    }
    visualSemantic.routeMode = route.mode;
    if (!options.baseReport) return visualSemantic;
    return finalizeQualityReport({ ...options.baseReport, visualSemantic });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { auditGeneratedOutput, finalizeQualityReport };
