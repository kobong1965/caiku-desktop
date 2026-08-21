const fs = require("node:fs/promises");
const path = require("node:path");
const { auditOutputFrames } = require("./ai-classifier.cjs");
const { generateAnalysisFrames, probeVideo } = require("./video-engine.cjs");

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
    return auditOutputFrames({
      framePaths,
      duration: source.duration,
      sourceName: source.fileName,
      script: options.script,
      materialSummary: options.materialSummary,
      settings: options.settings,
      apiKey: options.apiKey,
      signal: options.signal
    });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { auditGeneratedOutput };
