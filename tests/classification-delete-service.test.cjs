const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const { createClassificationDeletionPlan, createMaterialDeletionPlan, validateManifestPath } = require("../electron/services/classification-delete-service.cjs");

function newLayoutFixture() {
  const materialRoot = path.join(os.tmpdir(), "caiku-delete-root");
  const libraryDir = path.join(materialRoot, "918");
  const batchDir = path.join(materialRoot, "_裁库任务", "918", "2026-08-27_本次导入");
  const manifestPath = path.join(batchDir, "manifest.json");
  const ownedFile = path.join(libraryDir, "03_细节讲解", "detail-001.mp4");
  return {
    materialRoot,
    manifestPath,
    ownedFile,
    manifest: {
      storageLayout: "sku_category_v1",
      sku: "918",
      libraryDir,
      batchDir,
      materials: [
        { filePath: ownedFile },
        { filePath: path.join(batchDir, "98_低复用待复核", "review-001.mp4") }
      ]
    }
  };
}

test("新布局删除计划只包含本次任务拥有的款号分类文件和内部任务目录", () => {
  const fixture = newLayoutFixture();
  const plan = createClassificationDeletionPlan(fixture);
  assert.equal(plan.storageLayout, "sku_category_v1");
  assert.equal(plan.batchDir, fixture.manifest.batchDir);
  assert.deepEqual(plan.ownedLibraryFiles, [fixture.ownedFile]);
  assert.ok(!plan.ownedLibraryFiles.includes(path.join(fixture.manifest.libraryDir, "03_细节讲解", "other-import.mp4")));
});

test("单素材删除只接受 manifest 中的生成文件，不接受渲染层传入路径", () => {
  const fixture = newLayoutFixture();
  fixture.manifest.materials[0] = {
    id: "material-1",
    filePath: fixture.ownedFile,
    thumbnailPath: path.join(fixture.manifest.batchDir, ".thumbnails", "material-1.jpg")
  };
  const plan = createMaterialDeletionPlan({ ...fixture, materialId: "material-1" });
  assert.deepEqual(new Set(plan.targets), new Set([
    fixture.ownedFile,
    path.join(fixture.manifest.batchDir, ".thumbnails", "material-1.jpg")
  ]));
  assert.throws(() => createMaterialDeletionPlan({ ...fixture, materialId: "missing" }), { code: "MATERIAL_NOT_FOUND" });
});

test("损坏任务记录不能把删除目标指向素材盘外或整个款号目录", () => {
  const fixture = newLayoutFixture();
  assert.throws(() => validateManifestPath({
    materialRoot: fixture.materialRoot,
    manifestPath: path.join(os.tmpdir(), "outside", "manifest.json")
  }), { code: "UNSAFE_DELETE_TARGET" });

  assert.throws(() => createClassificationDeletionPlan({
    ...fixture,
    manifest: { ...fixture.manifest, batchDir: path.join(os.tmpdir(), "outside", "task") }
  }), { code: "UNSAFE_DELETE_TARGET" });

  assert.throws(() => createClassificationDeletionPlan({
    ...fixture,
    manifest: { ...fixture.manifest, batchDir: fixture.manifest.libraryDir, storageLayout: "legacy" }
  }), { code: "UNSAFE_DELETE_TARGET" });

  assert.throws(() => createClassificationDeletionPlan({
    ...fixture,
    manifest: { ...fixture.manifest, materials: [{ filePath: path.join(os.tmpdir(), "outside.mp4") }] }
  }), { code: "UNSAFE_DELETE_TARGET" });
});

test("旧日期批次仍可删除，但范围固定在 SKU 下的批次目录", () => {
  const materialRoot = path.join(os.tmpdir(), "caiku-delete-legacy");
  const batchDir = path.join(materialRoot, "918", "2026-08-22_晚间上传");
  const manifestPath = path.join(batchDir, "manifest.json");
  const plan = createClassificationDeletionPlan({
    materialRoot,
    manifestPath,
    manifest: { sku: "918", batchDir, materials: [] }
  });
  assert.equal(plan.storageLayout, "legacy_batch");
  assert.equal(plan.batchDir, batchDir);
  assert.deepEqual(plan.ownedLibraryFiles, []);

  const internalBatchDir = path.join(materialRoot, "_裁库智能体", "训练库");
  assert.throws(() => createClassificationDeletionPlan({
    materialRoot,
    manifestPath: path.join(internalBatchDir, "manifest.json"),
    manifest: { batchDir: internalBatchDir, materials: [] }
  }), { code: "UNSAFE_DELETE_TARGET" });
});
