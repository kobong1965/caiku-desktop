const { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { autoUpdater } = require("electron-updater");
const { JsonStore } = require("./services/store.cjs");
const { inspectCapabilities } = require("./services/process-runner.cjs");
const { checkText } = require("./services/compliance-engine.cjs");
const { probeVideo } = require("./services/video-engine.cjs");
const { findManifests, listSkuOptions, loadManifest, processBatch, sanitizeFileSegment } = require("./services/workspace-service.cjs");
const { mixBatch } = require("./services/mix-engine.cjs");
const { analyzeCompetitorVideo } = require("./services/competitor-analysis-service.cjs");
const { auditGeneratedOutput } = require("./services/quality-audit-service.cjs");
const { DEFAULT_AI_SETTINGS, normalizeAiSettings, testQwenConnection } = require("./services/ai-classifier.cjs");
const { DEFAULT_LOCAL_EDITOR_SETTINGS, createEditingPlan, normalizeLocalEditorSettings } = require("./services/ai-editor-service.cjs");
const { createUpdateController } = require("./services/update-service.cjs");
const {
  buildTodayTaskBoard,
  completeClassificationTask,
  createClassificationTask,
  failClassificationTask,
  normalizeTaskRecord,
  recoverInterruptedTasks
} = require("./services/task-board-service.cjs");

let mainWindow;
let store;
let updateController;
const activeTasks = new Map();

function defaultMaterialRoot() {
  if (process.platform === "win32" && fs.existsSync("D:\\")) return "D:\\抖音素材库";
  return path.join(app.getPath("videos"), "裁库素材库");
}

function serializeError(error) {
  return {
    name: error?.name || "Error",
    message: error?.message || String(error),
    code: typeof error?.code === "string" ? error.code : "UNKNOWN_ERROR",
    details: error?.report || null,
    stderr: error?.stderr ? String(error.stderr).slice(-3000) : "",
    batchDir: error?.batchDir || null,
    manifestPath: error?.manifestPath || null
  };
}

function safeHandle(channel, handler) {
  ipcMain.handle(channel, async (event, payload) => {
    if (!event.senderFrame?.url?.startsWith("file:")) {
      return { ok: false, error: { code: "UNTRUSTED_SENDER", message: "已拒绝非本地页面调用" } };
    }
    try {
      return { ok: true, data: await handler(event, payload || {}) };
    } catch (error) {
      return { ok: false, error: serializeError(error) };
    }
  });
}

function taskId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function upsertClassificationTask(nextTask) {
  const records = (await store.get("classificationTasks") || []).map(normalizeTaskRecord);
  const index = records.findIndex((task) => task.id === nextTask.id);
  if (index >= 0) records.splice(index, 1);
  records.unshift(normalizeTaskRecord(nextTask));
  return store.set("classificationTasks", records.slice(0, 300));
}

async function getTodayTaskBoard(materialRoot) {
  const [records, batches] = await Promise.all([
    store.get("classificationTasks"),
    findManifests(materialRoot)
  ]);
  return buildTodayTaskBoard({ records: records || [], batches });
}

function sendWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("caiku:window-state", { isMaximized: mainWindow.isMaximized() });
}

function sendProgress(event, task, payload) {
  if (!event.sender.isDestroyed()) event.sender.send("caiku:progress", { taskId: task, ...payload });
}

function sendUpdateStatus(payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("caiku:update-status", payload);
}

async function getSavedQwenKey() {
  const secrets = await store.get("providerSecrets") || {};
  if (!secrets.qwen) return "";
  if (!safeStorage.isEncryptionAvailable()) {
    const error = new Error("Windows 安全存储当前不可用，无法读取千问 API Key");
    error.code = "SECURE_STORAGE_UNAVAILABLE";
    throw error;
  }
  try {
    return safeStorage.decryptString(Buffer.from(secrets.qwen, "base64"));
  } catch {
    const error = new Error("已保存的千问 API Key 无法解密，请清除后重新填写");
    error.code = "AI_KEY_DECRYPT_FAILED";
    throw error;
  }
}

