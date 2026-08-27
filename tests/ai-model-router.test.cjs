const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DEFAULT_AI_ROUTING_SETTINGS,
  buildTaskRoute,
  normalizeAiRoutingSettings,
  shouldEscalateToReviewer
} = require("../electron/services/ai-model-router.cjs");

test("混合路由默认使用固定快照模型", () => {
  assert.equal(DEFAULT_AI_ROUTING_SETTINGS.mode, "smart");
  assert.equal(DEFAULT_AI_ROUTING_SETTINGS.classificationModel, "qwen3.7-flash-2026-07-15");
  assert.equal(DEFAULT_AI_ROUTING_SETTINGS.editorModel, "qwen3.7-plus-2026-05-26");
  assert.equal(DEFAULT_AI_ROUTING_SETTINGS.reviewerModel, "qwen3.8-max");
  assert.equal(DEFAULT_AI_ROUTING_SETTINGS.localModel, "qwen3.5:latest");
});

test("智能混合有密钥时云端主跑并保留本地兜底", () => {
  const route = buildTaskRoute("editor", { settings: {}, hasApiKey: true });
  assert.deepEqual(route.primary, { provider: "qwen", model: "qwen3.7-plus-2026-05-26" });
  assert.deepEqual(route.fallback, { provider: "ollama", model: "qwen3.5:latest" });
  assert.deepEqual(route.reviewer, { provider: "qwen", model: "qwen3.8-max" });
});

test("智能混合无密钥与本地隐私模式都只走本机", () => {
  const noKey = buildTaskRoute("classification", { settings: {}, hasApiKey: false });
  const privateRoute = buildTaskRoute("competitor", { settings: { mode: "local_private" }, hasApiKey: true });
  assert.equal(noKey.primary.provider, "ollama");
  assert.equal(noKey.fallback, null);
  assert.equal(privateRoute.primary.provider, "ollama");
  assert.equal(privateRoute.fallback, null);
  assert.equal(privateRoute.reviewer, null);
});

test("云端高精度没有密钥时会在任务开始前阻止执行", () => {
  assert.throws(
    () => buildTaskRoute("classification", { settings: { mode: "cloud_accuracy" }, hasApiKey: false }),
    (error) => error.code === "AI_KEY_REQUIRED"
  );
});

test("本地端点只允许环回地址且疑难条件才升级 Max", () => {
  assert.throws(
    () => normalizeAiRoutingSettings({ localEndpoint: "https://example.com/ollama" }),
    (error) => error.code === "AI_LOCAL_ENDPOINT_NOT_LOCAL"
  );
  assert.equal(shouldEscalateToReviewer({ confidence: 0.91, conflicts: [], executable: true }, {}), false);
  assert.equal(shouldEscalateToReviewer({ confidence: 0.61, conflicts: [], executable: true }, {}), true);
  assert.equal(shouldEscalateToReviewer({ confidence: 0.92, conflicts: ["镜头角色冲突"], executable: true }, {}), true);
});
