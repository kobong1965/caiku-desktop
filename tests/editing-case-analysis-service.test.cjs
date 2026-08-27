const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createMarketScriptRecipe,
  normalizeNarrativeRole
} = require("../electron/services/editing-case-analysis-service.cjs");
const { attachMarketScriptRecipe } = require("../electron/services/competitor-analysis-service.cjs");

test("用户投喂视频会被整理为问题钩子到轻 CTA 的可复用剪辑配方", () => {
  const recipe = createMarketScriptRecipe({
    title: "西裤穿搭学习样片",
    duration: 18,
    voiceMode: "full_voice",
    summary: "先提问，再用细节和上身结果回答",
    hook: { type: "question", text: "还有人不懂西裤要怎么穿搭？", targetSeconds: [0, 2.5] },
    editingTechniques: ["问题字幕开场", "细节到全身匹配切", "结尾轻引导"],
    pacing: { style: "fast_then_proof", rhythmNotes: ["前快后稳"] },
    subtitleStyle: { density: "sentence", position: "bottom" },
    voiceStyle: { tone: "natural_neutral", cadence: "short_phrases" },
    musicStyle: { role: "support_voice", energy: "medium" },
    blocks: [
      { name: "问题开场", duration: 2.5, type: "outfit", narrativeRole: "question_hook", visibleText: "还有人不懂西裤要怎么穿搭？", cutTechnique: "hard_cut" },
      { name: "腰头细节", duration: 4, type: "detail", narrativeRole: "detail_evidence", visualInstruction: "腰头和褶皱特写", voiceText: "先看腰头和褶皱" },
      { name: "上身结果", duration: 5, type: "outfit", narrativeRole: "outfit_result", visualInstruction: "正面和侧面上身", voiceText: "上身线条会更利落" },
      { name: "通勤场景", duration: 4, type: "overall", narrativeRole: "use_case", voiceText: "通勤搭衬衫就可以" },
      { name: "结尾", duration: 2.5, type: "outfit", narrativeRole: "soft_cta", voiceText: "照这个思路搭就行" }
    ]
  }, {
    filePath: "D:/投喂/西裤穿搭.mp4",
    fileName: "西裤穿搭.mp4",
    sourceType: "user_uploaded_reference"
  });

  assert.equal(recipe.source.sourceType, "user_uploaded_reference");
  assert.equal(recipe.discovery.marketSearchAllowed, false);
  assert.equal(recipe.discovery.autoDownloadAllowed, false);
  assert.equal(recipe.patternId, "question-hook-detail-outfit");
  assert.equal(recipe.hook.type, "question");
  assert.deepEqual(recipe.narrativeOrder, ["question_hook", "detail_evidence", "outfit_result", "use_case", "soft_cta"]);
  assert.deepEqual(recipe.requiredMaterialRoles, ["outfit", "detail", "overall"]);
  assert.equal(recipe.blocks[1].cutTechnique, "match_cut");
  assert.match(recipe.summary, /细节和上身结果/);
});

test("未显式标注角色时按用户投喂脚本内容推导叙事角色", () => {
  assert.equal(normalizeNarrativeRole({ name: "开头提问", subtitleText: "还有人不知道怎么穿吗？" }, 0, 4), "question_hook");
  assert.equal(normalizeNarrativeRole({ type: "detail", name: "面料细节" }, 1, 4), "detail_evidence");
  assert.equal(normalizeNarrativeRole({ type: "outfit", name: "上身效果" }, 2, 4), "outfit_result");
  assert.equal(normalizeNarrativeRole({ name: "结尾推荐" }, 3, 4), "soft_cta");
});

test("脚本人工设置的 styleRole 优先于素材类型推导", () => {
  assert.equal(normalizeNarrativeRole({ styleRole: "soft_cta", type: "review", name: "克制收口" }, 4, 5), "soft_cta");
  assert.equal(normalizeNarrativeRole({ styleRole: "use_case", type: "outfit", name: "真实场景" }, 3, 5), "use_case");
});

test("拒绝把搜索、抓取或自动发现的视频写成市场脚本案例", () => {
  for (const sourceType of ["market_search", "crawler", "auto_discovered", "remote_download"]) {
    assert.throws(
      () => createMarketScriptRecipe({ blocks: [{ name: "开场", duration: 2, type: "outfit" }] }, { filePath: "D:/x.mp4", sourceType }),
      (error) => error.code === "MARKET_SCRIPT_SOURCE_NOT_USER_PROVIDED"
    );
  }
});

test("现有投喂视频分析结果会附带可训练配方和本地来源", () => {
  const result = attachMarketScriptRecipe({
    title: "用户样片",
    duration: 6,
    voiceMode: "partial_voice",
    blocks: [
      { name: "问题开头", duration: 2, type: "outfit", visibleText: "还有人不懂怎么搭？" },
      { name: "细节回答", duration: 4, type: "detail", visualInstruction: "腰头特写" }
    ]
  }, {
    filePath: "D:/投喂/用户样片.mp4",
    fileName: "用户样片.mp4",
    duration: 6,
    width: 1080,
    height: 1920
  });
  assert.equal(result.source.sourceType, "user_uploaded_reference");
  assert.equal(result.learningRecipe.source.sourceType, "user_uploaded_reference");
  assert.equal(result.learningRecipe.discovery.marketSearchAllowed, false);
  assert.equal(result.learningRecipe.blocks.length, 2);
});
