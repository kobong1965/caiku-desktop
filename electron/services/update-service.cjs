function createUpdateError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeProgress(progress = {}) {
  return {
    percent: Math.max(0, Math.min(100, Number(progress.percent || 0))),
    transferred: Math.max(0, Number(progress.transferred || 0)),
    total: Math.max(0, Number(progress.total || 0)),
    bytesPerSecond: Math.max(0, Number(progress.bytesPerSecond || 0))
  };
}

function createUpdateController({ updater, isPackaged, currentVersion, emit = () => {} }) {
  if (!updater?.on || !updater?.checkForUpdates || !updater?.downloadUpdate || !updater?.quitAndInstall) {
    throw new TypeError("更新器接口不完整");
  }

  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;

  let state = {
    phase: "idle",
    currentVersion: String(currentVersion || "0.0.0"),
    latestVersion: null,
    releaseName: "",
    releaseDate: "",
    progress: normalizeProgress(),
    message: isPackaged ? "点击检查 GitHub 上的最新正式版本" : "开发模式不会连接更新服务器",
    errorCode: "",
    isPackaged: Boolean(isPackaged)
  };

  const snapshot = () => ({ ...state, progress: { ...state.progress } });
  const publish = (patch) => {
    state = { ...state, ...patch };
    emit(snapshot());
    return snapshot();
  };

  updater.on("checking-for-update", () => publish({
    phase: "checking",
    message: "正在检查 GitHub 最新版本…",
    errorCode: ""
  }));
  updater.on("update-available", (info = {}) => publish({
    phase: "available",
    latestVersion: String(info.version || ""),
    releaseName: String(info.releaseName || ""),
    releaseDate: String(info.releaseDate || ""),
    progress: normalizeProgress(),
    message: `发现新版本 ${String(info.version || "")}`,
    errorCode: ""
  }));
  updater.on("update-not-available", (info = {}) => publish({
    phase: "latest",
    latestVersion: String(info.version || currentVersion || ""),
    releaseName: String(info.releaseName || ""),
    releaseDate: String(info.releaseDate || ""),
    progress: normalizeProgress(),
    message: "当前已是最新版本",
    errorCode: ""
  }));
  updater.on("download-progress", (progress) => {
    const normalized = normalizeProgress(progress);
    publish({
      phase: "downloading",
      progress: normalized,
      message: `正在下载更新 ${Math.round(normalized.percent)}%`,
      errorCode: ""
    });
  });
  updater.on("update-downloaded", (info = {}) => publish({
    phase: "downloaded",
    latestVersion: String(info.version || state.latestVersion || ""),
    progress: { ...state.progress, percent: 100 },
    message: "更新包已下载并校验完成，可以安装",
    errorCode: ""
  }));
  updater.on("error", (error) => publish({
    phase: "error",
    message: error?.message || "检查更新失败，请稍后重试",
    errorCode: error?.code || "UPDATE_ERROR"
  }));

  return Object.freeze({
    getState: snapshot,
    async check() {
      if (!isPackaged) throw createUpdateError("UPDATE_PACKAGED_ONLY", "开发模式不检查线上更新，请在正式安装版中使用");
      if (["checking", "downloading"].includes(state.phase)) return snapshot();
      publish({ phase: "checking", message: "正在检查 GitHub 最新版本…", errorCode: "" });
      await updater.checkForUpdates();
      return snapshot();
    },
    async download() {
      if (state.phase !== "available") throw createUpdateError("UPDATE_NOT_AVAILABLE", "当前没有可下载的新版本");
      publish({ phase: "downloading", progress: normalizeProgress(), message: "正在准备下载更新…", errorCode: "" });
      await updater.downloadUpdate();
      return snapshot();
    },
    install() {
      if (state.phase !== "downloaded") throw createUpdateError("UPDATE_NOT_DOWNLOADED", "更新包尚未下载完成");
      updater.quitAndInstall(false, true);
      return true;
    }
  });
}

module.exports = { createUpdateController, normalizeProgress };
