const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createProductProfileRepository,
  normalizeProductProfile
} = require("../electron/services/product-profile-service.cjs");

function createMemoryStore(initial = {}) {
  const state = structuredClone(initial);
  return {
    async get(key) { return structuredClone(state[key]); },
    async set(key, value) {
      state[key] = structuredClone(value);
      return structuredClone(value);
    }
  };
}

test("保存目标商品资料卡并去重参考图和主张", async () => {
  const repository = createProductProfileRepository(createMemoryStore(), { now: () => "2026-08-22T10:00:00.000Z" });
  const saved = await repository.save({
    sku: " 918 ",
    name: "神裤",
    category: "西裤",
    referenceImages: [
      "D:\\商品图\\918-front.jpg",
      { filePath: "D:\\商品图\\918-front.jpg", label: "重复" },
      { filePath: "D:\\商品图\\918-back.jpg", label: "背面" }
    ],
    allowedClaims: ["垂感", "垂感", "宽松直筒"]
  });
  assert.equal(saved.sku, "918");
  assert.equal(saved.referenceImages.length, 2);
  assert.deepEqual(saved.allowedClaims, ["垂感", "宽松直筒"]);
  assert.equal((await repository.get("918")).name, "神裤");
});

test("更新一个款号不会覆盖其他款号", async () => {
  let tick = 0;
  const repository = createProductProfileRepository(createMemoryStore(), { now: () => `2026-08-22T10:00:0${tick++}.000Z` });
  await repository.save({ sku: "918", name: "神裤" });
  await repository.save({ sku: "919", name: "阔腿裤" });
  await repository.save({ sku: "918", name: "神裤升级版" });
  assert.equal((await repository.list()).length, 2);
  assert.equal((await repository.get("918")).name, "神裤升级版");
  assert.equal((await repository.get("919")).name, "阔腿裤");
});

test("所有可添加的图片和文本项目都能移除", async () => {
  const repository = createProductProfileRepository(createMemoryStore());
  await repository.save({
    sku: "918",
    referenceImages: ["D:\\商品图\\918.jpg"],
    allowedClaims: ["显瘦"],
    verificationRequired: ["面料成分"]
  });
  const saved = await repository.save({
    sku: "918",
    referenceImages: [],
    allowedClaims: [],
    verificationRequired: []
  });
  assert.deepEqual(saved.referenceImages, []);
  assert.deepEqual(saved.allowedClaims, []);
  assert.deepEqual(saved.verificationRequired, []);
});

test("可以删除整张资料卡且删除不存在款号时安全返回 false", async () => {
  const repository = createProductProfileRepository(createMemoryStore());
  await repository.save({ sku: "918", name: "神裤" });
  assert.equal(await repository.remove("918"), true);
  assert.equal(await repository.get("918"), null);
  assert.equal(await repository.remove("918"), false);
});

test("没有款号的资料卡拒绝保存", () => {
  assert.throws(
    () => normalizeProductProfile({ name: "无款号商品" }),
    (error) => error.code === "PRODUCT_PROFILE_SKU_REQUIRED"
  );
});
