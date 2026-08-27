const test = require("node:test");
const assert = require("node:assert/strict");
const {
  classifyFramesWithOllama,
  classificationPrompt,
  DEFAULT_AI_SETTINGS,
  normalizeSceneAnalysis,
  normalizeAiSettings,
  parseJsonContent,
  testQwenConnection,
  validateCompetitorAnalysis,
  validateOutputAudit,
  validateClassification
} = require("../electron/services/ai-classifier.cjs");

test("批量视觉分类默认升级到 qwen3.7-flash 稳定快照", () => {
  assert.equal(DEFAULT_AI_SETTINGS.model, "qwen3.7-flash-2026-07-15");
});

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

test("目标商品不匹配会强制进入复核并保留可审计证据", () => {
  const result = validateClassification({
    type: "outfit",
    confidence: 0.96,
    title: "灰色阔腿裤上身",
    productIdentity: {
      status: "mismatch",
      confidence: 0.93,
      observedColor: "灰色",
      reasons: ["目标资料是黑色直筒裤"]
    },
    shot: { size: "full", angle: "front", camera: "static" },
    actions: ["站立", "转身"],
    visibleTexts: [{ text: "全网第一显瘦", region: "top", kind: "sticker", confidence: 0.91 }],
    captionRegions: [{ x: -1, y: 0.8, width: 2, height: 0.15, confidence: 1.2 }],
    evidence: [{ claimCode: "elasticity", label: "弹力", status: "absent", observations: ["没有拉伸动作"] }]
  }, { confidenceThreshold: 0.85 }, { productProfile: { sku: "918", color: "黑色" } });
  assert.equal(result.productIdentity.status, "mismatch");
  assert.equal(result.productIdentity.targetSku, "918");
  assert.equal(result.needsReview, true);
  assert.equal(result.shot.size, "full");
  assert.deepEqual(result.actions, ["站立", "转身"]);
  assert.equal(result.visibleTexts[0].text, "全网第一显瘦");
  assert.deepEqual(result.captionRegions[0], { x: 0, y: 0.8, width: 1, height: 0.15, confidence: 1 });
  assert.equal(result.evidence[0].status, "absent");
});

test("没有目标资料时商品身份不能被模型猜成已匹配", () => {
  const analysis = normalizeSceneAnalysis({ productIdentity: { status: "matched", confidence: 1 } });
  assert.equal(analysis.productIdentity.status, "unknown");
  assert.equal(analysis.productIdentity.targetSku, "");
});

test("兼容模型把字幕与覆盖层返回在 detected 子字段", () => {
  const result = validateClassification({
    type: "detail",
    confidence: 0.93,
    detected: {
      visibleTexts: [{ text: "营销字幕", region: "center", kind: "subtitle", confidence: 0.96 }],
      captionRegions: [{ x: 0.1, y: 0.4, width: 0.8, height: 0.1, confidence: 0.96 }],
      overlayAssessment: {
        complexity: "complex_graphic",
        features: ["cutout", "sticker"],
        safeToInpaint: false,
        subjectOverlap: "high",
        reason: "人物抠图覆盖商品主体"
      }
    }
  });
  assert.equal(result.visibleTexts[0].text, "营销字幕");
  assert.equal(result.captionRegions.length, 1);
  assert.equal(result.overlayAssessment.complexity, "complex_graphic");
  assert.deepEqual(result.overlayAssessment.features, ["cutout", "sticker"]);
});

test("分类提示包含商品身份、OCR 区域和直接证据合同", () => {
  const prompt = classificationPrompt({
    duration: 4,
    productProfile: { sku: "918", name: "神裤", color: "黑色", allowedClaims: ["垂感"] },
    referenceImageCount: 2
  });
  assert.match(prompt, /目标商品资料/);
  assert.match(prompt, /918/);
  assert.match(prompt, /visibleTexts/);
  assert.match(prompt, /captionRegions/);
  assert.match(prompt, /overlayAssessment/);
  assert.match(prompt, /complex_graphic/);
  assert.match(prompt, /direct\/indirect\/absent\/unknown/);
});

test("上衣主体素材单独归类并保留复杂覆盖层判断", () => {
  const result = validateClassification({
    type: "upper_related",
    confidence: 0.95,
    title: "Polo 上衣展示",
    productIdentity: { status: "matched", confidence: 0.92 },
    overlayAssessment: {
      complexity: "complex_graphic",
      features: ["magnifier", "comparison_layer"],
      safeToInpaint: false,
      subjectOverlap: "high",
      reason: "放大镜覆盖上衣主体"
    }
  }, { confidenceThreshold: 0.85 }, { productProfile: { sku: "POLO-01" } });
  assert.equal(result.type, "upper_related");
  assert.equal(result.overlayAssessment.complexity, "complex_graphic");
  assert.equal(result.overlayAssessment.safeToInpaint, false);
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

test("Ollama 视觉分类只连接本机并记录本地模型", async (t) => {
  const os = require("node:os");
  const fs = require("node:fs/promises");
  const path = require("node:path");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "caiku-local-vision-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const frames = [path.join(dir, "1.jpg"), path.join(dir, "2.jpg")];
  await Promise.all(frames.map((file, index) => fs.writeFile(file, Buffer.from(`frame-${index}`))));
  let captured;
  const result = await classifyFramesWithOllama({
    framePaths: frames,
    duration: 4,
    sourceName: "走动展示.mp4",
    settings: { confidenceThreshold: 0.85 },
    localSettings: { endpoint: "http://127.0.0.1:11434", model: "qwen3.5:latest" },
    fetchImpl: async (url, options) => {
      assert.equal(url, "http://127.0.0.1:11434/api/chat");
      captured = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ message: { content: JSON.stringify({
          type: "action", confidence: 0.88, title: "走动转身", tags: ["走动"],
          reason: "人物正在走动展示裤装", detected: { actions: ["走动"] }, needsReview: false
        }) } })
      };
    }
  });
  assert.equal(result.provider, "ollama");
  assert.equal(result.model, "qwen3.5:latest");
  assert.equal(result.mode, "ollama_vision");
  assert.equal(captured.messages[1].images.length, 2);
});
