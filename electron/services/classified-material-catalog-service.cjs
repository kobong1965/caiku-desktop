const fs = require("node:fs/promises");
const path = require("node:path");

function catalogError(message, code, details = null) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  return error;
}

function clone(value) {
  try { return JSON.parse(JSON.stringify(value)); } catch { return {}; }
}

function normalizeCategoryLabel(material = {}) {
  const label = String(material.typeLabel || material.classification || material.category || "").trim();
  if (label) return label;
  const labels = {
    outfit: "人物穿搭",
    overall: "整体展示",
    detail: "细节讲解",
    review: "测评对比",
    action: "动作展示",
    speech: "口播",
    upper_related: "上衣相关",
    other: "其他"
  };
  return labels[String(material.type || "").toLowerCase()] || "其他";
}

function createClassifiedMaterialCatalog(input = {}) {
  const sku = String(input.sku || "").trim();
  if (!sku) throw catalogError("请选择要剪辑的款号", "CLASSIFIED_MATERIAL_CATALOG_SKU_REQUIRED");
  if (input.humanConfirmed !== true) {
    throw catalogError("素材分类结果尚未经过人工确认", "CLASSIFIED_MATERIAL_CATALOG_NOT_CONFIRMED");
  }
  const manifests = Array.isArray(input.manifests) ? input.manifests : [];
  const materials = [];
  const batches = [];
  let excludedBecauseDifferentSku = 0;

  for (const sourceManifest of manifests) {
    const manifest = clone(sourceManifest);
    const manifestSku = String(manifest.sku || sku).trim();
    const batchMaterials = Array.isArray(manifest.materials) ? manifest.materials : [];
    let included = 0;
    for (const sourceMaterial of batchMaterials) {
      const materialSku = String(sourceMaterial?.sku || manifestSku || sku).trim();
      if (materialSku && materialSku !== sku) {
        excludedBecauseDifferentSku += 1;
        continue;
      }
      const material = clone(sourceMaterial);
      material.sku = materialSku || sku;
      material.typeLabel = normalizeCategoryLabel(material);
      material.catalogSource = {
        manifestPath: String(manifest.manifestPath || ""),
        batchName: String(manifest.batchName || manifest.batch || "")
      };
      materials.push(material);
      included += 1;
    }
    batches.push({
      manifestPath: String(manifest.manifestPath || ""),
      batchName: String(manifest.batchName || manifest.batch || ""),
      materialCount: included
    });
  }

  const categories = {};
  for (const material of materials) {
    const category = normalizeCategoryLabel(material);
    if (!categories[category]) categories[category] = [];
    categories[category].push(material);
  }
  return {
    schemaVersion: 1,
    sku,
    source: "material_classification_manifest",
    humanConfirmed: true,
    policy: {
      secondaryFilteringAllowed: false,
      reclassificationAllowed: false,
      deletionAllowed: false,
      sourceOfTruth: "human_confirmed_material_classification"
    },
    batches,
    categories,
    materials,
    materialCount: materials.length,
    categoryCounts: Object.fromEntries(Object.entries(categories).map(([name, items]) => [name, items.length])),
    audit: {
      inputMaterialCount: manifests.reduce((sum, manifest) => sum + (Array.isArray(manifest?.materials) ? manifest.materials.length : 0), 0),
      excludedBecauseDifferentSku,
      excludedBySecondaryQualityFilter: 0,
      retainedMaterialCount: materials.length
    },
    generatedAt: new Date().toISOString()
  };
}

async function readClassifiedMaterialCatalog(input = {}) {
  const manifestPaths = (Array.isArray(input.manifestPaths) ? input.manifestPaths : []).map((filePath) => path.resolve(filePath));
  if (!manifestPaths.length) throw catalogError("没有选择已确认的素材分类批次", "CLASSIFIED_MATERIAL_CATALOG_MANIFEST_REQUIRED");
  const manifests = [];
  for (const manifestPath of manifestPaths) {
    let manifest;
    try {
      manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    } catch (error) {
      throw catalogError(`无法读取素材分类清单：${error.message}`, "CLASSIFIED_MATERIAL_CATALOG_READ_FAILED", { manifestPath });
    }
    manifests.push({ ...manifest, manifestPath });
  }
  return createClassifiedMaterialCatalog({ sku: input.sku, humanConfirmed: input.humanConfirmed, manifests });
}

module.exports = {
  createClassifiedMaterialCatalog,
  normalizeCategoryLabel,
  readClassifiedMaterialCatalog
};
