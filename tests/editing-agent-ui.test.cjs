const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("AI 编排展示人工分类清单、用户案例、逐句角色和逻辑门禁", () => {
  const html = read("prototype/v1/index.html");
  const app = read("prototype/v1/app.js");
  assert.match(html, /id="aiEditorCatalogSummary"/);
  assert.match(html, /id="aiEditorLearningSummary"/);
  assert.match(html, /id="rejectAiEditorPlan"/);
  assert.match(app, /catalog\.categoryCounts/);
  assert.match(app, /sentenceIntent\.requiredMaterialTypes/);
  assert.match(app, /plan\.narrativeContinuity/);
  assert.match(app, /recordEditingFeedback/);
  assert.match(app, /system_recheck/);
  assert.match(app, /script_adjustment/);
  assert.match(app, /material_gap/);
  assert.match(app, /evidence_gap/);
  assert.match(app, /问题已按原因分开/);
  assert.match(app, /role="status" aria-live="polite"/);
  assert.match(app, /只有“确实缺少素材”才需要补拍或上传/);
});

test("桌面端从人工确认 manifest 读取清单并只应用用户勾选", () => {
  const bridge = read("prototype/v1/desktop-bridge.js");
  const main = read("electron/main.cjs");
  assert.match(bridge, /catalogRequest: \{ sku, manifestPaths, humanConfirmed: true \}/);
  assert.match(bridge, /selectedMaterialIds: materials\.map/);
  assert.match(main, /readClassifiedMaterialCatalog/);
  assert.match(main, /audit: catalog\.audit/);
  assert.doesNotMatch(main.match(/safeHandle\("editor:plan"[\s\S]*?safeHandle\("voice:preview"/)?.[0] || "", /eligibleForMix|captionStatus|productIdentity/);
});

test("市场脚本学习 IPC 支持本地案例、金标、回收和暂停", () => {
  const preload = read("electron/preload.cjs");
  const main = read("electron/main.cjs");
  const app = read("prototype/v1/app.js");
  assert.match(preload, /analyzeMarketScript/);
  assert.match(preload, /markEditingTrainingCaseGold/);
  assert.match(preload, /deleteEditingTrainingCase/);
  assert.match(main, /sourceType: "user_uploaded_reference"/);
  assert.match(main, /editing-training:mark-gold/);
  assert.match(app, /window\.caiku\.cancelTask/);
});
