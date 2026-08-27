const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "prototype", "v1", "index.html"), "utf8");
const bridge = fs.readFileSync(path.join(root, "prototype", "v1", "desktop-bridge.js"), "utf8");
const preload = fs.readFileSync(path.join(root, "electron", "preload.cjs"), "utf8");
const main = fs.readFileSync(path.join(root, "electron", "main.cjs"), "utf8");

test("设置中提供目标商品资料卡完整入口", () => {
  assert.match(html, /data-settings-tab="product"/);
  assert.match(html, /data-settings-pane="product"/);
  for (const id of [
    "productProfileSku",
    "productProfileName",
    "productProfileCategory",
    "productProfileColor",
    "productProfileSilhouette",
    "productProfileFabric",
    "productProfileAudience"
  ]) assert.match(html, new RegExp(`id="${id}"`));
});

test("资料卡所有可添加集合都提供删除交互", () => {
  assert.match(bridge, /data-remove-product-reference/);
  assert.match(bridge, /data-remove-allowed-claim/);
  assert.match(bridge, /data-remove-verification-claim/);
  assert.match(html, /id="deleteProductProfile"/);
});

test("款号选择时显示商品身份状态并可直接编辑", () => {
  assert.match(html, /id="skuProductProfileStatus"/);
  assert.match(html, /id="editSkuProductProfile"/);
  assert.match(bridge, /updateSkuProductProfileStatus\(\)/);
});

test("桌面端只暴露窄范围商品资料 IPC", () => {
  for (const channel of ["product-profile:list", "product-profile:get", "product-profile:save", "product-profile:delete"]) {
    assert.match(main, new RegExp(channel.replace("-", "\\-")));
  }
  assert.match(preload, /listProductProfiles/);
  assert.match(preload, /saveProductProfile/);
  assert.match(preload, /deleteProductProfile/);
  assert.match(preload, /selectProductImages/);
});
