const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const {
  createEditingTrainingRepository,
  normalizeTrainingCase
} = require("../electron/services/editing-training-repository.cjs");

async function withRepository(run) {
  const materialRoot = await fs.mkdtemp(path.join(os.tmpdir(), "caiku-training-"));
  let tick = 0;
  const repository = createEditingTrainingRepository({
    materialRoot,
    now: () => `2026-08-23T00:00:0${tick++}.000Z`,
    idFactory: () => "case-918-0001"
  });
  try {
    await run(repository, materialRoot);
  } finally {
    await fs.rm(materialRoot, { recursive: true, force: true });
  }
}

test("训练案例合同只保存路径和派生信息，不复制原视频", async () => {
  await withRepository(async (repository, materialRoot) => {
    const sourcePath = path.join(materialRoot, "918", "细节讲解", "detail-001.mp4");
    const referencePath = path.join(materialRoot, "投喂", "reference-001.mp4");
    const saved = await repository.save({
      sku: "918",
      category: "mens_pants",
      caseType: "paired_edit",
      sourceMaterials: [{ materialId: "detail-001", path: sourcePath, classification: "细节讲解" }],
      finalVideo: { path: referencePath, sourceType: "user_uploaded_reference" },
      script: { id: "script-1", voiceMode: "full_voice", blocks: [] },
      labels: { rating: 5, accepted: true },
      rights: { userOwnedOrAuthorized: true }
    });

    assert.equal(saved.caseId, "case-918-0001");
    assert.equal(saved.version, 1);
    assert.equal(saved.status, "active");
    assert.equal(saved.finalVideo.sourceType, "user_uploaded_reference");
    assert.equal(saved.sourceMaterials[0].path, path.resolve(sourcePath));
    assert.equal(saved.finalVideo.path, path.resolve(referencePath));
    assert.equal("performance" in saved, false);
    await assert.rejects(fs.access(path.join(repository.rootDir, "videos")), /ENOENT/);
    assert.equal((await repository.list()).length, 1);
  });
});

test("人工修改保存为新版本，不覆盖旧版本", async () => {
  await withRepository(async (repository) => {
    const first = await repository.save({ sku: "918", caseType: "reference_only", finalVideo: { path: "D:/reference.mp4" }, rights: { userOwnedOrAuthorized: true }, labels: { rating: 4 } });
    const second = await repository.save({ ...first, labels: { rating: 5, accepted: true, reasons: ["节奏自然"] } });
    assert.equal(second.version, 2);
    assert.equal(second.labels.rating, 5);
    const history = await repository.history(first.caseId);
    assert.deepEqual(history.map((item) => item.version), [1, 2]);
    assert.equal(history[0].labels.rating, 4);
  });
});

test("删除进入软删除状态并可恢复，历史记录完整", async () => {
  await withRepository(async (repository) => {
    const saved = await repository.save({ sku: "918", caseType: "reference_only", finalVideo: { path: "D:/reference.mp4" }, rights: { userOwnedOrAuthorized: true } });
    const removed = await repository.remove(saved.caseId, "用户删除");
    assert.equal(removed.status, "deleted");
    assert.equal((await repository.list()).length, 0);
    assert.equal((await repository.list({ includeDeleted: true })).length, 1);
    const restored = await repository.restore(saved.caseId);
    assert.equal(restored.status, "active");
    assert.equal(restored.version, 3);
    assert.equal((await repository.list()).length, 1);
    assert.deepEqual((await repository.history(saved.caseId)).map((item) => item.status), ["active", "deleted", "active"]);
  });
});

test("案例合同拒绝非用户投喂来源和无内容案例", () => {
  assert.throws(
    () => normalizeTrainingCase({ caseType: "reference_only", finalVideo: { path: "D:/reference.mp4", sourceType: "market_search" } }),
    (error) => error.code === "EDITING_TRAINING_SOURCE_NOT_USER_PROVIDED"
  );
  assert.throws(
    () => normalizeTrainingCase({ caseType: "reference_only" }),
    (error) => error.code === "EDITING_TRAINING_CONTENT_REQUIRED"
  );
});
