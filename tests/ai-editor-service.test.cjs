const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildMaterialCapabilityCard,
  buildPlanningPrompt,
  createEditingPlan,
  applyStrictTimeline,
  detectEvidenceGaps,
  normalizeLocalEditorSettings,
  validateEditingPlan
} = require("../electron/services/ai-editor-service.cjs");

const script = {
  id: "script-1",
  name: "弹力测试",
  duration: 4,
  voiceMode: "full_voice",
  blocks: [{
    id: "block-1",
    name: "弹力证明",
    duration: 4,
    category: "动作展示",
    visualInstruction: "展示拉伸和下蹲",
    voiceText: "这条裤子特别有弹力，蹲下也不勒"
  }]
};

const materials = [
  {
    id: "material-a",
    name: "正面全身",
    type: "outfit",
    typeLabel: "人物穿搭",
    duration: 3,
    classificationTitle: "正面站立",
    classificationTags: ["全身", "宽松版型"],
    classificationReason: "人物正面站立并展示裤装",
    classificationDetected: { actions: ["站立"] }
  },
  {
    id: "material-b",
    name: "侧背转身",
    type: "action",
    typeLabel: "动作展示",
    duration: 3.5,
    classificationTitle: "侧面和背面",
    classificationTags: ["转身", "走动"],
    classificationReason: "人物自然走动后转身",
    classificationDetected: { actions: ["走动", "转身"] }
  }
];

test("本地剪辑师设置只接受环回地址", () => {
  assert.equal(normalizeLocalEditorSettings({ endpoint: "http://localhost:11434" }).endpoint, "http://localhost:11434");
  assert.throws(
    () => normalizeLocalEditorSettings({ endpoint: "https://example.com/api" }),
    (error) => error.code === "AI_EDITOR_ENDPOINT_NOT_LOCAL"
  );
});

test("素材能力卡保留视觉证据且不补造未知动作", () => {
  const card = buildMaterialCapabilityCard(materials[0]);
  assert.deepEqual(card.tags, ["全身", "宽松版型"]);
  assert.deepEqual(card.detected.actions, ["站立"]);
  assert.doesNotMatch(card.evidenceText, /拉伸|下蹲/);
});

test("素材能力卡把商品身份景别 OCR 和主张证据交给剪辑师", () => {
  const card = buildMaterialCapabilityCard({
    ...materials[0],
    productIdentity: { status: "matched", targetSku: "918", observedColor: "黑色" },
    shot: { size: "full", angle: "front", camera: "static" },
    actions: ["走动"],
    visibleTexts: [{ text: "高腰直筒" }],
    evidence: [{ claimCode: "silhouette", label: "高腰直筒", status: "direct", observations: ["正面全身可见"] }]
  });
  assert.equal(card.productIdentity.status, "matched");
  assert.equal(card.shot.size, "full");
  assert.deepEqual(card.actions, ["走动"]);
  assert.deepEqual(card.visibleTexts, ["高腰直筒"]);
  assert.match(card.evidenceText, /918/);
  assert.match(card.evidenceText, /direct/);
});

test("脚本要求拉伸和下蹲但素材没有证据时产生双重缺口", () => {
  const gaps = detectEvidenceGaps(script.blocks[0], materials.map(buildMaterialCapabilityCard));
  assert.deepEqual(gaps.map((item) => item.code), ["elasticity", "squat"]);
});

test("对标视频保存的剪辑思路会进入规划提示但不能覆盖素材证据", () => {
  const recipeScript = {
    ...script,
    editingRecipe: {
      summary: "前两秒动作钩子，随后正侧背展示",
      patterns: ["动作开场", "三秒一切"],
      visibleTexts: ["宽松显腿长"]
    }
  };
  const prompt = buildPlanningPrompt({
    script: recipeScript,
    materialCards: materials.map(buildMaterialCapabilityCard),
    projectName: "对标复用"
  });
  assert.match(prompt, /前两秒动作钩子/);
  assert.match(prompt, /三秒一切/);
  assert.match(prompt, /剪辑思路只能影响节奏和镜头角色/);
});