async function saveQwenKey(apiKey) {
  const trimmed = String(apiKey || "").trim();
  if (!trimmed) return false;
  if (!safeStorage.isEncryptionAvailable()) {
    const error = new Error("Windows 安全存储当前不可用，为避免明文落盘，API Key 未保存");
    error.code = "SECURE_STORAGE_UNAVAILABLE";
    throw error;
  }
  const secrets = await store.get("providerSecrets") || {};
  secrets.qwen = safeStorage.encryptString(trimmed).toString("base64");
  await store.set("providerSecrets", secrets);
  return true;
}

async function clearQwenKey() {
  const secrets = await store.get("providerSecrets") || {};
  delete secrets.qwen;
  await store.set("providerSecrets", secrets);
}

async function sanitizeSettings(settings) {
  const secrets = await store.get("providerSecrets") || {};
  return {
    ...settings,
    aiClassification: {
      ...normalizeAiSettings(settings?.aiClassification || DEFAULT_AI_SETTINGS),
      hasApiKey: Boolean(secrets.qwen),
      secureStorageAvailable: safeStorage.isEncryptionAvailable()
    },
    aiEditor: normalizeLocalEditorSettings(settings?.aiEditor || DEFAULT_LOCAL_EDITOR_SETTINGS)
  };
}

