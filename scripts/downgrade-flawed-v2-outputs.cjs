const fs = require("node:fs/promises");
const path = require("node:path");

async function moveIfPresent(sourcePath, targetPath) {
  try {
    await fs.access(sourcePath);
  } catch {
    return false;
  }
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.rename(sourcePath, targetPath);
  return true;
}

async function main() {
  const batchDir = path.resolve(process.argv[2]);
  const readyDir = path.join(batchDir, "成片", "可投放");
  const blockedDir = path.join(batchDir, "成片", "已阻断", "上一版_画面放大_机械音");
  if (!blockedDir.startsWith(`${batchDir}${path.sep}`)) throw new Error("阻断目录超出批次范围");
  await fs.mkdir(blockedDir, { recursive: true });
  const reportDir = path.join(batchDir, "质检报告");
  const manifestPath = path.join(batchDir, "manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  for (let index = 1; index <= 3; index += 1) {
    const suffix = String(index).padStart(2, "0");
    const fileName = `918_V2事实展示_${suffix}_1080x1920.mp4`;
    const thumbnailName = `.thumb-${suffix}.jpg`;
    const targetPath = path.join(blockedDir, fileName);
    await moveIfPresent(path.join(readyDir, fileName), targetPath);
    await moveIfPresent(path.join(readyDir, thumbnailName), path.join(blockedDir, thumbnailName));
    const reportPath = path.join(reportDir, `918_V2事实展示_${suffix}_质检.json`);
    const report = JSON.parse(await fs.readFile(reportPath, "utf8"));
    const revised = {
      ...report,
      schemaVersion: Math.max(3, Number(report.schemaVersion || 0)),
      rulesetVersion: "CN-DOUYIN-QUALITY-2026.08.3",
      revisedAt: new Date().toISOString(),
      outputPath: targetPath,
      destination: "blocked",
      status: "blocked",
      totalScore: 0,
      publishReady: false,
      visualFidelity: { status: "blocked", score: 0, framingPolicy: "cropped_and_upscaled", cropFactor: 0.4, zoomFactor: 2.5, sourceWasUpscaled: true, reasons: ["为躲避字幕裁切约 40% 画面后放大至 1080×1920，导致清晰度下降"] },
      voice: { ...(report.voice || {}), source: "windows_offline_tts", naturalness: { status: "blocked", score: 0, reasons: ["机械系统配音缺少真实穿搭分享的停顿、重音与种草感"] } },
      hardBlockers: [
        { code: "VISUAL_FIDELITY_BLOCKED", dimension: "visualFidelity", label: "原画清晰度与完整构图", message: "检测到裁切放大" },
        { code: "VOICE_NATURALNESS_BLOCKED", dimension: "voiceNaturalness", label: "口播自然度与种草感", message: "检测到机械系统配音" }
      ],
      revisionNote: "撤销上一版 100 分结论；文件保留在已阻断目录，仅供问题对照。"
    };
    await fs.writeFile(reportPath, `${JSON.stringify(revised, null, 2)}\n`, "utf8");
  }
  manifest.generatedOutputs = (manifest.generatedOutputs || []).map((output) => ({
    ...output,
    filePath: String(output.filePath || "").replace(`${path.sep}成片${path.sep}可投放${path.sep}`, `${path.sep}成片${path.sep}已阻断${path.sep}上一版_画面放大_机械音${path.sep}`),
    status: "blocked",
    score: 0,
    publishReady: false,
    revisionReason: "画面裁切放大且机械配音"
  }));
  manifest.updatedAt = new Date().toISOString();
  manifest.warnings = [...new Set([...(manifest.warnings || []), "上一版 3 条成片已撤销 100 分并移至已阻断：画面裁切放大、机械系统配音。"] )];
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ blockedDir, count: 3 })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