test("规划提示按逐句角色读取人工分类并引用用户投喂案例结构", () => {
  const marketScript = {
    id: "market-script",
    name: "西裤怎么搭",
    voiceMode: "full_voice",
    editingRecipe: {
      patternId: "question-hook-detail-outfit",
      blocks: [{ narrativeRole: "question_hook", materialType: "outfit" }]
    },
    blocks: [{ id: "market-b1", name: "问题开场", duration: 3, category: "人物穿搭", voiceText: "还有人不懂西裤怎么搭？" }]
  };
  const prompt = buildPlanningPrompt({
    script: marketScript,
    materialCards: [buildMaterialCapabilityCard({ ...materials[0], eligibleForMix: false, classificationNeedsReview: true })],
    projectName: "用户分类清单",
    retrievedCases: [{ caseId: "user-case-1", structuralRecipe: { patternId: "question-hook-detail-outfit", narrativeOrder: ["question_hook", "detail_evidence"] }, factReuseAllowed: false }]
  });
  assert.match(prompt, /人工确认的素材分类清单是唯一素材真相源/);
  assert.match(prompt, /question_hook/);
  assert.match(prompt, /user-case-1/);
  assert.doesNotMatch(prompt, /eligibleForMix/);
  assert.doesNotMatch(prompt, /captionVerification/);
});

test("当前剪辑规划忽略千川反馈输入", () => {
  const prompt = buildPlanningPrompt({
    script,
    materialCards: materials.map(buildMaterialCapabilityCard),
    projectName: "投放反馈复用",
    performanceFeedback: { sampleCount: 4, tagPerformance: [{ kind: "hook", label: "细节证据", samples: 4, roi: 2.6 }] }
  });
  assert.match(prompt, /本版本不读取、不使用千川反馈/);
  assert.doesNotMatch(prompt, /2\.6/);
  assert.doesNotMatch(prompt, /sampleCount/);
});

test("模型计划不能引用未勾选素材并强制暴露证据缺失", () => {
  const result = validateEditingPlan({
    summary: "用动作镜头证明弹力",
    decisions: [{
      blockId: "block-1",
      evidenceStatus: "direct",
      selectedMaterialIds: ["material-b", "material-outside"],
      rewriteRequired: false,
      suggestedVoiceText: "这条裤子特别有弹力",
      timeline: [
        { materialId: "material-outside", sourceStart: 0, duration: 2 },
        { materialId: "material-b", sourceStart: 2.5, duration: 4 }
      ]
    }]
  }, { script, materials, model: "qwen3.5:latest" });

  assert.equal(result.status, "review");
  assert.equal(result.decisions[0].evidenceStatus, "missing");
  assert.equal(result.decisions[0].rewriteRequired, true);
  assert.deepEqual(result.decisions[0].selectedMaterialIds, ["material-b"]);
  assert.ok(result.decisions[0].unsupportedClaims.includes("弹力/拉伸"));
  assert.ok(result.decisions[0].unsupportedClaims.includes("下蹲舒适"));
  assert.ok(result.decisions[0].timeline.every((item) => item.materialId === "material-b"));
  assert.ok(result.decisions[0].timeline.every((item) => item.sourceStart + item.duration <= 3.5 + 0.001));
  assert.equal(Number(result.decisions[0].timeline.reduce((sum, item) => sum + item.duration, 0).toFixed(3)), 4);
});

test("模型因证据缺失拒绝选镜时仍生成安全替代时间线", () => {
  const result = validateEditingPlan({
    summary: { text: "没有弹力和下蹲画面，改用走动镜头" },
    warnings: [{ message: "替代镜头只能证明宽松和走动" }],
    decisions: [{
      blockId: "block-1",
      evidenceStatus: "missing",
      selectedMaterialIds: [],
      unsupportedClaims: ["弹力", "蹲下不勒"],
      rewriteRequired: true,
      timeline: []
    }]
  }, { script, materials, model: "qwen3.5:latest" });
  assert.equal(result.status, "review");
  assert.equal(result.summary, "没有弹力和下蹲画面，改用走动镜头");
  assert.ok(result.decisions[0].selectedMaterialIds.length > 0);
  assert.equal(Number(result.decisions[0].timeline.reduce((sum, item) => sum + item.duration, 0).toFixed(3)), 4);
  assert.ok(result.warnings.some((item) => item.includes("替代镜头只能证明")));
  assert.ok(result.warnings.some((item) => item.includes("安全替代")));
});

