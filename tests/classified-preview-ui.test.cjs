const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");

test("分类素材卡片携带可播放地址并显示静音状态", () => {
  const bridge = fs.readFileSync(path.join(root, "prototype", "v1", "desktop-bridge.js"), "utf8");
  assert.match(bridge, /data-video-url=/);
  assert.match(bridge, /data-audio-muted=/);
  assert.match(bridge, /clip-audio-badge/);
  assert.match(bridge, /selectClip\(card, \{ play: true \}\)/);
});

test("右侧预览和大屏预览都使用静音 video 元素", () => {
  const html = fs.readFileSync(path.join(root, "prototype", "v1", "index.html"), "utf8");
  assert.match(html, /id="inspectorVideo"[^>]*controls[^>]*muted/);
  assert.match(html, /id="dialogPreviewVideo"[^>]*controls[^>]*muted/);
});
