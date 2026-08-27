const fs = require("fs");
const path = require("path");
const { detectScenes, probeVideo } = require("../electron/services/video-engine.cjs");

async function main() {
  const [configPath, outputPath, thresholdArg] = process.argv.slice(2);
  if (!configPath || !outputPath) {
    throw new Error("Usage: node batch-scene-detect.cjs <config.json> <output.json>");
  }
  const threshold = Number(thresholdArg || 0.06);
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const started = performance.now();
  const videos = [];
  for (const item of config.items) {
    const info = await probeVideo(item.source);
    const itemStarted = performance.now();
    const segments = await detectScenes(item.source, info.duration, {
      threshold,
      minimumSeconds: 2,
      maximumSeconds: 6
    });
    videos.push({
      id: item.id,
      durationSeconds: info.duration,
      wallSeconds: Number(((performance.now() - itemStarted) / 1000).toFixed(3)),
      segments
    });
    console.log(`${item.id} scenes=${segments.length} wall=${videos.at(-1).wallSeconds}s`);
  }
  const result = {
    threshold,
    minimumSeconds: 2,
    maximumSeconds: 6,
    batchWallSeconds: Number(((performance.now() - started) / 1000).toFixed(3)),
    videos
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
  console.log(`batch_wall=${result.batchWallSeconds}s output=${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
