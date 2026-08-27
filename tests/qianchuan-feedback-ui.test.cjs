const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "prototype", "v1", "index.html"), "utf8");
const bridge = fs.readFileSync(path.join(root, "prototype", "v1", "desktop-bridge.js"), "utf8");
const preload = fs.readFileSync(path.join(root, "electron", "preload.cjs"), "utf8");

test("当前剪辑智能体界面不读取或展示千川投放反馈", () => {
  assert.doesNotMatch(html, /data-settings-tab="feedback"/);
  assert.doesNotMatch(html, /id="importQianchuanCsv"/);
  assert.doesNotMatch(html, /id="qianchuanFeedbackSummary"/);
  assert.doesNotMatch(html, /id="qianchuanFeedbackList"/);
  assert.doesNotMatch(bridge, /qianchuanFeedback/);
  assert.doesNotMatch(preload, /qianchuan:/);
});

test("当前版本改用接受拒绝和人工修改作为学习反馈", () => {
  assert.match(preload, /recordEditingFeedback/);
  assert.match(preload, /editing-feedback:record/);
  assert.match(preload, /deleteEditingFeedback/);
});
