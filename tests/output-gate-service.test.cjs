const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { evaluateAudioMetrics, parseAudioMetrics } = require("../electron/services/audio-quality-service.cjs");
const { destinationKey, finalizeCandidateOutput, outputDirectories } = require("../electron/services/output-gate-service.cjs");

test("解析响度峰值和长静音指标", () => {
  const metrics = parseAudioMetrics("I: -14.0 LUFS\nPeak: -1.5 dBFS\nsilence_duration: 2.0", 20);
  assert.deepEqual(metrics, { integratedLufs: -14, peakDb: -1.5, silenceSeconds: 2, silenceRatio: 0.1 });
  assert.equal(evaluateAudioMetrics(metrics).status, "pass");
});

test("响度、峰值或长静音超标会阻断", () => {
  const result = evaluateAudioMetrics({ integratedLufs: -20, peakDb: -0.2, silenceRatio: 0.5 });
  assert.equal(result.status, "blocked");
  assert.equal(result.score, 0);
  assert.equal(result.reasons.length, 3);
});

test("发布状态映射到可投放、待修复和已阻断目录", () => {
  assert.equal(destinationKey("ready_100"), "ready");
  assert.equal(destinationKey("repair_required"), "repair");
  assert.equal(destinationKey("manual_review"), "repair");
  assert.equal(destinationKey("blocked"), "repair");
});

test("只有 ready_100 候选片会原子移动到可投放目录", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "caiku-output-gate-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dirs = outputDirectories(root);
  await fs.mkdir(dirs.candidate, { recursive: true });
  const videoPath = path.join(dirs.candidate, "candidate.mp4");
  const reportPath = path.join(root, "质检报告", "candidate.json");
  await fs.writeFile(videoPath, "video");
  const result = await finalizeCandidateOutput({ filePath: videoPath, reportPath }, { status: "ready_100", totalScore: 100 }, root);
  assert.equal(result.destination, "ready");
  assert.equal(result.publishReady, true);
  assert.match(result.filePath, /成片[\\/]可投放/);
  const savedReport = JSON.parse(await fs.readFile(reportPath, "utf8"));
  assert.equal(savedReport.outputPath, result.filePath);
  assert.equal(savedReport.destination, "ready");
  await assert.rejects(() => fs.access(videoPath));
});

test("已成功渲染但质量低分的视频保存到待修复而不是可投放", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "caiku-output-draft-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dirs = outputDirectories(root);
  await fs.mkdir(dirs.candidate, { recursive: true });
  const videoPath = path.join(dirs.candidate, "low-score.mp4");
  const reportPath = path.join(root, "质检报告", "low-score.json");
  await fs.writeFile(videoPath, "video");
  const result = await finalizeCandidateOutput({ filePath: videoPath, reportPath }, {
    status: "blocked",
    totalScore: 42,
    hardBlockers: [{ dimension: "compliance", message: "文案待修改" }]
  }, root);
  assert.equal(result.destination, "repair");
  assert.equal(result.publishReady, false);
  assert.equal(result.report.generatedAsDraft, true);
  assert.equal(result.report.generationPolicy, "generate_then_repair");
  assert.match(result.filePath, /成片[\\/]待修复/);
});