test("100 分质量模式把计划收敛为 2–4 秒且素材全程唯一", () => {
  const strictScript = {
    id: "strict-script",
    name: "双段快剪",
    voiceMode: "music_only",
    blocks: [
      { id: "strict-a", name: "开场展示", duration: 4, category: "人物穿搭" },
      { id: "strict-b", name: "细节承接", duration: 4, category: "细节讲解" }
    ]
  };
  const strictMaterials = [
    { id: "strict-1", name: "穿搭一", type: "outfit", duration: 4.5 },
    { id: "strict-2", name: "细节一", type: "detail", duration: 4.2 }
  ].map((item) => ({
    ...item,
    eligibleForMix: true,
    productIdentity: { status: "matched" },
    captionVerification: { status: "pass" }
  }));
  const basePlan = validateEditingPlan({
    decisions: strictScript.blocks.map((block) => ({
      blockId: block.id,
      selectedMaterialIds: strictMaterials.map((item) => item.id),
      timeline: [{ materialId: strictMaterials[0].id, duration: 4 }]
    }))
  }, { script: strictScript, materials: strictMaterials });
  const result = applyStrictTimeline(basePlan, strictScript, strictMaterials);
  const timeline = result.decisions.flatMap((decision) => decision.timeline);
  assert.equal(result.status, "ready");
  assert.equal(result.timelineOptimization.status, "ready");
  assert.equal(new Set(timeline.map((item) => item.materialId)).size, timeline.length);
  assert.ok(timeline.every((item) => item.duration >= 2 && item.duration <= 4));
  assert.equal(timeline.reduce((sum, item) => sum + item.duration, 0), 8);
  assert.deepEqual(result.decisions[0].selectedMaterialIds, ["strict-1"]);
  assert.deepEqual(result.decisions[1].selectedMaterialIds, ["strict-2"]);
  assert.deepEqual(result.decisions[0].candidateMaterialIds.sort(), strictMaterials.map((item) => item.id).sort());
  assert.deepEqual(result.actualUsedMaterialIds.sort(), strictMaterials.map((item) => item.id).sort());
  assert.deepEqual(result.sentenceBindings[0].selectedMaterialIds, ["strict-1"]);
  assert.deepEqual(result.sentenceBindings[1].selectedMaterialIds, ["strict-2"]);
  assert.equal(result.narrativeContinuity.status, "pass");
  assert.equal(result.timelineOptimization.revalidatedAfterOptimization, true);
});

test("严格优化换镜后重建绑定与叙事校验，不保留优化前的误报", () => {
  const revalidationScript = {
    id: "revalidation-script",
    name: "918 西裤穿搭",
    voiceMode: "music_only",
    blocks: [
      { id: "revalidation-outfit", name: "上身开场", duration: 4, category: "人物穿搭", topic: "918 西裤穿搭" },
      { id: "revalidation-detail", name: "细节承接", duration: 4, category: "细节讲解", topic: "918 西裤穿搭" }
    ]
  };
  const revalidationMaterials = [
    { id: "revalidation-outfit-material", name: "上身镜头", type: "outfit", typeLabel: "人物穿搭", duration: 4 },
    { id: "revalidation-detail-material", name: "细节镜头", type: "detail", typeLabel: "细节讲解", duration: 4 }
  ];
  const basePlan = validateEditingPlan({
    decisions: [
      { blockId: "revalidation-outfit", selectedMaterialIds: ["revalidation-outfit-material"], timeline: [{ materialId: "revalidation-outfit-material", duration: 4 }] },
      { blockId: "revalidation-detail", selectedMaterialIds: ["revalidation-outfit-material"], timeline: [{ materialId: "revalidation-outfit-material", duration: 4 }] }
    ]
  }, { script: revalidationScript, materials: revalidationMaterials });

  assert.equal(basePlan.status, "blocked");
  assert.ok(basePlan.narrativeContinuity.issues.some((item) => item.code === "MATERIAL_ROLE_MISMATCH"));

  const result = applyStrictTimeline(basePlan, revalidationScript, revalidationMaterials);
  assert.equal(result.status, "ready");
  assert.equal(result.narrativeContinuity.status, "pass");
  assert.deepEqual(result.narrativeContinuity.issues, []);
  assert.deepEqual(result.decisions[1].selectedMaterialIds, ["revalidation-detail-material"]);
  assert.deepEqual(result.sentenceBindings[1].selectedMaterialIds, ["revalidation-detail-material"]);
  assert.equal(result.sentenceBindings[1].selectedMaterials[0].type, "detail");
});

