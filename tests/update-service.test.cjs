const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const { createUpdateController, normalizeProgress } = require("../electron/services/update-service.cjs");

class FakeUpdater extends EventEmitter {
  constructor() {
    super();
    this.autoDownload = true;
    this.autoInstallOnAppQuit = true;
    this.checkCount = 0;
    this.downloadCount = 0;
    this.installArgs = null;
  }

  async checkForUpdates() {
    this.checkCount += 1;
    this.emit("checking-for-update");
    this.emit("update-available", { version: "0.1.12", releaseName: "裁库 0.1.12", releaseDate: "2026-08-22T00:00:00.000Z" });
  }

  async downloadUpdate() {
    this.downloadCount += 1;
    this.emit("download-progress", { percent: 42.6, transferred: 426, total: 1000, bytesPerSecond: 120 });
    this.emit("update-downloaded", { version: "0.1.12" });
  }

  quitAndInstall(...args) {
    this.installArgs = args;
  }
}

test("更新控制器关闭自动下载和退出自动安装，并发布标准状态", async () => {
  const updater = new FakeUpdater();
  const events = [];
  const controller = createUpdateController({
    updater,
    isPackaged: true,
    currentVersion: "0.1.11",
    emit: (payload) => events.push(payload)
  });

  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, false);

  const available = await controller.check();
  assert.equal(available.phase, "available");
  assert.equal(available.latestVersion, "0.1.12");
  assert.equal(events.at(-1).phase, "available");

  const downloaded = await controller.download();
  assert.equal(downloaded.phase, "downloaded");
  assert.equal(downloaded.progress.percent, 100);
  assert.equal(updater.downloadCount, 1);

  controller.install();
  assert.deepEqual(updater.installArgs, [false, true]);
});

test("开发模式拒绝联网检查，未发现更新时禁止下载和安装", async () => {
  const updater = new FakeUpdater();
  const controller = createUpdateController({ updater, isPackaged: false, currentVersion: "0.1.11", emit: () => {} });
  await assert.rejects(() => controller.check(), (error) => error.code === "UPDATE_PACKAGED_ONLY");
  await assert.rejects(() => controller.download(), (error) => error.code === "UPDATE_NOT_AVAILABLE");
  assert.throws(() => controller.install(), (error) => error.code === "UPDATE_NOT_DOWNLOADED");
  assert.equal(updater.checkCount, 0);
});

test("下载进度被限制在 0 到 100 并保留字节信息", () => {
  assert.deepEqual(normalizeProgress({ percent: 109, transferred: 15, total: 10, bytesPerSecond: 7 }), {
    percent: 100,
    transferred: 15,
    total: 10,
    bytesPerSecond: 7
  });
  assert.equal(normalizeProgress({ percent: -2 }).percent, 0);
});
