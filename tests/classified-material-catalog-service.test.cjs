const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createClassifiedMaterialCatalog
} = require("../electron/services/classified-material-catalog-service.cjs");

const materials = [
  { id: "outfit-1", sku: "918", type: "outfit", typeLabel: "人物穿搭", filePath: "D:/918/01_人物穿搭/outfit-1.mp4", duration: 4, eligibleForMix: true },
  { id: "detail-1", sku: "918", type: "detail", typeLabel: "细节讲解", filePath: "D:/918/03_细节讲解/detail-1.mp4", duration: 1.2, eligibleForMix: false, classificationNeedsReview: true },
  { id: "overall-1", sku: "918", type: "overall", typeLabel: "整体展示", filePath: "D:/918/02_整体展示/missing.mp4", duration: 5, lowReuse: true },
  { id: "action-1", sku: "918", type: "action", typeLabel: "动作展示", filePath: "D:/918/05_动作展示/action-1.mp4", duration: 3, captionStatus: "treated_needs_review" }
];

test("分类清单完整保留人工确认的每个素材，不读取可混剪或质量字段做过滤", () => {
  const catalog = createClassifiedMaterialCatalog({
    sku: "918",
    humanConfirmed: true,
    manifests: [{ manifestPath: "D:/918/batch/manifest.json", batchName: "8月23日", materials }]
  });
  assert.equal(catalog.humanConfirmed, true);
  assert.equal(catalog.materialCount, 4);
  assert.deepEqual(catalog.materials.map((item) => item.id), materials.map((item) => item.id));
  assert.deepEqual(Object.keys(catalog.categories), ["人物穿搭", "细节讲解", "整体展示", "动作展示"]);
  assert.equal(catalog.categories["细节讲解"][0].eligibleForMix, false);
  assert.equal(catalog.categories["整体展示"][0].lowReuse, true);
  assert.equal(catalog.categories["动作展示"][0].captionStatus, "treated_needs_review");
  assert.equal(catalog.policy.secondaryFilteringAllowed, false);
});

test("目录只读取当前人工确认的款号，但不按素材字段二次判断", () => {
  const catalog = createClassifiedMaterialCatalog({
    sku: "918",
    humanConfirmed: true,
    manifests: [{ materials: [...materials, { id: "other-sku", sku: "172", type: "detail", typeLabel: "细节讲解", filePath: "D:/172/x.mp4" }] }]
  });
  assert.deepEqual(catalog.materials.map((item) => item.id), materials.map((item) => item.id));
  assert.equal(catalog.audit.excludedBecauseDifferentSku, 1);
  assert.equal(catalog.audit.excludedBySecondaryQualityFilter, 0);
});

test("没有人工确认时不得把自动分类结果交给剪辑智能体", () => {
  assert.throws(
    () => createClassifiedMaterialCatalog({ sku: "918", humanConfirmed: false, manifests: [{ materials }] }),
    (error) => error.code === "CLASSIFIED_MATERIAL_CATALOG_NOT_CONFIRMED"
  );
});
