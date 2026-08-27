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

test("右侧预览显示完整 9:16 画幅并可打开窗口级全尺寸预览", () => {
  const html = fs.readFileSync(path.join(root, "prototype", "v1", "index.html"), "utf8");
  const css = fs.readFileSync(path.join(root, "prototype", "v1", "styles.css"), "utf8");
  const app = fs.readFileSync(path.join(root, "prototype", "v1", "app.js"), "utf8");

  assert.match(html, /id="openPreviewButton"[^>]*aria-label="打开全尺寸预览"/);
  assert.match(html, /id="previewDialog"[^>]*clip-preview-dialog[^>]*aria-labelledby="dialogPreviewTitle"/);
  assert.match(html, /class="clip-preview-stage"[^>]*aria-label="9:16 全尺寸素材预览"/);
  assert.match(css, /\.inspector-preview\s*\{[^}]*aspect-ratio:\s*9\s*\/\s*16/);
  assert.match(css, /\.inspector-preview video,\s*\.inspector-preview img\s*\{[^}]*object-fit:\s*contain/);
  assert.match(css, /\.clip-preview-dialog\s*\{[^}]*height:\s*min\(/);
  assert.match(css, /\.clip-preview-dialog \.dialog-video\s*\{[^}]*aspect-ratio:\s*9\s*\/\s*16/);
  assert.match(app, /previewTrigger\.focus\(\)/);
});
