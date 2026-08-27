const test = require("node:test");
const assert = require("node:assert/strict");

const {
  retrieveEditingCases,
  structuralRecipe
} = require("../electron/services/editing-retrieval-service.cjs");

function trainingCase(overrides = {}) {
  return {
    caseId: "case-base",
    version: 1,
    status: "active",
    sku: "172",
    category: "mens_pants",
    caseType: "reference_only",
    rights: { userOwnedOrAuthorized: true },
    labels: { rating: 5, accepted: true },
    learningRecipe: {
      patternId: "question-hook-detail-outfit",
      hook: { type: "question", text: "参考商品很显瘦" },
      narrativeOrder: ["question_hook", "detail_evidence", "outfit_result", "soft_cta"],
      requiredMaterialRoles: ["detail", "outfit"],
      editingTechniques: ["问题字幕开场", "细节到上身匹配切"],
      pacing: { style: "fast_then_proof" },
      blocks: [
        { narrativeRole: "question_hook", materialType: "outfit", duration: 2.5, cutTechnique: "hard_cut", voiceText: "参考商品保证显瘦" },
        { narrativeRole: "detail_evidence", materialType: "detail", duration: 4, cutTechnique: "match_cut", subtitleText: "参考商品腰头" }
      ]
    },
    ...overrides
  };
}

test("只从用户案例库检索高质量结构并优先同类脚本", () => {
  const cases = [
    trainingCase({ caseId: "same-pattern", sku: "172" }),
    trainingCase({ caseId: "same-sku", sku: "918", learningRecipe: { patternId: "result-hook-overall", hook: { type: "result" }, narrativeOrder: ["pain_hook", "overall_result"], requiredMaterialRoles: ["overall"], editingTechniques: ["结果开场"] } }),
    trainingCase({ caseId: "deleted", status: "deleted" }),
    trainingCase({ caseId: "low-rating", labels: { rating: 2, accepted: true } }),
    trainingCase({ caseId: "rejected", labels: { rating: 5, accepted: false } }),
    trainingCase({ caseId: "unauthorized", rights: { userOwnedOrAuthorized: false } }),
    trainingCase({ caseId: "negative", caseType: "negative_example" })
  ];
  const result = retrieveEditingCases({
    cases,
    sku: "918",
    category: "mens_pants",
    script: {
      editingRecipe: {
        patternId: "question-hook-detail-outfit",
        hook: { type: "question" },
        narrativeOrder: ["question_hook", "detail_evidence", "outfit_result", "soft_cta"],
        requiredMaterialRoles: ["detail", "outfit"],
        editingTechniques: ["问题字幕开场"]
      }
    }
  });
  assert.deepEqual(result.matches.map((item) => item.caseId), ["same-pattern", "same-sku"]);
  assert.equal(result.matches[0].factReuseAllowed, false);
  assert.ok(result.matches[0].reasons.some((reason) => reason.includes("脚本模式")));
  assert.equal(result.audit.source, "user_provided_training_library_only");
  assert.equal(result.audit.excludedCount, 5);
});

test("传给剪辑模型的案例配方只保留结构，不包含参考商品文案", () => {
  const recipe = structuralRecipe(trainingCase());
  const serialized = JSON.stringify(recipe);
  assert.match(serialized, /question_hook/);
  assert.match(serialized, /match_cut/);
  assert.doesNotMatch(serialized, /参考商品/);
  assert.equal(recipe.factReuseAllowed, false);
  assert.equal(recipe.blocks[0].voiceText, undefined);
  assert.equal(recipe.blocks[1].subtitleText, undefined);
});

test("没有合格用户案例时返回安全空结果而不是联网寻找", () => {
  const result = retrieveEditingCases({ cases: [], sku: "918", category: "mens_pants", script: {} });
  assert.deepEqual(result.matches, []);
  assert.equal(result.fallback, "use_current_script_and_classified_material_catalog");
  assert.equal(result.audit.marketSearchAttempted, false);
});
