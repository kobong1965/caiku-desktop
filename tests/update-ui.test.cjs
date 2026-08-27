const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("设置中提供完整的软件更新状态与三段操作", () => {
  const html = read("prototype/v1/index.html");
  const app = read("prototype/v1/app.js");
  const css = read("prototype/v1/styles.css");

  assert.match(html, /data-settings-tab="updates"/);
  assert.match(html, /data-settings-pane="updates"/);
  assert.match(html, /id="currentUpdateVersion"/);
  assert.match(html, /id="latestUpdateVersion"/);
  assert.match(html, /id="updateProgress"[\s\S]*?<\/progress>/);
  assert.match(html, /id="checkForUpdatesButton"/);
  assert.match(html, /id="downloadUpdateButton"[^>]*disabled/);
  assert.match(html, /id="installUpdateButton"[^>]*disabled/);
  assert.match(app, /renderUpdateStatus/);
  assert.match(app, /checkForUpdatesButton/);
  assert.match(app, /downloadUpdateButton/);
  assert.match(app, /installUpdateButton/);
  assert.match(app, /"ai-review", "performance", "export", "updates"/);
  assert.match(css, /\.update-card/);
  assert.match(css, /\.update-progress/);
});

test("更新功能只通过窄 preload IPC 暴露，主进程使用 GitHub updater", () => {
  const main = read("electron/main.cjs");
  const preload = read("electron/preload.cjs");
  const pkg = JSON.parse(read("package.json"));
  const lock = JSON.parse(read("package-lock.json"));

  assert.match(main, /require\("electron-updater"\)/);
  assert.match(main, /safeHandle\("update:check"/);
  assert.match(main, /safeHandle\("update:download"/);
  assert.match(main, /safeHandle\("update:install"/);
  assert.match(preload, /checkForUpdates: \(\) => invoke\("update:check"\)/);
  assert.match(preload, /downloadUpdate: \(\) => invoke\("update:download"\)/);
  assert.match(preload, /installUpdate: \(\) => invoke\("update:install"\)/);
  assert.match(preload, /onUpdateStatus/);
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[""].version, pkg.version);
  assert.equal(pkg.dependencies["electron-updater"], "6.8.9");
  assert.deepEqual(pkg.build.publish[0], { provider: "github", owner: "kobong1965", repo: "caiku-desktop" });
});
