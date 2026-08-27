const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const {
  createEditingFeedbackService,
  stripQianchuanData
} = require("../electron/services/editing-feedback-service.cjs");

async function withService(run) {
  const materialRoot = await fs.mkdtemp(path.join(os.tmpdir(), "caiku-feedback-"));
  let tick = 0;
  const service = createEditingFeedbackService({
    materialRoot,
    now: () => `2026-08-23T01:00:0${tick++}.000Z`,
    idFactory: () => `feedback-${tick}`
  });
  try { await run(service); } finally { await fs.rm(materialRoot, { recursive: true, force: true }); }
}

test("接受、换镜、改切点和改文案都按版本追加保存", async () => {
  await withService(async (service) => {
    await service.record({ caseId: "case-1", planId: "plan-1", action: "accept", rating: 5, reason: "逻辑顺" });
    await service.record({ caseId: "case-1", planId: "plan-1", action: "change_material", before: { materialId: "m1" }, after: { materialId: "m2" }, reason: "细节更对应" });
    await service.record({ caseId: "case-1", planId: "plan-1", action: "change_cut", before: { duration: 4 }, after: { duration: 3 } });
    await service.record({ caseId: "case-1", planId: "plan-1", action: "change_text", before: { text: "旧文案" }, after: { text: "新文案" } });
    const records = await service.list("case-1");
    assert.deepEqual(records.map((item) => item.version), [1, 2, 3, 4]);
    assert.deepEqual(records.map((item) => item.action), ["accept", "change_material", "change_cut", "change_text"]);
    assert.equal(records[1].after.materialId, "m2");
  });
});

test("反馈可软删除但不覆盖历史", async () => {
  await withService(async (service) => {
    const saved = await service.record({ caseId: "case-1", action: "reject", rating: 2, reason: "前后跳题" });
    await service.remove(saved.id);
    assert.equal((await service.list("case-1")).length, 0);
    const history = await service.history(saved.id);
    assert.deepEqual(history.map((item) => item.status), ["active", "deleted"]);
  });
});

test("千川、ROI 和投放表现字段不会进入剪辑反馈库", async () => {
  await withService(async (service) => {
    const saved = await service.record({
      caseId: "case-1",
      action: "accept",
      rating: 5,
      performanceFeedback: { roi: 3.2, ctr: 4.1 },
      after: { text: "保留文案", qianchuan: { impressions: 1000 }, spend: 200 }
    });
    const serialized = JSON.stringify(saved);
    assert.match(serialized, /保留文案/);
    assert.doesNotMatch(serialized, /roi|ctr|qianchuan|impressions|spend|performanceFeedback/i);
  });
  assert.deepEqual(stripQianchuanData({ text: "保留", roi: 2, nested: { ctr: 4, value: 1 } }), { text: "保留", nested: { value: 1 } });
});

test("主进程创建剪辑计划时不再读取千川反馈仓库", async () => {
  const mainSource = await fs.readFile(path.join(__dirname, "..", "electron", "main.cjs"), "utf8");
  const editorBlock = mainSource.slice(mainSource.indexOf('safeHandle("editor:plan"'), mainSource.indexOf('safeHandle("voice:preview"'));
  assert.doesNotMatch(editorBlock, /qianchuanFeedbackRepository|buildPerformanceInsights/);
  assert.match(editorBlock, /_ignoredPerformanceFeedback/);
});
