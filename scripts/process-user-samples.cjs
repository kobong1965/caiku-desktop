const { processBatch } = require("../electron/services/workspace-service.cjs");

const sourcePaths = [
  "D:\\桌面\\抖音素材\\@谁谁 纯测评！！！谨慎买！！！俺自己认可的神裤😏 4K.mp4",
  "D:\\桌面\\抖音素材\\@我来 夏天必须要穿上上短下长老钱感拉满的褶皱西裤谁能看出来是172 4K.mp4"
];

async function main() {
  let lastPercent = -1;
  const result = await processBatch({
    sku: "S2026-08_K172-07",
    batchName: "双款带货原片_像素遮罩终版",
    rootDir: "D:\\抖音素材库",
    sourcePaths,
    keepOriginals: true,
    minimumClipSeconds: 2,
    maximumClipSeconds: 9,
    sceneThreshold: 0.32,
    captionMode: "smart_mask",
    captionModeBySource: ["crop_reframe", "smart_mask"],
    captionSamples: [0.34, 0.68],
    captionZonesBySource: [
      [
        { x: 0.03, y: 0.035, width: 0.94, height: 0.085, fill: true },
        { x: 0, y: 0.02, width: 1, height: 0.24 },
        { x: 0, y: 0.38, width: 1, height: 0.34 }
      ],
      [
        { x: 0, y: 0, width: 1, height: 0.32 },
        { x: 0, y: 0.2, width: 0.32, height: 0.28 },
        { x: 0.68, y: 0.2, width: 0.32, height: 0.3 },
        { x: 0.64, y: 0.58, width: 0.36, height: 0.32 },
        { x: 0.34, y: 0.5, width: 0.34, height: 0.24 }
      ]
    ]
  }, {
    appVersion: "0.1.0",
    onProgress(progress) {
      const percent = Math.round(progress.progress * 100);
      if (percent !== lastPercent) {
        lastPercent = percent;
        process.stdout.write(`${String(percent).padStart(3, " ")}% ${progress.message}\n`);
      }
    }
  });
  process.stdout.write(`RESULT=${JSON.stringify({ manifestPath: result.manifestPath, batchDir: result.batchDir, materialCount: result.materials.length, summary: result.summary })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  if (error.stderr) process.stderr.write(`${error.stderr.slice(-5000)}\n`);
  process.exitCode = 1;
});
