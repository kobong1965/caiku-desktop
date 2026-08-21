const test = require("node:test");
const assert = require("node:assert/strict");
const { checkCoverage, checkText } = require("../electron/services/compliance-engine.cjs");

test("阻断疑似极限价与保证性表达", () => {
  const report = checkText("这是全网最低价，保证穿上一定显瘦");
  assert.equal(report.status, "blocked");
  assert.ok(report.issues.some((issue) => issue.term === "全网"));
  assert.ok(report.issues.some((issue) => issue.term === "保证"));
  assert.ok(report.issues.some((issue) => issue.term === "最低价"));
});

test("素材分类覆盖脚本段落", () => {
  const report = checkCoverage(
    { blocks: [{ category: "人物穿搭" }, { category: "细节讲解" }] },
    [{ typeLabel: "人物穿搭" }, { typeLabel: "细节讲解" }]
  );
  assert.equal(report.status, "pass");
  assert.deepEqual(report.missing, []);
});
