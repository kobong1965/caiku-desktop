const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "prototype", "v1", "index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "prototype", "v1", "app.js"), "utf8");
const bridge = fs.readFileSync(path.join(root, "prototype", "v1", "desktop-bridge.js"), "utf8");

test("结果工作台明确区分已生成候选可投放和待修改", () => {
  assert.match(html, /候选成片/);
  assert.match(html, />可投放</);
  assert.match(html, /已生成 · 待修改/);
  assert.match(app, /ready_100/);
  assert.match(app, /repair_required/);
  assert.match(bridge, /manual_review/);
  assert.match(app, /已生成 · 待修改/);
});

test("桌面结果使用十二维评分而不是旧四项假通过", () => {
  assert.match(bridge, /scoreBreakdown/);
  assert.match(bridge, /hardBlockers/);
  assert.match(bridge, /repairActions/);
  assert.match(bridge, /候选成片任务已完成/);
  assert.match(bridge, /可投放.*待修改/);
});

test("风险计划可先生成候选且评分只决定可投放", () => {
  assert.match(html, /100 分只决定成片是否进入可投放目录，不会阻止候选成片生成/);
  assert.match(app, /const canConfirm = !stale && plan\.rejected !== true && decisions\.length > 0/);
  assert.doesNotMatch(bridge, /剪辑计划必须全部是直接证据且可执行/);
  assert.match(bridge, /allowComplianceOverride: true/);
  assert.match(bridge, /qualityMode: true/);
});

test("风险词、未试听配音和缺音乐只记录提示不中断候选生成", () => {
  const complianceBranch = bridge.match(/if \(complianceReport\.status === "blocked"\) \{[\s\S]*?\n      \}/)?.[0] || "";
  const voiceBranch = bridge.match(/if \(!musicOnly && !appState\.voices\.length && appState\.voicePreviewApproved !== true\) \{[\s\S]*?\n    \}/)?.[0] || "";
  const musicBranch = bridge.match(/if \(musicOnly && !musicFile\) \{[\s\S]*?\n    \}/)?.[0] || "";
  assert.match(complianceBranch, /仍会先生成候选/);
  assert.doesNotMatch(complianceBranch, /return/);
  assert.match(voiceBranch, /将先生成候选并在结果中标为待听感复核/);
  assert.doesNotMatch(voiceBranch, /return/);
  assert.match(musicBranch, /生成静音候选/);
  assert.doesNotMatch(musicBranch, /return/);
});

test("缺少输入和低于两秒等技术性错误仍会停止任务", () => {
  assert.match(bridge, /请先连接真实素材批次，并选择脚本和画面素材[\s\S]*?return/);
  assert.match(bridge, /所选素材包含低于 2 秒的片段，已阻止混剪[\s\S]*?return/);
});
