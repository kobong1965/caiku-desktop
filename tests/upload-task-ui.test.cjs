const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("桌面窗口使用无边框模式并只通过安全 IPC 控制窗口", () => {
  const main = read("electron/main.cjs");
  const preload = read("electron/preload.cjs");
  const html = read("prototype/v1/index.html");
  assert.match(main, /frame: false/);
  assert.match(main, /safeHandle\("window:minimize"/);
  assert.match(main, /safeHandle\("window:toggle-maximize"/);
  assert.match(main, /safeHandle\("window:close"/);
  assert.match(preload, /minimizeWindow: \(\) => invoke\("window:minimize"\)/);
  assert.match(preload, /toggleMaximizeWindow: \(\) => invoke\("window:toggle-maximize"\)/);
  assert.match(html, /id="windowTitlebar"/);
  assert.match(html, /data-window-action="minimize"/);
  assert.match(html, /data-window-action="maximize"/);
  assert.match(html, /data-window-action="close"/);
});

test("上传完成后点击分析会打开款号选择窗口再执行后台处理", () => {
  const html = read("prototype/v1/index.html");
  const bridge = read("prototype/v1/desktop-bridge.js");
  const preload = read("electron/preload.cjs");
  assert.match(html, /id="skuPickerDialog"/);
  assert.match(html, /id="skuOptionList"/);
  assert.match(html, /id="newSkuInput"/);
  assert.match(html, /id="confirmSkuAnalysis"/);
  assert.doesNotMatch(html, /id="simpleSkuInput"/);
  assert.match(bridge, /startAnalysisButton, #simpleStartAnalysis"\)\) openSkuPickerDialog\(\)/);
  assert.match(bridge, /confirmSkuAndStart/);
  assert.match(bridge, /await desktop\.listSkuOptions\(\)/);
  assert.match(preload, /listSkuOptions: \(\) => invoke\("sku:list"\)/);
});

test("任务板显示今日分类计数并可刷新和打开批次目录", () => {
  const html = read("prototype/v1/index.html");
  const app = read("prototype/v1/app.js");
  const bridge = read("prototype/v1/desktop-bridge.js");
  const main = read("electron/main.cjs");
  assert.match(html, /data-route="tasks"/);
  assert.match(html, /id="todayMaterialCount"/);
  assert.match(html, /id="todayTaskList"[^>]*aria-live="polite"/);
  assert.match(html, /id="todayCategoryBreakdown"/);
  assert.match(app, /function renderTaskBoard/);
  assert.match(bridge, /desktop\.getTodayTasks\(\)/);
  assert.match(bridge, /\[data-open-task-dir\]/);
  assert.match(main, /classificationTasks: \[\]/);
  assert.match(main, /buildTodayTaskBoard/);
});
