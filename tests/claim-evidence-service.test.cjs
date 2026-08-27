const test = require("node:test");
const assert = require("node:assert/strict");
const {
  evaluateBlockEvidence,
  evaluatePlanEvidence,
  extractClaims
} = require("../electron/services/claim-evidence-service.cjs");

const elasticityBlock = { id: "b1", voiceText: "高弹面料，蹲下活动也自如" };

test("每个脚本段落都隐含要求目标商品一致", () => {
  const claims = extractClaims({ voiceText: "今天这样搭配" });
  assert.deepEqual(claims.map((claim) => claim.code), ["target_product"]);
});

test("分类名称或相似关键词不能冒充直接证据", () => {
  const result = evaluateBlockEvidence(elasticityBlock, [{
    id: "m1",
    name: "高弹神裤拉伸展示",
    productIdentity: { status: "matched" },
    classificationTags: ["弹力", "下蹲"]
  }]);
  assert.equal(result.status, "blocked");
  assert.ok(result.unsupportedClaims.includes("弹力/拉伸"));
  assert.ok(result.unsupportedClaims.includes("下蹲活动"));
});

test("人工确认素材可从已有直接观察映射版型轮廓", () => {
  const result = evaluateBlockEvidence({ voiceText: "宽松直筒版型，转身也能看清轮廓" }, [{
    id: "outfit-silhouette",
    actions: ["站立", "转身"],
    evidence: [{
      claimCode: "full_body_visibility",
      status: "direct",
      observations: ["人物完成转身，裤装宽松直筒轮廓持续可见"]
    }]
  }], { trustHumanConfirmedCatalog: true });

  assert.equal(result.status, "pass");
  assert.deepEqual(result.claims.map((claim) => claim.code), ["target_product", "silhouette", "movement"]);
});

test("动作识别记录可直接证明动态展示", () => {
  const result = evaluateBlockEvidence({ voiceText: "走动转身时的动态展示" }, [{
    id: "action-turn",
    detected: { actions: ["自然走动", "侧身转身"] },
    evidence: []
  }], { trustHumanConfirmedCatalog: true });

  assert.equal(result.status, "pass");
  assert.equal(result.claims.find((claim) => claim.code === "movement")?.status, "direct");
});

test("版型映射不使用素材名、分类标签或间接观察猜测", () => {
  const material = {
    id: "unsafe-silhouette",
    name: "宽松直筒轮廓展示",
    classificationTags: ["版型", "直筒", "全身"],
    actions: ["站立"],
    evidence: [{ claimCode: "full_body_visibility", status: "indirect", observations: ["宽松直筒裤腿轮廓可见"] }]
  };
  const trusted = evaluateBlockEvidence({ voiceText: "这是宽松直筒版型" }, [material], { trustHumanConfirmedCatalog: true });
  const untrustedDirectObservation = evaluateBlockEvidence({ voiceText: "这是宽松直筒版型" }, [{
    ...material,
    evidence: [{ claimCode: "full_body_visibility", status: "direct", observations: ["宽松直筒裤腿轮廓可见"] }]
  }]);

  assert.equal(trusted.claims.find((claim) => claim.code === "silhouette")?.status, "missing");
  assert.equal(untrustedDirectObservation.claims.find((claim) => claim.code === "silhouette")?.status, "missing");
});

test("目标商品匹配且逐项 direct 才能通过", () => {
  const result = evaluateBlockEvidence(elasticityBlock, [{
    id: "m1",
    productIdentity: { status: "matched" },
    actions: ["拉伸裤腰", "下蹲"],
    evidence: [
      { claimCode: "elasticity", status: "direct" },
      { claimCode: "squat", status: "direct" }
    ]
  }]);
  assert.equal(result.status, "pass");
  assert.equal(result.coverage, 1);
});

test("错款素材即使动作证据齐全仍然阻断", () => {
  const result = evaluateBlockEvidence(elasticityBlock, [{
    id: "m-wrong",
    productIdentity: { status: "mismatch" },
    actions: ["拉伸", "下蹲"]
  }]);
  assert.equal(result.status, "blocked");
  assert.ok(result.unsupportedClaims.includes("目标商品一致"));
});

test("计划汇总输出直接证据覆盖率", () => {
  const result = evaluatePlanEvidence({ blocks: [elasticityBlock] }, [{ blockId: "b1", selectedMaterialIds: ["m1"] }], [{
    id: "m1",
    productIdentity: { status: "matched" },
    evidence: [{ claimCode: "elasticity", status: "direct" }]
  }]);
  assert.equal(result.status, "blocked");
  assert.equal(result.directEvidenceCoverage, 0.667);
});
