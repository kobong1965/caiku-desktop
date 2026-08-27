const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { auditVideoCaptions, inspectCaptionRepairRuntime, repairCaptionRanges } = require("../electron/services/caption-repair-service.cjs");
const { probeVideo } = require("../electron/services/video-engine.cjs");

const EXPECTED = Object.freeze({
  sourceCount: 8,
  masterCount: 8,
  reusableClipCount: 37,
  lowReuseClipCount: 17,
  minimumClipSeconds: 2,
  confirmedSubtitleFrames: 0,
  categories: {
    "01_人物穿搭": 17,
    "02_整体展示": 4,
    "03_细节讲解": 7,
    "05_动作展示": 5,
    "91_上衣相关": 4
  }
});

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function filesBelow(directory, extension = ".mp4") {
  const result = [];
  async function walk(current) {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(target);
      else if (entry.isFile() && path.extname(entry.name).toLowerCase() === extension) result.push(target);
    }
  }
  await walk(directory);
  return result;
}

function check(name, actual, expected, checks) {
  const passed = JSON.stringify(actual) === JSON.stringify(expected);
  checks.push({ name, passed, actual, expected });
  return passed;
}

async function runGoldenRegression(rootDirectory, options = {}) {
  const reportDirectory = path.join(rootDirectory, "04_分析报告");
  const classification = await readJson(path.join(reportDirectory, "分类清单.json"));
  const integrity = await readJson(path.join(reportDirectory, "最终输出完整性复核.json"));
  const batchConfig = await readJson(path.join(reportDirectory, "批次配置.json"));
  const reusableFiles = await filesBelow(path.join(rootDirectory, "05_分类素材"));
  const lowReuseFiles = await filesBelow(path.join(rootDirectory, "03_低复用待复核"));
  const masterFiles = await filesBelow(path.join(rootDirectory, "02_去字后素材"));
  const checks = [];

  check("原视频数量", batchConfig.items.length, EXPECTED.sourceCount, checks);
  check("去字母版数量", masterFiles.length, EXPECTED.masterCount, checks);
  check("可复用片段数量", reusableFiles.length, EXPECTED.reusableClipCount, checks);
  check("低复用待复核数量", lowReuseFiles.length, EXPECTED.lowReuseClipCount, checks);
  check("机器报告可复用数量", classification.reusableClipCount, EXPECTED.reusableClipCount, checks);
  check("机器报告低复用数量", classification.lowReuseClipCount, EXPECTED.lowReuseClipCount, checks);
  check("最短片段时长", integrity.classification.minimumClipSeconds, EXPECTED.minimumClipSeconds, checks);
  check("确认字幕残留帧", integrity.captionQa.confirmedSubtitleFrames, EXPECTED.confirmedSubtitleFrames, checks);
  check("原片哈希与大小未改变", integrity.sourceIntegrity.sha256AndSizeUnchanged, EXPECTED.sourceCount, checks);

  const categories = Object.fromEntries(integrity.classification.categories.map((item) => [item.category, item.count]));
  check("分类分布", categories, EXPECTED.categories, checks);

  const masterProbes = [];
  for (const filePath of masterFiles.sort()) {
    const info = await probeVideo(filePath);
    masterProbes.push({
      file: path.basename(filePath),
      width: info.width,
      height: info.height,
      videoCodec: info.videoCodec,
      frameRate: info.frameRate,
      duration: Number(info.duration.toFixed(3)),
      formatPassed: info.width === 1080 && info.height === 1920 && info.videoCodec === "h264" && info.frameRate === "30/1"
    });
  }
  check("8 条母版格式", masterProbes.filter((item) => item.formatPassed).length, EXPECTED.masterCount, checks);
  const clipDurations = [];
  for (const filePath of reusableFiles.sort()) {
    const info = await probeVideo(filePath);
    clipDurations.push({ file: path.basename(filePath), duration: Number(info.duration.toFixed(3)) });
  }
  const minimumActualClipSeconds = clipDurations.length ? Math.min(...clipDurations.map((item) => item.duration)) : 0;
  check("37 条实际切片全部不少于 2 秒", clipDurations.filter((item) => item.duration >= 1.999).length, EXPECTED.reusableClipCount, checks);
  check("实际最短片段时长", minimumActualClipSeconds, EXPECTED.minimumClipSeconds, checks);

  const runtime = await inspectCaptionRepairRuntime({}, options);
  check("OpenCV 4fps 检测可用", runtime.auditAvailable, true, checks);
  check("LaMa 修复可用", runtime.repairAvailable, true, checks);
  check("CUDA 加速可用", runtime.acceleration, "cuda", checks);

  const v08 = masterFiles.find((file) => path.basename(file).startsWith("v08_"));
  const v08Audit = v08 ? await auditVideoCaptions(v08, runtime, { sampleFps: 4, ...options }) : null;
  check("软件桥接复核 v08 无字幕候选", Number(v08Audit?.positiveFrames || 0), 0, checks);

  let repairSmoke = { status: "not_requested" };
  if (options.smokeRepair) {
    const firstSource = batchConfig.items[0]?.source;
    const sourceAudit = await auditVideoCaptions(firstSource, runtime, { sampleFps: 4, ...options });
    const firstHit = sourceAudit.samples?.[0]?.time;
    if (Number.isFinite(Number(firstHit))) {
      const start = Math.max(0, Number(firstHit) - 0.5);
      const end = Math.min(Number(sourceAudit.durationSeconds || start + 2.5), start + 2.5);
      const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "caiku-golden-repair-"));
      const outputPath = path.join(temporaryDirectory, "caption-repair-smoke.mp4");
      try {
        await repairCaptionRanges(firstSource, outputPath, [{ start, end }], runtime, { keepRanges: [{ start, end }], ...options });
        const afterAudit = await auditVideoCaptions(outputPath, runtime, { sampleFps: 4, ...options });
        repairSmoke = {
          status: afterAudit.positiveFrames === 0 ? "passed" : "failed",
          source: firstSource,
          range: { start: Number(start.toFixed(3)), end: Number(end.toFixed(3)) },
          beforePositiveFrames: sourceAudit.positiveFrames,
          afterPositiveFrames: afterAudit.positiveFrames,
          checkedFrames: afterAudit.checkedFrames
        };
        check("代表片段经软件 LaMa 桥接后无字幕候选", afterAudit.positiveFrames, 0, checks);
      } finally {
        await fs.rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {});
      }
    } else {
      repairSmoke = { status: "skipped_no_detector_hit", source: firstSource };
      checks.push({ name: "代表片段 LaMa 修复冒烟", passed: false, actual: repairSmoke.status, expected: "passed" });
    }
  }

  const result = {
    standardVersion: "fashion-video-standard-2026.08.22",
    generatedAt: new Date().toISOString(),
    rootDirectory,
    status: checks.every((item) => item.passed) ? "passed" : "failed",
    expected: EXPECTED,
    runtime: {
      auditAvailable: runtime.auditAvailable,
      repairAvailable: runtime.repairAvailable,
      acceleration: runtime.acceleration,
      opencvVersion: runtime.opencvVersion || null,
      torchVersion: runtime.torchVersion || null
    },
    v08Audit: v08Audit ? { checkedFrames: v08Audit.checkedFrames, positiveFrames: v08Audit.positiveFrames, sampleFps: v08Audit.sampleFps } : null,
    repairSmoke,
    masterProbes,
    clipDurationSummary: { count: clipDurations.length, minimumSeconds: minimumActualClipSeconds },
    checks
  };
  const outputPath = options.outputPath || path.join(reportDirectory, "软件黄金回归_v0.1.20.json");
  await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return { ...result, outputPath };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const rootIndex = args.indexOf("--root");
  const rootDirectory = rootIndex >= 0 ? args[rootIndex + 1] : "D:/桌面/抖音素材/裁库批处理_老钱风西裤_20260822";
  runGoldenRegression(path.resolve(rootDirectory), { smokeRepair: args.includes("--smoke-repair") }).then((result) => {
    console.log(JSON.stringify({ status: result.status, outputPath: result.outputPath, failed: result.checks.filter((item) => !item.passed) }, null, 2));
    if (result.status !== "passed") process.exitCode = 1;
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { EXPECTED, runGoldenRegression };
