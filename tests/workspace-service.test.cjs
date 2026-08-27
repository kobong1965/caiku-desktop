const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { INTERNAL_TASKS_FOLDER, findManifests, listSkuOptions, planBatchStorage, processBatch, sanitizeFileSegment } = require("../electron/services/workspace-service.cjs");
const { seededShuffle } = require("../electron/services/mix-engine.cjs");

test("Windows 不允许的文件名字符会被清理", () => {
  assert.equal(sanitizeFileSegment('S2026:08/神裤*?  '), "S2026_08_神裤__");
});

test("同一序号产生稳定的混剪顺序", () => {
  const items = [1, 2, 3, 4, 5];
  assert.deepEqual(seededShuffle(items, 7), seededShuffle(items, 7));
  assert.notDeepEqual(seededShuffle(items, 7), seededShuffle(items, 8));
});

test("未配置千问密钥时在创建批次目录前阻止伪 AI 分类", async () => {
  const rootDir = path.join(os.tmpdir(), `caiku-ai-key-test-${Date.now()}`);
  await assert.rejects(
    () => processBatch({
      sku: "TEST-01",
      batchName: "missing-key",
      rootDir,
      sourcePaths: [path.join(rootDir, "not-needed.mp4")],
      minimumClipSeconds: 2
    }, {
      classificationRuntime: {
        settings: { enabled: true, allowOfflineFallback: false },
        apiKey: ""
      }
    }),
    (error) => error.code === "AI_KEY_REQUIRED"
  );
  await assert.rejects(() => fs.access(rootDir), (error) => error.code === "ENOENT");
});

test("已有款号从素材盘一级目录读取并汇总批次素材数", async (t) => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "caiku-sku-list-"));
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  const batchDir = path.join(rootDir, "918", "2026-08-21_晚间");
  await fs.mkdir(batchDir, { recursive: true });
  await fs.mkdir(path.join(rootDir, "919"), { recursive: true });
  await fs.writeFile(path.join(batchDir, "manifest.json"), JSON.stringify({
    sku: "918",
    batchName: "晚间",
    batchDir,
    status: "ready_for_review",
    createdAt: "2026-08-21T10:00:00.000Z",
    updatedAt: "2026-08-21T10:10:00.000Z",
    materials: [{ id: "m1" }, { id: "m2" }],
    summary: { materialCount: 2 }
  }));

  const options = await listSkuOptions(rootDir);
  assert.deepEqual(options.map((item) => item.sku), ["918", "919"]);
  assert.equal(options[0].batchCount, 1);
  assert.equal(options[0].materialCount, 2);
});

test("新布局只在款号直属目录保留内容分类，内部任务目录不会变成款号", async (t) => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "caiku-sku-layout-"));
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  const skuDir = path.join(rootDir, "918");
  const categoryDir = path.join(skuDir, "03_细节讲解");
  const taskDir = path.join(rootDir, INTERNAL_TASKS_FOLDER, "918", "2026-08-27_本次导入");
  const materialPath = path.join(categoryDir, "detail-001.mp4");
  await fs.mkdir(categoryDir, { recursive: true });
  await fs.mkdir(taskDir, { recursive: true });
  const trainingDir = path.join(rootDir, "_裁库智能体", "训练库");
  await fs.mkdir(trainingDir, { recursive: true });
  await fs.writeFile(path.join(trainingDir, "manifest.json"), JSON.stringify({ sku: "_裁库智能体", materials: [{ id: "must-not-load" }] }));
  await fs.writeFile(materialPath, "fixture");
  await fs.writeFile(path.join(taskDir, "manifest.json"), JSON.stringify({
    schemaVersion: 3,
    storageLayout: "sku_category_v1",
    sku: "918",
    batchName: "本次导入",
    rootDir,
    libraryDir: skuDir,
    batchDir: taskDir,
    status: "ready_for_review",
    createdAt: "2026-08-27T02:00:00.000Z",
    updatedAt: "2026-08-27T02:10:00.000Z",
    materials: [{ id: "m1", sku: "918", type: "detail", typeLabel: "细节讲解", filePath: materialPath }],
    summary: { materialCount: 1 }
  }));

  const skuEntries = await fs.readdir(skuDir);
  assert.deepEqual(skuEntries, ["03_细节讲解"]);
  const manifests = await findManifests(rootDir);
  assert.equal(manifests.length, 1);
  assert.equal(manifests.find((item) => item.materials?.[0]?.id === "must-not-load"), undefined);
  assert.equal(manifests[0].libraryDir, skuDir);
  assert.equal(manifests[0].materials[0].filePath, materialPath);
  const options = await listSkuOptions(rootDir);
  assert.deepEqual(options.map((item) => item.sku), ["918"]);
  assert.equal(options[0].materialCount, 1);
});

test("软件保留目录名和 Windows 设备名不能作为款号", async () => {
  await assert.rejects(() => processBatch({ sku: "_裁库任务", rootDir: os.tmpdir(), sourcePaths: [] }), { code: "SKU_RESERVED" });
  await assert.rejects(() => processBatch({ sku: "CON", rootDir: os.tmpdir(), sourcePaths: [] }), { code: "SKU_RESERVED" });
});

test("存盘规划把正式素材根固定为款号目录，日期只进入内部任务目录", () => {
  const rootDir = path.resolve("D:\\抖音素材库");
  const plan = planBatchStorage({
    rootDir,
    sku: "918",
    batchName: "晚间上传",
    date: new Date(2026, 7, 27, 12, 0, 0)
  });
  assert.equal(plan.libraryDir, path.join(rootDir, "918"));
  assert.equal(plan.taskRoot, path.join(rootDir, INTERNAL_TASKS_FOLDER, "918"));
  assert.equal(plan.batchBaseDir, path.join(rootDir, INTERNAL_TASKS_FOLDER, "918", "2026-08-27_晚间上传"));
  assert.ok(!plan.libraryDir.includes("2026-08-27"));
});

test("旧日期目录和新内部任务目录可以双读并汇总到同一个款号", async (t) => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "caiku-dual-layout-"));
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  const legacyDir = path.join(rootDir, "918", "2026-08-21_旧批次");
  const taskDir = path.join(rootDir, INTERNAL_TASKS_FOLDER, "918", "2026-08-27_新任务");
  await fs.mkdir(legacyDir, { recursive: true });
  await fs.mkdir(taskDir, { recursive: true });
  await fs.writeFile(path.join(legacyDir, "manifest.json"), JSON.stringify({
    sku: "918",
    batchDir: legacyDir,
    updatedAt: "2026-08-21T12:00:00.000Z",
    materials: [{ id: "legacy-1" }],
    summary: { materialCount: 1 }
  }));
  await fs.writeFile(path.join(taskDir, "manifest.json"), JSON.stringify({
    storageLayout: "sku_category_v1",
    sku: "918",
    libraryDir: path.join(rootDir, "918"),
    batchDir: taskDir,
    updatedAt: "2026-08-27T12:00:00.000Z",
    materials: [{ id: "new-1" }, { id: "new-2" }],
    summary: { materialCount: 2 }
  }));

  const manifests = await findManifests(rootDir);
  assert.deepEqual(manifests.map((item) => item.materials[0].id), ["new-1", "legacy-1"]);
  assert.equal(manifests[1].libraryDir, path.join(rootDir, "918"));
  const options = await listSkuOptions(rootDir);
  assert.equal(options.length, 1);
  assert.equal(options[0].sku, "918");
  assert.equal(options[0].batchCount, 2);
  assert.equal(options[0].materialCount, 3);
});
