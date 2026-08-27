const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("素材混剪页提供本地 AI 剪辑师规划、预览和确认入口", () => {
  const html = read("prototype/v1/index.html");
  assert.match(html, /id="planWithAiEditor"/);
  assert.match(html, /id="aiEditorPlanPreview"[^>]*aria-live="polite"/);
  assert.match(html, /id="confirmAiEditorPlan"/);
  assert.match(html, /id="aiEditorPlanStatus"/);
  assert.match(html, /id="readinessPlan"/);
});

test("桌面桥通过安全 IPC 创建计划并要求确认后生成", () => {
  const preload = read("electron/preload.cjs");
  const bridge = read("prototype/v1/desktop-bridge.js");
  assert.match(preload, /createEditingPlan: \(payload\) => invoke\("editor:plan", payload\)/);
  assert.match(bridge, /desktop\.createEditingPlan/);
  assert.match(bridge, /requireEditingPlan: true/);
  assert.match(bridge, /editingPlan: appState\.editingPlan/);
  assert.match(bridge, /editingPlan: appState\.editingPlan/);
});

test("AI 剪辑计划随工程状态保存并在输入变化时标记过期", () => {
  const app = read("prototype/v1/app.js");
  const bridge = read("prototype/v1/desktop-bridge.js");
  assert.match(app, /editingPlan: null/);
  assert.match(app, /function isEditingPlanStale/);
  assert.match(bridge, /editingPlan: appState\.editingPlan/);
  assert.match(bridge, /saved\.editingPlan/);
});

test("用户投喂视频会把可复用剪辑配方保存到脚本", () => {
  const app = read("prototype/v1/app.js");
  assert.match(app, /editingRecipe:/);
  assert.match(app, /patterns: recipe\.editingTechniques/);
  assert.match(app, /visibleTexts: result\.visibleTexts/);
  assert.match(app, /sourceType: "user_uploaded_market_script"/);
});
