const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeAiSettings,
  parseJsonContent,
  testQwenConnection,
  validateCompetitorAnalysis,
  validateOutputAudit,
  validateClassification
} = require("../electron/services/ai-classifier.cjs");

test("AI 设置会限制抽帧数与低置信度阈值", () => {
  const value = normalizeAiSettings({ framesPerClip: 99, confidenceThreshold: 0.2, region: "international" });
  assert.equal(value.framesPerClip, 8);
  assert.equal(value.confidenceThreshold, 0.5);
  assert.equal(value.region, "international");
});

test("成片大模型质检会规范风险状态和一致性分数", () => {
  const result = validateOutputAudit({
    status: "blocked",
    alignmentScore: 122,
    summary: "画面字幕出现无法证实的保证性承诺",
    issues: [{ level: "block", name: "保证性表达", detail: "画面出现百分百显瘦" }]
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.alignmentScore, 100);
  assert.equal(result.issues[0].level, "block");
});

test("竞品分析会生成不低于 2 秒且可编辑的脚本段落", () => {
  const result = validateCompetitorAnalysis({
    title: "阔腿裤竞品结构",
    voiceMode: "music_only",
    blocks: [
      { name: "上身开场", duration: 1.2, type: "outfit", visualInstruction: "正面全身" },
      { name: "腰头特写", duration: 3, type: "detail", visibleText: "高腰显腿长" }
    ]
  }, 8);
  assert.equal(result.voiceMode, "music_only");
  assert.ok(result.blocks.every((block) => block.duration >= 2));
  assert.ok(result.blocks.every((block) => block.voiceEnabled === false));
  assert.equal(result.blocks[1].subtitleText, "高腰显腿长");
});

test("千问 JSON 结果支持代码块并触发低置信度复核", () => {
  const parsed = parseJsonContent('```json\n{"type":"detail","confidence":0.72,"title":"腰头细节","tags":["腰头"],"reason":"镜头集中在裤腰","detected":{"person":true},"needsReview":false}\n```');
  const result = validateClassification(parsed, { confidenceThreshold: 0.85 });
  assert.equal(result.type, "detail");
  assert.equal(result.needsReview, true);
  assert.equal(result.reason, "镜头集中在裤腰");
});

test("未知素材分类会被拒绝而不是静默写入错误目录", () => {
  assert.throws(
    () => validateClassification({ type: "pants", confidence: 0.9 }, {}),
    (error) => error.code === "AI_INVALID_CATEGORY"
  );
});

test("连接测试调用 OpenAI 兼容接口并返回模型延迟", async () => {
  let capturedBody;
  const fetchImpl = async (_url, options) => {
    capturedBody = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: '{"status":"ok"}' } }] })
    };
  };
  const result = await testQwenConnection({
    settings: { model: "qwen3.5-flash", region: "china" },
    apiKey: "test-key",
    fetchImpl
  });
  assert.equal(result.connected, true);
  assert.equal(result.model, "qwen3.5-flash");
  assert.equal(capturedBody.response_format.type, "json_object");
});
