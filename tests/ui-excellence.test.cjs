const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("应用壳只补偿一次标题栏并把滚动限制在主内容", () => {
  const css = read("prototype/v1/styles.css");
  assert.match(css, /html, body \{[^}]*height:\s*100%[^}]*overflow:\s*hidden/s);
  assert.match(css, /\.app-shell \{[^}]*height:\s*calc\(100vh - var\(--titlebar-height\)\)/s);
  assert.match(css, /\.workflow-sidebar \{[^}]*top:\s*0/s);
  assert.match(css, /\.workspace \{[^}]*display:\s*flex[^}]*overflow:\s*hidden/s);
  assert.match(css, /main \{[^}]*overflow:\s*auto/s);
});

test("业务文字不使用低于 12px 的字号", () => {
  const css = read("prototype/v1/styles.css");
  const sizes = [...css.matchAll(/font-size:\s*([0-9.]+)px/g)].map((match) => Number(match[1]));
  const tooSmall = sizes.filter((size) => size > 0 && size < 12);
  assert.deepEqual(tooSmall, []);
});

test("素材表和脚本段落为高频操作保留稳定布局", () => {
  const css = read("prototype/v1/styles.css");
  const app = read("prototype/v1/app.js");
  assert.match(css, /\.material-table-head, \.material-row \{[^}]*132px/s);
  assert.match(css, /\.material-actions button \{[^}]*white-space:\s*nowrap/s);
  assert.match(app, /class="block-header"/);
  assert.match(app, /class="block-fields block-fields-copy"/);
  assert.match(css, /\.script-block-row \.asset-delete \{[^}]*white-space:\s*nowrap/s);
});

test("空状态和零选择操作不会显示为可执行", () => {
  const html = read("prototype/v1/index.html");
  const app = read("prototype/v1/app.js");
  assert.match(html, /id="confirmMaterialPicker"[^>]*disabled/);
  assert.match(html, /id="repairAllOutputs"[^>]*disabled/);
  assert.match(html, /id="exportPassedOutputs"[^>]*disabled/);
  assert.match(app, /confirmMaterialPicker\.disabled = materialPickerSelection\.size === 0/);
  assert.match(app, /repairButton\.disabled = risk === 0/);
  assert.match(app, /exportButton\.disabled = !appState\.outputs\.length \|\| risk > 0/);
});

test("素材选择器具备搜索筛选全选并使用真实导航文案", () => {
  const html = read("prototype/v1/index.html");
  const app = read("prototype/v1/app.js");
  assert.match(html, /id="materialPickerSearch"/);
  assert.match(html, /id="materialPickerCategory"/);
  assert.match(html, /id="selectAllPickerMaterials"/);
  assert.match(html, />进入混剪</);
  assert.match(app, /function renderMaterialPicker/);
});

test("锁定设置不伪装成禁用复选框且固定导出页不显示保存操作", () => {
  const html = read("prototype/v1/index.html");
  const app = read("prototype/v1/app.js");
  assert.match(html, /class="enforced-rule-row"/);
  assert.doesNotMatch(html, /data-settings-pane="ai-review"[\s\S]*?<input type="checkbox" checked disabled>/);
  assert.match(html, /id="settingsFooter"/);
  assert.match(app, /settingsFooter\.hidden = \["ai-review", "performance", "export", "updates"\]\.includes/);
});