test("严格时间线信任人工确认分类，不按 eligibleForMix 或复核字段二次过滤", () => {
  const trustedScript = {
    id: "trusted-script",
    voiceMode: "music_only",
    blocks: [{ id: "trusted-block", name: "上身开场", duration: 4, category: "人物穿搭" }]
  };
  const trustedMaterials = [{
    id: "human-confirmed-outfit",
    name: "人工确认穿搭",
    type: "outfit",
    duration: 4,
    eligibleForMix: false,
    classificationNeedsReview: true,
    productIdentity: { status: "unknown" },
    captionVerification: { status: "review" }
  }];
  const basePlan = validateEditingPlan({
    decisions: [{ blockId: "trusted-block", selectedMaterialIds: ["human-confirmed-outfit"], timeline: [{ materialId: "human-confirmed-outfit", duration: 4 }] }]
  }, { script: trustedScript, materials: trustedMaterials });
  const result = applyStrictTimeline(basePlan, trustedScript, trustedMaterials);
  assert.equal(result.status, "ready");
  assert.equal(result.decisions[0].timeline[0].materialId, "human-confirmed-outfit");
  assert.equal(result.timelineOptimization.catalogPolicy, "trust_human_confirmed_classification");
});

test("Ollama 返回 JSON 后生成经过校验的剪辑计划", async () => {
  let capturedBody;
  const fetchImpl = async (url, options) => {
    assert.equal(url, "http://127.0.0.1:11434/api/chat");
    capturedBody = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        message: {
          content: JSON.stringify({
            summary: "缺少直接证据，改用走动和转身展示宽松版型",
            decisions: [{
              blockId: "block-1",
              intent: "展示穿着舒适",
              evidenceStatus: "missing",
              selectedMaterialIds: ["material-b"],
              unsupportedClaims: ["弹力", "蹲下不勒"],
              rewriteRequired: true,
              suggestedVoiceText: "这条裤子版型宽松，走动转身都很自在",
              reason: "所选素材只有走动和转身",
              timeline: [{ materialId: "material-b", sourceStart: 0, duration: 3.5 }]
            }]
          })
        }
      })
    };
  };

  const result = await createEditingPlan({ script, materials, projectName: "测试工程" }, { fetchImpl });
  assert.equal(result.status, "review");
  assert.equal(result.model, "qwen3.5:latest");
  assert.equal(result.decisions[0].suggestedVoiceText, "这条裤子版型宽松，走动转身都很自在");
  assert.equal(capturedBody.think, false);
  assert.equal(capturedBody.format, "json");
  assert.ok(capturedBody.messages[1].content.includes("material-a"));
});

test("智能混合的云端主路线使用 qwen3.7-plus 并记录实际模型", async () => {
  let capturedBody;
  const fetchImpl = async (url, options) => {
    assert.match(url, /dashscope\.aliyuncs\.com/);
    capturedBody = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify({
        confidence: 0.92,
        conflicts: [],
        summary: "使用走动镜头并删除无证据卖点",
        decisions: [{
          blockId: "block-1",
          evidenceStatus: "missing",
          selectedMaterialIds: ["material-b"],
          unsupportedClaims: ["弹力", "蹲下不勒"],
          rewriteRequired: true,
          suggestedVoiceText: "这条裤子版型宽松，走动转身都很自在",
          reason: "素材只证明走动和转身",
          timeline: [{ materialId: "material-b", sourceStart: 0, duration: 3.5 }]
        }]
      }) } }] })
    };
  };
  const route = {
    mode: "smart",
    primary: { provider: "qwen", model: "qwen3.7-plus-2026-05-26" },
    fallback: { provider: "ollama", model: "qwen3.5:latest" },
    reviewer: { provider: "qwen", model: "qwen3.8-max" }
  };
  const result = await createEditingPlan({ script, materials }, { route, apiKey: "test-key", fetchImpl });
  assert.equal(capturedBody.model, "qwen3.7-plus-2026-05-26");
  assert.equal(result.provider, "qwen");
  assert.equal(result.model, "qwen3.7-plus-2026-05-26");
  assert.equal(result.fallbackUsed, false);
});
