const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("大模型设置页提供三种运行方式与分工模型", () => {
  const html = read("prototype/v1/index.html");
  assert.match(html, /id="aiExecutionModeSelect"/);
  assert.match(html, /value="smart"[^>]*>智能混合/);
  assert.match(html, /value="cloud_accuracy"[^>]*>云端高精度/);
  assert.match(html, /value="local_private"[^>]*>本地隐私/);
  assert.match(html, /id="qwenEditorModelSelect"/);
  assert.match(html, /id="qwenReviewerModelSelect"/);
  assert.match(html, /id="localEditorModelInput"/);
  assert.match(html, /id="allowPremiumEscalation"/);
  assert.match(html, /素材不出机/);
});

test("页面会保存路由设置并展示实际剪辑模型", () => {
  const bridge = read("prototype/v1/desktop-bridge.js");
  const app = read("prototype/v1/app.js");
  assert.match(bridge, /aiRouting:/);
  assert.match(bridge, /aiExecutionModeSelect/);
  assert.match(bridge, /qwenEditorModelSelect/);
  assert.match(bridge, /plan\.provider/);
  assert.match(app, /plan\.provider/);
});

test("服装剪辑师 Skill 随应用打包并由运行时加载", () => {
  const pkg = JSON.parse(read("package.json"));
  const skill = read("skills/caiku-fashion-editor/SKILL.md");
  const editor = read("electron/services/ai-editor-service.cjs");
  assert.ok(pkg.build.files.includes("skills/**/*"));
  assert.doesNotMatch(skill, /TODO/);
  assert.match(skill, /素材证据/);
  assert.match(skill, /诚实替代/);
  assert.match(editor, /caiku-fashion-editor/);
});
