const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const {
  auditVideoCaptions,
  inspectCaptionRepairRuntime,
  planHighDifficultyCaptionRepair,
  repairCaptionRanges
} = require("../electron/services/caption-repair-service.cjs");
const { probeVideo } = require("../electron/services/video-engine.cjs");

function valueAfter(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

async function sha256(filePath) {
  const payload = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(payload).digest("hex");
}

async function main() {
  const inputPath = path.resolve(valueAfter("--input"));
  const outputPath = path.resolve(valueAfter("--output", path.join(path.dirname(inputPath), `${path.basename(inputPath, path.extname(inputPath))}_软件高难字幕回归_静音.mp4`)));
  const reportPath = path.resolve(valueAfter("--report", `${outputPath}.report.json`));
  assert.ok(valueAfter("--input"), "必须传入 --input");
  const sourceHashBefore = await sha256(inputPath);
  const sourceInfo = await probeVideo(inputPath);
  const runtime = await inspectCaptionRepairRuntime();
  assert.equal(runtime.auditAvailable, true, "OpenCV 字幕检测不可用");
  assert.equal(runtime.repairAvailable, true, "LaMa 字幕修复不可用");
  const sourceAudit = await auditVideoCaptions(inputPath, runtime, {
    sampleFps: 4,
    onLog: (chunk) => process.stdout.write(chunk)
  });
  const plan = planHighDifficultyCaptionRepair(sourceAudit, sourceInfo, { minimumSeconds: 2 });
  assert.equal(plan.level, "high", `期望高难模式，实际为 ${plan.level}`);
  await repairCaptionRanges(inputPath, outputPath, [{ start: 0, end: sourceInfo.duration }], runtime, {
    analysisWidth: plan.analysisWidth,
    keepRanges: plan.keepRanges,
    manualOnly: plan.manualOnly,
    manualZones: plan.manualZones,
    onProgress: ({ sourceSecond }) => process.stdout.write(`repair=${Number(sourceSecond || 0).toFixed(1)}/${sourceInfo.duration.toFixed(1)}s\n`)
  });
  const outputInfo = await probeVideo(outputPath);
  const outputAudit = await auditVideoCaptions(outputPath, runtime, { sampleFps: 4 });
  const expectedDuration = plan.keepRanges.reduce((sum, range) => sum + range.duration, 0);
  assert.equal(outputInfo.width, 1080, "输出宽度不是 1080");
  assert.equal(outputInfo.height, 1920, "输出高度不是 1920");
  assert.equal(outputInfo.hasAudio, false, "分类素材仍存在原声");
  assert.ok(Math.abs(outputInfo.duration - expectedDuration) <= 0.12, "保留时间轴与输出时长不一致");
  assert.equal(await sha256(inputPath), sourceHashBefore, "原视频被意外修改");
  const report = {
    passed: true,
    testedAt: new Date().toISOString(),
    inputPath,
    outputPath,
    sourceHash: sourceHashBefore,
    runtime: {
      acceleration: runtime.acceleration,
      opencvVersion: runtime.opencvVersion,
      torchVersion: runtime.torchVersion
    },
    plan,
    source: sourceInfo,
    output: outputInfo,
    captionAudit: {
      before: {
        checkedFrames: sourceAudit.checkedFrames,
        positiveFrames: sourceAudit.positiveFrames,
        positiveRatio: sourceAudit.positiveRatio
      },
      after: {
        checkedFrames: outputAudit.checkedFrames,
        positiveFrames: outputAudit.positiveFrames,
        positiveRatio: outputAudit.positiveRatio,
        note: "传统亮字检测会把高亮服装纹理与装饰图文计入候选，最终以可视对比和大模型 OCR 复检为准。"
      }
    },
    rules: {
      fullFrame: true,
      zoomOrCrop: false,
      sourceAudioMuted: true,
      minimumKeptRangeSeconds: 2
    }
  };
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
  process.stdout.write(`${JSON.stringify({ passed: true, outputPath, reportPath, plan: { level: plan.level, score: plan.score, excludedRanges: plan.excludedRanges }, output: outputInfo }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