function registerIpc() {
  safeHandle("app:get-bootstrap", async () => {
    const storedSettings = await store.get("settings");
    const settings = await sanitizeSettings(storedSettings);
    const capabilities = await inspectCapabilities();
    const batches = await findManifests(settings.materialRoot);
    const taskBoard = buildTodayTaskBoard({ records: await store.get("classificationTasks") || [], batches });
    return {
      app: { name: app.getName(), version: app.getVersion(), platform: process.platform },
      update: updateController?.getState() || null,
      window: { isMaximized: Boolean(mainWindow?.isMaximized()) },
      capabilities,
      settings,
      projectState: await store.get("projectState"),
      taskBoard,
      batches: batches.map((batch) => ({
        sku: batch.sku,
        batchName: batch.batchName,
        status: batch.status,
        updatedAt: batch.updatedAt,
        batchDir: batch.batchDir,
        manifestPath: batch.manifestPath,
        summary: batch.summary,
        materials: (batch.materials || []).map((material) => ({ ...material, manifestPath: batch.manifestPath, batchDir: batch.batchDir }))
      }))
    };
  });

  safeHandle("dialog:select-videos", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "选择原视频",
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: "视频文件", extensions: ["mp4", "mov", "mkv", "m4v"] },
        { name: "所有文件", extensions: ["*"] }
      ]
    });
    return result.canceled ? [] : result.filePaths;
  });

  safeHandle("dialog:select-audio", async (_event, payload) => {
    const isMusic = payload.kind === "music";
    const result = await dialog.showOpenDialog(mainWindow, {
      title: isMusic ? "选择音乐" : "选择配音",
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: "音频文件", extensions: ["mp3", "wav", "m4a", "aac", "flac"] },
        { name: "所有文件", extensions: ["*"] }
      ]
    });
    return result.canceled ? [] : result.filePaths;
  });

  safeHandle("dialog:select-folder", async (_event, payload) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "选择素材盘目录",
      defaultPath: payload.defaultPath,
      properties: ["openDirectory", "createDirectory"]
    });
    return result.canceled ? null : result.filePaths[0];
  });

  safeHandle("videos:probe", async (_event, payload) => Promise.all((payload.paths || []).map(probeVideo)));

  safeHandle("sku:list", async () => {
    const settings = await store.get("settings");
    return listSkuOptions(settings.materialRoot);
  });

  safeHandle("tasks:get-today", async () => {
    const settings = await store.get("settings");
    return getTodayTaskBoard(settings.materialRoot);
  });

  safeHandle("batch:process", async (event, payload) => {
    const id = taskId("process");
    const controller = new AbortController();
    const currentSettings = await store.get("settings");
    const sku = sanitizeFileSegment(payload.sku, "");
    const batchName = sanitizeFileSegment(payload.batchName, "");
    if (!sku) throw Object.assign(new Error("请选择或新建一个款号"), { code: "SKU_REQUIRED" });
    if (!batchName) throw Object.assign(new Error("请填写批次名称"), { code: "BATCH_NAME_REQUIRED" });
    const task = createClassificationTask({ id, sku, batchName, sourceCount: payload.sourcePaths?.length || 0 });
    await upsertClassificationTask(task);
    activeTasks.set(id, controller);
    try {
      const aiSettings = normalizeAiSettings(currentSettings.aiClassification || DEFAULT_AI_SETTINGS);
      const apiKey = await getSavedQwenKey();
      const result = await processBatch({
        ...payload,
        taskId: id,
        sku,
        batchName,
        rootDir: currentSettings.materialRoot
      }, {
        appVersion: app.getVersion(),
        signal: controller.signal,
        onProgress: (progress) => sendProgress(event, id, progress),
        classificationRuntime: { settings: aiSettings, apiKey }
      });
      const recent = await store.get("recentManifests") || [];
      await store.patch({
        recentManifests: [result.manifestPath, ...recent.filter((item) => item !== result.manifestPath)].slice(0, 30),
        lastBatchManifest: result.manifestPath
      });
      await upsertClassificationTask(completeClassificationTask(task, result));
      return { taskId: id, ...result };
    } catch (error) {
      await upsertClassificationTask(failClassificationTask(task, error)).catch(() => {});
      throw error;
    } finally {
      activeTasks.delete(id);
    }
  });

  safeHandle("batch:load-manifest", async (_event, payload) => loadManifest(path.resolve(payload.manifestPath)));
  safeHandle("batch:list", async (_event, payload) => findManifests(path.resolve(payload.rootDir)));

  safeHandle("compliance:check-text", async (_event, payload) => checkText(payload.text));

  safeHandle("competitor:analyze", async (event, payload) => {
    const id = taskId("competitor");
    const controller = new AbortController();
    activeTasks.set(id, controller);
    try {
      const currentSettings = await store.get("settings");
      const settings = normalizeAiSettings(currentSettings.aiClassification || DEFAULT_AI_SETTINGS);
      const apiKey = await getSavedQwenKey();
      const result = await analyzeCompetitorVideo(payload.filePath, {
        settings,
        apiKey,
        tempRoot: app.getPath("temp"),
        signal: controller.signal,
        onProgress: (progress) => sendProgress(event, id, progress)
      });
      return { taskId: id, ...result };
    } finally {
      activeTasks.delete(id);
    }
  });

  safeHandle("editor:plan", async (event, payload) => {
    const id = taskId("editor-plan");
    const controller = new AbortController();
    activeTasks.set(id, controller);
    try {
      const currentSettings = await store.get("settings");
      const settings = normalizeLocalEditorSettings(currentSettings.aiEditor || DEFAULT_LOCAL_EDITOR_SETTINGS);
      sendProgress(event, id, { stage: "editor_prepare", progress: 0.08, message: "正在整理脚本与所选素材的能力卡…" });
      const plan = await createEditingPlan(payload, { settings, signal: controller.signal });
      sendProgress(event, id, { stage: "editor_done", progress: 1, message: "AI 剪辑师已完成逐段安排，请检查证据缺口" });
      return { taskId: id, ...plan };
    } finally {
      activeTasks.delete(id);
    }
  });

  safeHandle("mix:start", async (event, payload) => {
    const id = taskId("mix");
    const controller = new AbortController();
    activeTasks.set(id, controller);
    try {
      const currentSettings = await store.get("settings");
      const aiSettings = normalizeAiSettings(currentSettings.aiClassification || DEFAULT_AI_SETTINGS);
      const apiKey = await getSavedQwenKey();
      if (!apiKey) {
        const error = new Error("混剪成片必须经过千问逐条质检，请先到“设置 > 大模型”配置 API Key");
        error.code = "AI_KEY_REQUIRED";
        throw error;
      }
      const result = await mixBatch(payload, {
        signal: controller.signal,
        onProgress: (progress) => sendProgress(event, id, { ...progress, progress: Number(progress.progress || 0) * 0.72 })
      });
      let repeatedAuditError = null;
      for (let index = 0; index < result.outputs.length; index += 1) {
        const output = result.outputs[index];
        sendProgress(event, id, {
          stage: "ai_quality",
          progress: 0.72 + (index / result.outputs.length) * 0.28,
          message: `千问正在逐条核对画面、脚本和可见风险词 ${index + 1}/${result.outputs.length}`
        });
        let audit;
        try {
          if (repeatedAuditError) throw repeatedAuditError;
          audit = await auditGeneratedOutput(output, {
            tempRoot: app.getPath("temp"),
            settings: aiSettings,
            apiKey,
            signal: controller.signal,
            script: payload.script,
            materialSummary: (payload.materials || []).map((material) => ({ name: material.name, type: material.type, typeLabel: material.typeLabel }))
          });
        } catch (error) {
          if (["AI_KEY_INVALID", "AI_ABORTED"].includes(error?.code)) repeatedAuditError = error;
          audit = {
            status: "blocked",
            alignmentScore: 0,
            summary: `千问逐条质检未完成：${error.message}`,
            issues: [{ level: "block", name: "大模型质检未完成", detail: error.message, timeHint: "" }],
            observedScenes: [],
            visibleTexts: [],
            provider: "qwen",
            model: aiSettings.model,
            mode: "qwen_visual_quality_audit_failed",
            frameCount: 0
          };
        }
        output.report.visualSemantic = audit;
        output.report.aiModel = { provider: "qwen", model: aiSettings.model, checkedAt: new Date().toISOString() };
        output.report.status = audit.status === "blocked" || output.report.technical.status !== "pass" || output.report.script.status === "blocked"
          ? "blocked"
          : audit.status === "review" || output.report.materialCoverage.status !== "pass" || output.report.script.status !== "pass" ? "review" : "pass";
        output.status = output.report.status;
        output.score = Math.max(0, Math.round((output.score * 3 + audit.alignmentScore) / 4));
        await fs.promises.writeFile(output.reportPath, `${JSON.stringify(output.report, null, 2)}\n`, "utf8");
      }
      sendProgress(event, id, { stage: "done", progress: 1, message: `${result.outputs.length} 条成片均已完成千问视觉质检` });
      await store.patch({ lastOutputDirectory: result.outputDir, lastQualityDirectory: result.reportDir });
      return { taskId: id, ...result };
    } finally {
      activeTasks.delete(id);
    }
  });

  safeHandle("task:cancel", async (_event, payload) => {
    const controller = activeTasks.get(payload.taskId);
    if (!controller) return false;
    controller.abort();
    return true;
  });

  safeHandle("window:minimize", async () => {
    mainWindow?.minimize();
    return true;
  });

  safeHandle("window:toggle-maximize", async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
    return mainWindow.isMaximized();
  });

  safeHandle("window:close", async () => {
    const targetWindow = mainWindow;
    setImmediate(() => targetWindow?.close());
    return true;
  });

  safeHandle("update:check", async () => updateController.check());
  safeHandle("update:download", async () => updateController.download());
  safeHandle("update:install", async () => updateController.install());

  safeHandle("system:open-path", async (_event, payload) => {
    const targetPath = path.resolve(payload.targetPath);
    const error = await shell.openPath(targetPath);
    if (error) throw new Error(error);
    return true;
  });

  safeHandle("system:trash-path", async (_event, payload) => {
    const targetPath = path.resolve(payload.targetPath);
    if (!fs.existsSync(targetPath)) return false;
    await shell.trashItem(targetPath);
    return true;
  });

  safeHandle("material:trash", async (_event, payload) => {
    const targets = [payload.filePath, payload.thumbnailPath].filter(Boolean).map((targetPath) => path.resolve(targetPath));
    for (const targetPath of targets) {
      if (fs.existsSync(targetPath)) await shell.trashItem(targetPath);
    }
    if (payload.manifestPath && fs.existsSync(path.resolve(payload.manifestPath))) {
      const manifestPath = path.resolve(payload.manifestPath);
      const manifest = JSON.parse(await fs.promises.readFile(manifestPath, "utf8"));
      manifest.materials = (manifest.materials || []).filter((material) => material.id !== payload.id);
      manifest.updatedAt = new Date().toISOString();
      if (manifest.summary) {
        manifest.summary.materialCount = manifest.materials.length;
        manifest.summary.minimumDuration = manifest.materials.length ? Math.min(...manifest.materials.map((material) => Number(material.duration || 0))) : 0;
      }
      const temporaryPath = `${manifestPath}.tmp`;
      await fs.promises.writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
      await fs.promises.rename(temporaryPath, manifestPath);
    }
    return true;
  });

  safeHandle("state:save-settings", async (_event, payload) => {
    const current = await store.get("settings");
    const next = {
      ...current,
      materialRoot: path.resolve(payload.materialRoot || current.materialRoot),
      keepOriginals: payload.keepOriginals !== false,
      captionMode: ["smart_mask", "blur_band", "crop_reframe", "keep"].includes(payload.captionMode) ? payload.captionMode : current.captionMode,
      minimumClipSeconds: 2,
      outputSpec: current.outputSpec
    };
    await store.set("settings", next);
    return sanitizeSettings(next);
  });

  safeHandle("ai:save-settings", async (_event, payload) => {
    const current = await store.get("settings");
    if (String(payload.apiKey || "").trim()) await saveQwenKey(payload.apiKey);
    const next = {
      ...current,
      aiClassification: normalizeAiSettings(payload.settings || current.aiClassification || DEFAULT_AI_SETTINGS)
    };
    await store.set("settings", next);
    return sanitizeSettings(next);
  });

  safeHandle("ai:test-connection", async (_event, payload) => {
    const current = await store.get("settings");
    const settings = normalizeAiSettings(payload.settings || current.aiClassification || DEFAULT_AI_SETTINGS);
    const apiKey = String(payload.apiKey || "").trim() || await getSavedQwenKey();
    return testQwenConnection({ settings, apiKey });
  });

  safeHandle("ai:clear-key", async () => {
    await clearQwenKey();
    const current = await store.get("settings");
    return sanitizeSettings(current);
  });

  safeHandle("state:save-project", async (_event, payload) => store.set("projectState", payload.projectState || {}));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    title: "裁库",
    icon: app.isPackaged
      ? path.join(process.resourcesPath, "icon.ico")
      : path.join(__dirname, "..", "build", "icon.ico"),
    width: 1440,
    height: 940,
    minWidth: 1180,
    minHeight: 760,
    frame: false,
    show: false,
    backgroundColor: "#f4f5f2",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      devTools: !app.isPackaged
    }
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url !== mainWindow.webContents.getURL()) event.preventDefault();
  });
  mainWindow.on("maximize", sendWindowState);
  mainWindow.on("unmaximize", sendWindowState);
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.loadFile(path.join(__dirname, "..", "prototype", "v1", "index.html"));
}

