const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { listSkuOptions, processBatch, sanitizeFileSegment } = require("../electron/services/workspace-service.cjs");
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
