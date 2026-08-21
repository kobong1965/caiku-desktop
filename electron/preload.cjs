const { contextBridge, ipcRenderer, webUtils } = require("electron");

async function invoke(channel, payload) {
  const response = await ipcRenderer.invoke(channel, payload);
  if (response?.ok) return response.data;
  const error = new Error(response?.error?.message || "桌面服务调用失败");
  Object.assign(error, response?.error || {});
  throw error;
}

contextBridge.exposeInMainWorld("caiku", Object.freeze({
  platform: process.platform,
  getPathForFile: (file) => webUtils.getPathForFile(file),
  getBootstrap: () => invoke("app:get-bootstrap"),
  minimizeWindow: () => invoke("window:minimize"),
  toggleMaximizeWindow: () => invoke("window:toggle-maximize"),
  closeWindow: () => invoke("window:close"),
  selectVideos: () => invoke("dialog:select-videos"),
  selectAudio: (kind) => invoke("dialog:select-audio", { kind }),
  selectFolder: (defaultPath) => invoke("dialog:select-folder", { defaultPath }),
  probeVideos: (paths) => invoke("videos:probe", { paths }),
  listSkuOptions: () => invoke("sku:list"),
  getTodayTasks: () => invoke("tasks:get-today"),
  processBatch: (payload) => invoke("batch:process", payload),
  loadManifest: (manifestPath) => invoke("batch:load-manifest", { manifestPath }),
  listBatches: (rootDir) => invoke("batch:list", { rootDir }),
  checkText: (text) => invoke("compliance:check-text", { text }),
  analyzeCompetitor: (filePath) => invoke("competitor:analyze", { filePath }),
  createEditingPlan: (payload) => invoke("editor:plan", payload),
  mixBatch: (payload) => invoke("mix:start", payload),
  cancelTask: (taskId) => invoke("task:cancel", { taskId }),
  openPath: (targetPath) => invoke("system:open-path", { targetPath }),
  trashPath: (targetPath) => invoke("system:trash-path", { targetPath }),
  trashMaterial: (material) => invoke("material:trash", {
    id: material.id,
    filePath: material.filePath,
    thumbnailPath: material.thumbnailPath,
    manifestPath: material.manifestPath
  }),
  saveSettings: (settings) => invoke("state:save-settings", settings),
  saveAiSettings: (settings, apiKey) => invoke("ai:save-settings", { settings, apiKey }),
  testAiConnection: (settings, apiKey) => invoke("ai:test-connection", { settings, apiKey }),
  clearAiKey: () => invoke("ai:clear-key"),
  checkForUpdates: () => invoke("update:check"),
  downloadUpdate: () => invoke("update:download"),
  installUpdate: () => invoke("update:install"),
  saveProjectState: (projectState) => invoke("state:save-project", { projectState }),
  onProgress: (listener) => {
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on("caiku:progress", wrapped);
    return () => ipcRenderer.removeListener("caiku:progress", wrapped);
  },
  onWindowState: (listener) => {
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on("caiku:window-state", wrapped);
    return () => ipcRenderer.removeListener("caiku:window-state", wrapped);
  },
  onUpdateStatus: (listener) => {
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on("caiku:update-status", wrapped);
    return () => ipcRenderer.removeListener("caiku:update-status", wrapped);
  }
}));