app.whenReady().then(async () => {
  app.setAppUserModelId("com.caiku.desktop");
  store = new JsonStore(path.join(app.getPath("userData"), "caiku-state.json"), {
    settings: {
      materialRoot: defaultMaterialRoot(),
      keepOriginals: true,
      captionMode: "smart_mask",
      minimumClipSeconds: 2,
      outputSpec: { width: 1080, height: 1920, aspectRatio: "9:16", fps: 30, videoCodec: "H.264", audioCodec: "AAC", sampleRate: 48000 },
      aiClassification: DEFAULT_AI_SETTINGS,
      aiEditor: DEFAULT_LOCAL_EDITOR_SETTINGS
    },
    projectState: {},
    recentManifests: [],
    classificationTasks: [],
    providerSecrets: {}
  });
  await store.ready;
  const storedSettings = await store.get("settings");
  if (!storedSettings.aiClassification) {
    await store.set("settings", { ...storedSettings, aiClassification: DEFAULT_AI_SETTINGS });
  }
  const migratedSettings = await store.get("settings");
  if (!migratedSettings.aiEditor) {
    await store.set("settings", { ...migratedSettings, aiEditor: DEFAULT_LOCAL_EDITOR_SETTINGS });
  }
  const recoveredTasks = recoverInterruptedTasks(await store.get("classificationTasks") || []);
  await store.set("classificationTasks", recoveredTasks);
  updateController = createUpdateController({
    updater: autoUpdater,
    isPackaged: app.isPackaged,
    currentVersion: app.getVersion(),
    emit: sendUpdateStatus
  });
  registerIpc();
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  for (const controller of activeTasks.values()) controller.abort();
});

process.on("unhandledRejection", (error) => {
  console.error("Unhandled rejection", error);
});
