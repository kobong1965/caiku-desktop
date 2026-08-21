const fs = require("node:fs/promises");
const { mixBatch } = require("../electron/services/mix-engine.cjs");
const { loadManifest } = require("../electron/services/workspace-service.cjs");

async function main() {
  const manifestPath = process.argv[2] || "D:\\抖音素材库\\S2026-08_K172-07\\2026-08-17_双款带货原片_验收批次\\manifest.json";
  await fs.access(manifestPath);
  const manifest = await loadManifest(manifestPath);
  const result = await mixBatch({
    batchDir: manifest.batchDir,
    projectName: "双款带货混剪验收",
    materials: manifest.materials,
    script: {
      name: "离线混剪验收脚本",
      duration: 12,
      blocks: [
        { name: "整体亮相", text: "先看正面和侧面的整体版型。", category: "整体展示", duration: 4 },
        { name: "人物穿搭", text: "不同上装可以参考实际穿着画面。", category: "人物穿搭", duration: 4 },
        { name: "测评结论", text: "尺码和颜色以商品页面实时信息为准。", category: "测评对比", duration: 4 }
      ]
    },
    voicePath: null,
    musicPath: null,
    useOfflineVoice: true,
    outputCount: 1
  }, {
    onProgress(progress) {
      process.stdout.write(`${Math.round(progress.progress * 100)}% ${progress.message}\n`);
    }
  });
  process.stdout.write(`RESULT=${JSON.stringify({ outputDir: result.outputDir, outputs: result.outputs.map((output) => ({ filePath: output.filePath, reportPath: output.reportPath, status: output.status, score: output.score })) })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n${error.stderr || ""}\n`);
  process.exitCode = 1;
});
