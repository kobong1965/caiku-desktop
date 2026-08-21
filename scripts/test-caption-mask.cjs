const path = require("node:path");
const { generateCaptionMask } = require("../electron/services/caption-mask-engine.cjs");
const { exportSegment, generateThumbnail, probeVideo } = require("../electron/services/video-engine.cjs");

async function main() {
  const sourcePath = "D:\\桌面\\抖音素材\\@我来 夏天必须要穿上上短下长老钱感拉满的褶皱西裤谁能看出来是172 4K.mp4";
  const outputRoot = path.resolve(__dirname, "..", "_视频分析临时");
  const maskPath = path.join(outputRoot, "caption-mask-test2.pgm");
  const videoPath = path.join(outputRoot, "caption-mask-test2.mp4");
  const framePath = path.join(outputRoot, "caption-mask-test2.jpg");
  const info = await probeVideo(sourcePath);
  const mask = await generateCaptionMask(sourcePath, info, maskPath, {
    samples: [0.34, 0.68],
    dilationRadius: 2,
    width: 540,
    height: 960,
    zones: [
      { x: 0, y: 0, width: 1, height: 0.32 },
      { x: 0, y: 0.2, width: 0.32, height: 0.28 },
      { x: 0.68, y: 0.2, width: 0.32, height: 0.3 },
      { x: 0.64, y: 0.58, width: 0.36, height: 0.32 },
      { x: 0.34, y: 0.5, width: 0.34, height: 0.24 }
    ]
  });
  process.stdout.write(`MASK=${JSON.stringify({ pixels: mask.maskedPixels, ratio: mask.maskedPixels / (540 * 960) })}\n`);
  const startedAt = Date.now();
  await exportSegment(sourcePath, videoPath, { start: 8, end: 10, duration: 2 }, info, { captionMode: "smart_mask", captionMaskPath: maskPath, preset: "ultrafast" });
  await generateThumbnail(videoPath, framePath, 1);
  process.stdout.write(`OUTPUT=${JSON.stringify({ videoPath, framePath, elapsedSeconds: (Date.now() - startedAt) / 1000 })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n${error.stderr || ""}\n`);
  process.exitCode = 1;
});
