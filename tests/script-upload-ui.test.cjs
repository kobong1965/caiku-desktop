const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");

test("脚本管理提供只接收用户投喂视频的多文件拖拽学习区", () => {
  const html = fs.readFileSync(path.join(root, "prototype", "v1", "index.html"), "utf8");
  assert.match(html, /id="competitorDropZone"/);
  assert.match(html, /id="competitorFileInput"[^>]*multiple/);
  assert.match(html, /只学你上传/);
  assert.match(html, /不会联网搜索、抓取或下载市场视频/);
});

test("拖入文件通过 Electron 安全接口获取本地路径", () => {
  const app = fs.readFileSync(path.join(root, "prototype", "v1", "app.js"), "utf8");
  assert.match(app, /window\.caiku\?\.getPathForFile/);
  assert.match(app, /competitorDropZone\.addEventListener\("drop"/);
});

test("每个学习任务都有暂停继续重试金标和删除入口", () => {
  const app = fs.readFileSync(path.join(root, "prototype", "v1", "app.js"), "utf8");
  assert.match(app, /data-pause-market-script/);
  assert.match(app, /data-mark-market-gold/);
  assert.match(app, /data-delete-competitor/);
  assert.match(app, /item\.status === "paused" \? "继续"/);
  assert.match(app, /\["ready", "failed", "paused"\]/);
});
