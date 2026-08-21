const path = require("node:path");
const { generateCaptionMask } = require("../electron/services/caption-mask-engine.cjs");
const { exportSegment, generateThumbnail, probeVideo } = require("../electron/services/video-engine.cjs");

async function main() {
  const sourcePath = "D:\\桌面\\抖音素材\\@谁谁 纯测评！！！谨慎买！！！俺自己认可的神裤😏 4K.mp4";
  const outputRoot = path.resolve(__dirname, "..", "_视频分析临时");
  const maskPath = path.join(outputRoot, "caption-mask-test1.pgm");
  const videoPath = path.join(outputRoot, "caption-mask-test1.mp4");
  const framePath = path.join(outputRoot, "caption-mask-test1.jpg");
  const info = await probeVideo(sourcePath);
  const mask = await generateCaptionMask(sourcePath, info, maskPath, {
    samples: [0.34, 0.68],
    dilationRadius: 2,
    width: 540,
    height: 960,
    zones: [
      { x: 0.03, y: 0.035, width: 0.94, height: 0.085, fill: true },
      { x: 0, y: 0.02, width: 1, height: 0.24 },
      { x: 0, y: 0.38, width: 1, height: 0.34 }
    ]
  });
  process.stdout.write(`MASK=${JSON.stringify({ pixels: mask.maskedPixels, ratio: mask.maskedPixels / (540 * 960) })}\n`);
  const startedAt = Date.now();
  await exportSegment(sourcePath, videoPath, { start: 45.56, end: 47.56, duration: 2 }, info, { captionMode: "smart_mask", captionMaskPath: maskPath, preset: "ultrafast" });
  await generateThumbnail(videoPath, framePath, 1);
  process.stdout.write(`OUTPUT=${JSON.stringify({ videoPath, framePath, elapsedSeconds: (Date.now() - startedAt) / 1000 })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n${error.stderr || ""}\n`);
  process.exitCode = 1;
});
