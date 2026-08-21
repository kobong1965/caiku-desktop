const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildMaterialCapabilityCard,
  buildPlanningPrompt,
  createEditingPlan,
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
