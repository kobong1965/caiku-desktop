const test = require("node:test");
const assert = require("node:assert/strict");
const { createRepairPlan, MAX_AUTOMATIC_REPAIR_ATTEMPTS } = require("../electron/services/repair-planner-service.cjs");

test("满分成片不需要修复", () => {
  assert.equal(createRepairPlan({ status: "ready_100" }).status, "not_required");
});

test("错款字幕和重复问题转成不同修复动作", () => {
  const plan = createRepairPlan({
    status: "blocked",
    hardBlockers: [
      { dimension: "productIdentity", message: "画面出现错误商品" },
      { dimension: "captionCleanliness", message: "原字幕残留" },
      { dimension: "diversity", message: "开头相同" }
    ]
  });
  assert.equal(plan.status, "auto_repair_available");
  assert.deepEqual(plan.actions.map((item) => item.type), ["replace_material", "rerender_caption", "regenerate_variant"]);
});

test("同一问题最多自动修复三轮", () => {
  const plan = createRepairPlan({ status: "blocked", hardBlockers: [{ dimension: "audio", message: "响度超标" }] }, MAX_AUTOMATIC_REPAIR_ATTEMPTS);
  assert.equal(plan.status, "manual_review");
  assert.equal(plan.nextAttempt, null);
  assert.equal(plan.actions[0].automatic, false);
});
