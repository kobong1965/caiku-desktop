const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("脚本预检与混剪执行共用最终播出文本检查", () => {
  const main = read("electron/main.cjs");
  const preload = read("electron/preload.cjs");
  const bridge = read("prototype/v1/desktop-bridge.js");
  const mix = read("electron/services/mix-engine.cjs");

  assert.match(main, /safeHandle\("compliance:check-script"/);
  assert.match(preload, /checkScript: \(script\) => invoke\("compliance:check-script", \{ script \}\)/);
  assert.ok((bridge.match(/desktop\.checkScript\(script\)/g) || []).length >= 2);
  assert.doesNotMatch(bridge, /function collectScriptText/);
  assert.match(mix, /const scriptCheck = checkScript\(renderScript\)/);
});

test("文案风险保留详情和定位入口但不再阻止候选生成", () => {
  const main = read("electron/main.cjs");
  const bridge = read("prototype/v1/desktop-bridge.js");
  const mix = read("electron/services/mix-engine.cjs");

  assert.match(main, /details: error\?\.details \|\| error\?\.report \|\| null/);
  assert.match(mix, /const scriptCheck = checkScript\(renderScript\)/);
  assert.doesNotMatch(mix, /createMixError\("脚本包含阻断级风险词/);
  assert.match(bridge, /allowComplianceOverride: true/);
  assert.match(bridge, /const report = error\?\.details \|\| error\?\.report \|\| null/);
  assert.match(bridge, /命中词：/);
  assert.match(bridge, /原句：/);
  assert.match(bridge, /去修改脚本/);
  assert.match(bridge, /openComplianceIssueInScript/);
  assert.match(bridge, /data-block-\$\{field\}/);
});
