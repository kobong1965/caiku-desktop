const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");

test("脚本管理提供支持多视频的竞品拖拽上传区", () => {
  const html = fs.readFileSync(path.join(root, "prototype", "v1", "index.html"), "utf8");
  assert.match(html, /id="competitorDropZone"/);
  assert.match(html, /id="competitorFileInput"[^>]*multiple/);
});

test("拖入文件通过 Electron 安全接口获取本地路径", () => {
  const app = fs.readFileSync(path.join(root, "prototype", "v1", "app.js"), "utf8");
  assert.match(app, /window\.caiku\?\.getPathForFile/);
  assert.match(app, /competitorDropZone\.addEventListener\("drop"/);
});
