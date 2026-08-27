const path = require("node:path");
const { CLASSIFICATIONS } = require("./video-engine.cjs");

const INTERNAL_TASKS_FOLDER = "_裁库任务";
const SKU_CATEGORY_LAYOUT = "sku_category_v1";

function isSameOrWithin(rootPath, targetPath) {
  const relative = path.relative(path.resolve(rootPath), path.resolve(targetPath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function unsafeDelete(message) {
  const error = new Error(message);
  error.code = "UNSAFE_DELETE_TARGET";
  return error;
}

function validateManifestPath({ manifestPath, materialRoot }) {
  const resolvedRoot = path.resolve(String(materialRoot || ""));
  const resolvedManifest = path.resolve(String(manifestPath || ""));
  if (!materialRoot || !manifestPath || path.basename(resolvedManifest).toLowerCase() !== "manifest.json") {
    throw unsafeDelete("删除目标不是有效的分类任务记录");
  }
  if (!isSameOrWithin(resolvedRoot, resolvedManifest) || resolvedManifest === resolvedRoot) {
    throw unsafeDelete("分类任务记录不在当前素材盘内");
  }
  return { materialRoot: resolvedRoot, manifestPath: resolvedManifest };
}

function normalizedSku(value) {
  const sku = String(value || "").trim();
  if (!sku || sku === "." || sku === ".." || path.basename(sku) !== sku) {
    throw unsafeDelete("分类任务记录中的款号无效");
  }
  return sku;
}

function createClassificationDeletionPlan({ manifestPath, materialRoot, manifest }) {
  const validated = validateManifestPath({ manifestPath, materialRoot });
  const batchDir = path.resolve(String(manifest?.batchDir || path.dirname(validated.manifestPath)));
  if (!isSameOrWithin(validated.materialRoot, batchDir) || !isSameOrWithin(batchDir, validated.manifestPath)) {
    throw unsafeDelete("任务目录不在当前素材盘内");
  }
  if (path.relative(batchDir, path.dirname(validated.manifestPath)) !== "") {
    throw unsafeDelete("分类任务记录必须直接位于任务目录中");
  }

  const relativeBatchParts = path.relative(validated.materialRoot, batchDir).split(path.sep).filter(Boolean);
  if (relativeBatchParts.length < 2) {
    throw unsafeDelete("禁止删除素材盘根目录或整个款号目录");
  }

  if (manifest?.storageLayout !== SKU_CATEGORY_LAYOUT) {
    if (String(relativeBatchParts[0] || "").startsWith("_裁库")) {
      throw unsafeDelete("内部软件目录不能按旧批次规则删除");
    }
    return {
      storageLayout: "legacy_batch",
      batchDir,
      libraryDir: batchDir,
      ownedLibraryFiles: []
    };
  }

  const sku = normalizedSku(manifest.sku);
  const expectedLibraryDir = path.join(validated.materialRoot, sku);
  const libraryDir = path.resolve(String(manifest.libraryDir || expectedLibraryDir));
  if (path.relative(expectedLibraryDir, libraryDir) !== "") {
    throw unsafeDelete("款号素材目录与当前素材盘不一致");
  }

  const taskRoot = path.join(validated.materialRoot, INTERNAL_TASKS_FOLDER, sku);
  if (!isSameOrWithin(taskRoot, batchDir) || path.relative(taskRoot, batchDir) === "") {
    throw unsafeDelete("内部任务目录与款号不一致");
  }

  const allowedCategoryFolders = new Set(CLASSIFICATIONS.map((classification) => classification.folder));
  const ownedLibraryFiles = new Set();
  for (const material of Array.isArray(manifest.materials) ? manifest.materials : []) {
    if (!material?.filePath) continue;
    const targetPath = path.resolve(String(material.filePath));
    if (isSameOrWithin(batchDir, targetPath)) continue;
    if (!isSameOrWithin(libraryDir, targetPath)) {
      throw unsafeDelete("任务记录包含素材盘外的分类文件");
    }
    const relativeParts = path.relative(libraryDir, targetPath).split(path.sep).filter(Boolean);
    if (relativeParts.length < 2 || !allowedCategoryFolders.has(relativeParts[0])) {
      throw unsafeDelete("任务记录包含非内容分类目录的删除目标");
    }
    ownedLibraryFiles.add(targetPath);
  }

  return {
    storageLayout: SKU_CATEGORY_LAYOUT,
    batchDir,
    libraryDir,
    ownedLibraryFiles: [...ownedLibraryFiles]
  };
}

function createMaterialDeletionPlan({ manifestPath, materialRoot, manifest, materialId }) {
  const batchPlan = createClassificationDeletionPlan({ manifestPath, materialRoot, manifest });
  const material = (Array.isArray(manifest?.materials) ? manifest.materials : []).find((item) => item?.id === materialId);
  if (!material) {
    const error = new Error("任务记录中找不到该素材");
    error.code = "MATERIAL_NOT_FOUND";
    throw error;
  }

  const allowedTaskFolders = new Set([
    ...CLASSIFICATIONS.map((classification) => classification.folder),
    "98_低复用待复核",
    "99_不可用",
    ".thumbnails"
  ]);
  const ownedLibraryFiles = new Set(batchPlan.ownedLibraryFiles.map((item) => path.resolve(item)));
  const targets = new Set();
  for (const value of [material.filePath, material.thumbnailPath]) {
    if (!value) continue;
    const targetPath = path.resolve(String(value));
    if (isSameOrWithin(batchPlan.batchDir, targetPath)) {
      const relativeParts = path.relative(batchPlan.batchDir, targetPath).split(path.sep).filter(Boolean);
      if (relativeParts.length < 2 || !allowedTaskFolders.has(relativeParts[0])) {
        throw unsafeDelete("素材删除目标不在允许的任务素材目录中");
      }
      targets.add(targetPath);
      continue;
    }
    if (!ownedLibraryFiles.has(targetPath)) {
      throw unsafeDelete("素材删除目标不属于当前任务记录");
    }
    targets.add(targetPath);
  }
  return { ...batchPlan, material, targets: [...targets] };
}

module.exports = { createClassificationDeletionPlan, createMaterialDeletionPlan, isSameOrWithin, validateManifestPath };
