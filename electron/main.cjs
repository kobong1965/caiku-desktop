const { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { autoUpdater } = require("electron-updater");
const { JsonStore } = require("./services/store.cjs");
const { inspectCapabilities } = require("./services/process-runner.cjs");
const { checkScript, checkText } = require("./services/compliance-engine.cjs");
const { analyzeAudioQuality } = require("./services/audio-quality-service.cjs");
const { verifyFinalCaptions } = require("./services/caption-verification-service.cjs");
const { probeVideo } = require("./services/video-engine.cjs");
const { findManifests, listSkuOptions, loadManifest, processBatch, sanitizeFileSegment } = require("./services/workspace-service.cjs");
const { mixBatch } = require("./services/mix-engine.cjs");
const { synthesizeQwenVoice } = require("./services/qwen-tts-service.cjs");
const { analyzeCompetitorVideo } = require("./services/competitor-analysis-service.cjs");
const { auditGeneratedOutput, finalizeQualityReport } = require("./services/quality-audit-service.cjs");
const { finalizeCandidateOutput } = require("./services/output-gate-service.cjs");
const { createRepairPlan } = require("./services/repair-planner-service.cjs");
const { DEFAULT_AI_SETTINGS, normalizeAiSettings, testOllamaConnection, testQwenConnection } = require("./services/ai-classifier.cjs");
const { DEFAULT_LOCAL_EDITOR_SETTINGS, createEditingPlan, normalizeLocalEditorSettings } = require("./services/ai-editor-service.cjs");
const { DEFAULT_AI_ROUTING_SETTINGS, buildTaskRoute, normalizeAiRoutingSettings } = require("./services/ai-model-router.cjs");
const { createClassifiedMaterialCatalog, readClassifiedMaterialCatalog } = require("./services/classified-material-catalog-service.cjs");
const { createEditingFeedbackService } = require("./services/editing-feedback-service.cjs");
const { retrieveEditingCases } = require("./services/editing-retrieval-service.cjs");
const { createEditingTrainingRepository } = require("./services/editing-training-repository.cjs");
const { createClassificationDeletionPlan, createMaterialDeletionPlan, isSameOrWithin, validateManifestPath } = require("./services/classification-delete-service.cjs");
const { createProductProfileRepository } = require("./services/product-profile-service.cjs");
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
let productProfileRepository;
let updateController;
const activeTasks = new Map();

const NATURAL_SEEDING_SCRIPT = Object.freeze({
  id: "s5-918-v3-natural-seeding-20s",
  name: "918 自然种草口播 20秒",
  duration: 20,
  voiceMode: "full_voice",
  blocks: [
    { id: "s5-b1", name: "真实开场", duration: 4, category: "人物穿搭", type: "outfit", visualInstruction: "目标商品正面全身上身画面", subtitleText: "先看上身", voiceText: "这条西裤我最近是真挺爱穿的，先给你们看上身。", voiceEnabled: true },
    { id: "s5-b2", name: "双褶细节", duration: 4, category: "细节讲解", type: "detail", visualInstruction: "目标商品腰头双褶近景", subtitleText: "双褶利落", voiceText: "腰头的双褶做得很利落，正面看不会显得拖沓。", voiceEnabled: true },
    { id: "s5-b3", name: "版型验证", duration: 4, category: "人物穿搭", type: "outfit", visualInstruction: "目标商品站立与转身轮廓", subtitleText: "宽松直筒", voiceText: "裤腿是宽松直筒的，站着和转身都能看清轮廓。", voiceEnabled: true },
    { id: "s5-b4", name: "搭配场景", duration: 4, category: "人物穿搭", type: "outfit", visualInstruction: "目标商品搭配针织或短袖画面", subtitleText: "通勤日常都好搭", voiceText: "黑色搭针织或者短袖都顺眼，通勤日常穿也不费劲。", voiceEnabled: true },
    { id: "s5-b5", name: "克制行动", styleRole: "soft_cta", duration: 4, category: "整体展示", type: "overall", visualInstruction: "目标商品完整上身收尾", subtitleText: "商品卡看尺码", voiceText: "喜欢这种干净利落的感觉，可以点商品卡再看看尺码。", voiceEnabled: true }
  ]
});

const REAL_REVIEW_SHORT_SCRIPT = Object.freeze({
  id: "s6-918-real-review-short-29s",
  name: "918 真人短种草 29秒",
  duration: 29,
  voiceMode: "full_voice",
  voiceStyleId: "real-review-short",
  blocks: [
    { id: "s6-b1", name: "购买痛点", styleRole: "pain_hook", duration: 5, category: "人物穿搭", type: "outfit", visualInstruction: "目标商品正面全身上身画面", subtitleText: "太窄挑腿 · 太宽没精神", voiceText: "买西裤最怕什么？太窄挑腿，太宽又容易没精神。", voiceEnabled: true },
    { id: "s6-b2", name: "双褶证据", styleRole: "visible_evidence", duration: 8, category: "细节讲解", type: "detail", visualInstruction: "目标商品腰头双褶近景后回到正面上身", subtitleText: "先看上身 · 双褶利落", voiceText: "这条918我先不急着夸，直接看上身。你看腰头这个双褶，正面还是挺利落的。", voiceEnabled: true },
    { id: "s6-b3", name: "版型证据", styleRole: "visible_evidence", duration: 6, category: "人物穿搭", type: "outfit", visualInstruction: "目标商品站立与转身轮廓", subtitleText: "宽松直筒", voiceText: "裤腿做的是宽松直筒，站着、转身都能看清轮廓。", voiceEnabled: true },
    { id: "s6-b4", name: "真实场景", styleRole: "use_case", duration: 6, category: "人物穿搭", type: "outfit", visualInstruction: "目标商品搭配针织或短袖画面", subtitleText: "通勤日常都顺眼", voiceText: "黑色平时搭针织或者短袖都顺眼，通勤日常穿也不费劲。", voiceEnabled: true },
    { id: "s6-b5", name: "克制收口", styleRole: "soft_cta", duration: 4, category: "整体展示", type: "overall", visualInstruction: "目标商品完整上身收尾", subtitleText: "再看看尺码", voiceText: "喜欢这种干净利落的，可以再看看尺码。", voiceEnabled: true }
  ]
});

function migrateSoftCtaClosingBlocks(scripts = []) {
  const closingIds = new Set(["s5-b5", "s6-b5"]);
  return scripts.map((script) => {
    let changed = false;
    const blocks = (Array.isArray(script?.blocks) ? script.blocks : []).map((block) => {
      const isOldSeedClosing = closingIds.has(String(block?.id || ""))
        && String(block?.type || "") === "review"
        && String(block?.category || "") === "测评对比"
        && /完整上身收尾/.test(String(block?.visualInstruction || ""))
        && /尺码/.test(String(block?.voiceText || block?.subtitleText || ""));
      if (!isOldSeedClosing) return block;
      changed = true;
      return { ...block, styleRole: "soft_cta", category: "整体展示", type: "overall" };
    });
    return changed ? { ...script, blocks } : script;
  });
}

async function ensureNaturalSeedingScript() {
  const projectState = await store.get("projectState") || {};
  const scripts = Array.isArray(projectState.scripts) ? projectState.scripts : [];
  const applyRealReviewDefaults = projectState.realReviewVoiceV1Applied !== true;
  const applyNarrativeScriptFix = projectState.editingAgentNarrativeFixV1Applied !== true;
  let migratedScripts = [...scripts];
  if (!migratedScripts.some((script) => script?.id === NATURAL_SEEDING_SCRIPT.id)) migratedScripts.push(NATURAL_SEEDING_SCRIPT);
  if (!migratedScripts.some((script) => script?.id === REAL_REVIEW_SHORT_SCRIPT.id)) migratedScripts.push(REAL_REVIEW_SHORT_SCRIPT);
  if (applyNarrativeScriptFix) migratedScripts = migrateSoftCtaClosingBlocks(migratedScripts);
  const settings = await store.get("settings") || {};
  const fidelityManifestPath = path.join(settings.materialRoot || defaultMaterialRoot(), "918", "2026-08-22_918_V3原画保真_硬字幕阻断", "manifest.json");
  await store.set("projectState", {
    ...projectState,
    scripts: migratedScripts,
    editingScriptId: applyRealReviewDefaults ? REAL_REVIEW_SHORT_SCRIPT.id : projectState.editingScriptId,
    activeManagedScriptId: applyRealReviewDefaults ? REAL_REVIEW_SHORT_SCRIPT.id : projectState.activeManagedScriptId,
    selectedAiVoice: applyRealReviewDefaults ? "真人短种草" : projectState.selectedAiVoice,
    voicePreviewApproved: applyRealReviewDefaults ? false : projectState.voicePreviewApproved,
    realReviewVoiceV1Applied: true,
    editingAgentNarrativeFixV1Applied: true,
    lastManifestPath: fs.existsSync(fidelityManifestPath) ? fidelityManifestPath : projectState.lastManifestPath
  });
  const generatedOutputs = await store.get("generatedOutputs") || [];
  const downgraded = generatedOutputs.map((output) => {
    if (!/^918_V2事实展示_0[1-3]_1080x1920\.mp4$/i.test(String(output.fileName || ""))) return output;
    return {
      ...output,
      filePath: String(output.filePath || "").replace(`${path.sep}成片${path.sep}可投放${path.sep}`, `${path.sep}成片${path.sep}已阻断${path.sep}上一版_画面放大_机械音${path.sep}`),
      status: "blocked",
      score: 0,
      publishReady: false,
      revisionReason: "画面裁切放大导致清晰度下降，且使用机械系统配音"
    };
  });
  await store.set("generatedOutputs", downgraded);
}

function defaultMaterialRoot() {
  if (process.platform === "win32" && fs.existsSync("D:\\")) return "D:\\抖音素材库";
  return path.join(app.getPath("videos"), "裁库素材库");
}

function editingTrainingRepository(materialRoot) {
  return createEditingTrainingRepository({ materialRoot });
}

function editingFeedbackRepository(materialRoot) {
  return createEditingFeedbackService({ materialRoot });
}

function requestedTaskId(value, prefix) {
  const candidate = String(value || "").trim();
  return new RegExp(`^${prefix}-[a-zA-Z0-9_-]{6,160}$`).test(candidate) ? candidate : taskId(prefix);
}

function serializeError(error) {
  return {
    name: error?.name || "Error",
    message: error?.message || String(error),
    code: typeof error?.code === "string" ? error.code : "UNKNOWN_ERROR",
    details: error?.details || error?.report || null,
    stderr: error?.stderr ? String(error.stderr).slice(-3000) : "",
    batchDir: error?.batchDir || null,
    libraryDir: error?.libraryDir || null,
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

async function trashClassificationBatch(manifestPathValue) {
  const settings = await store.get("settings") || {};
  const materialRoot = path.resolve(settings.materialRoot || defaultMaterialRoot());
  const { manifestPath } = validateManifestPath({ manifestPath: manifestPathValue, materialRoot });
  if (!fs.existsSync(manifestPath)) return { deleted: false, reason: "manifest_missing" };
  const manifest = JSON.parse(await fs.promises.readFile(manifestPath, "utf8"));
  const plan = createClassificationDeletionPlan({ manifestPath, materialRoot, manifest });
  await assertDeletionTargetsAreExclusive({ materialRoot, manifestPath, targets: plan.ownedLibraryFiles, protectedDirectory: plan.batchDir });
  let deletedFiles = 0;
  for (const targetPath of plan.ownedLibraryFiles) {
    if (!fs.existsSync(targetPath)) continue;
    const targetStat = await fs.promises.lstat(targetPath);
    if (!targetStat.isFile() && !targetStat.isSymbolicLink()) {
      throw Object.assign(new Error("分类任务记录包含非文件删除目标"), { code: "UNSAFE_DELETE_TARGET" });
    }
    await shell.trashItem(targetPath);
    deletedFiles += 1;
  }
  if (fs.existsSync(plan.batchDir)) await shell.trashItem(plan.batchDir);
  const remainingManifests = await findManifests(materialRoot);
  const fallbackManifestPath = remainingManifests[0]?.manifestPath || null;
  const state = await store.get();
  const deletedManifestKey = manifestPath.toLowerCase();
  const classificationTasks = (state.classificationTasks || []).filter((task) => String(task?.manifestPath || "").toLowerCase() !== deletedManifestKey && task?.id !== manifest.taskId);
  const recentManifests = (state.recentManifests || []).filter((item) => String(item || "").toLowerCase() !== deletedManifestKey);
  const projectState = state.projectState?.lastManifestPath && String(state.projectState.lastManifestPath).toLowerCase() === deletedManifestKey
    ? { ...state.projectState, lastManifestPath: fallbackManifestPath }
    : state.projectState;
  await store.patch({
    classificationTasks,
    recentManifests,
    lastBatchManifest: state.lastBatchManifest && String(state.lastBatchManifest).toLowerCase() === deletedManifestKey ? fallbackManifestPath : state.lastBatchManifest,
    projectState
  });
  return { deleted: true, deletedFiles, libraryDir: plan.libraryDir, batchDir: plan.batchDir, nextManifestPath: fallbackManifestPath };
}

async function assertDeletionTargetsAreExclusive({ materialRoot, manifestPath, targets, protectedDirectory = null }) {
  const currentManifestKey = path.resolve(manifestPath).toLowerCase();
  const targetKeys = new Set((targets || []).map((item) => path.resolve(item).toLowerCase()));
  const manifests = await findManifests(materialRoot);
  for (const otherManifest of manifests) {
    if (path.resolve(otherManifest.manifestPath).toLowerCase() === currentManifestKey) continue;
    for (const material of otherManifest.materials || []) {
      for (const value of [material.filePath, material.thumbnailPath]) {
        if (!value) continue;
        const referencedPath = path.resolve(value);
        if (targetKeys.has(referencedPath.toLowerCase()) || (protectedDirectory && isSameOrWithin(protectedDirectory, referencedPath))) {
          throw Object.assign(new Error("该文件仍被同款号的其他导入记录引用，已停止删除"), { code: "SHARED_MATERIAL_REFERENCE" });
        }
      }
    }
  }
}

async function trashMaterialFromManifest({ id, manifestPath: manifestPathValue }) {
  const settings = await store.get("settings") || {};
  const materialRoot = path.resolve(settings.materialRoot || defaultMaterialRoot());
  const { manifestPath } = validateManifestPath({ manifestPath: manifestPathValue, materialRoot });
  if (!fs.existsSync(manifestPath)) return { deleted: false, reason: "manifest_missing" };
  const manifest = JSON.parse(await fs.promises.readFile(manifestPath, "utf8"));
  const plan = createMaterialDeletionPlan({ manifestPath, materialRoot, manifest, materialId: id });
  await assertDeletionTargetsAreExclusive({ materialRoot, manifestPath, targets: plan.targets });
  for (const targetPath of plan.targets) {
    if (!fs.existsSync(targetPath)) continue;
    const targetStat = await fs.promises.lstat(targetPath);
    if (!targetStat.isFile() && !targetStat.isSymbolicLink()) {
      throw Object.assign(new Error("素材任务记录包含非文件删除目标"), { code: "UNSAFE_DELETE_TARGET" });
    }
  }
  for (const targetPath of plan.targets) {
    if (fs.existsSync(targetPath)) await shell.trashItem(targetPath);
  }

  manifest.materials = (manifest.materials || []).filter((material) => material.id !== id);
  manifest.updatedAt = new Date().toISOString();
  const reusableMaterials = manifest.materials.filter((material) => !material.lowReuse);
  const lowReuseMaterials = manifest.materials.filter((material) => material.lowReuse);
  if (manifest.summary) {
    manifest.summary.materialCount = reusableMaterials.length;
    manifest.summary.lowReuseCount = lowReuseMaterials.length;
    manifest.summary.minimumDuration = reusableMaterials.length ? Math.min(...reusableMaterials.map((material) => Number(material.duration || 0))) : 0;
    if (manifest.summary.categories) {
      manifest.summary.categories = Object.fromEntries(Object.keys(manifest.summary.categories).map((label) => [label, reusableMaterials.filter((material) => material.typeLabel === label).length]));
    }
  }
  const temporaryPath = `${manifestPath}.tmp`;
  await fs.promises.writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await fs.promises.rename(temporaryPath, manifestPath);
  return { deleted: true, id, manifestPath, deletedFiles: plan.targets.length };
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

function headlessBatchConfigPath(argv = process.argv) {
  const index = argv.indexOf("--headless-classify-batch");
  return index >= 0 && argv[index + 1] ? path.resolve(argv[index + 1]) : null;
}

async function runHeadlessClassification(configPath) {
  const payload = JSON.parse(await fs.promises.readFile(configPath, "utf8"));
  const currentSettings = await store.get("settings");
  const sku = sanitizeFileSegment(payload.sku, "");
  const batchName = sanitizeFileSegment(payload.batchName, "本次导入");
  const sourcePaths = (Array.isArray(payload.sourcePaths) ? payload.sourcePaths : []).map((item) => path.resolve(String(item)));
  if (!sku) throw Object.assign(new Error("无窗口批次缺少款号"), { code: "SKU_REQUIRED" });
  if (!sourcePaths.length) throw Object.assign(new Error("无窗口批次没有原视频"), { code: "SOURCE_REQUIRED" });

  const id = taskId("process");
  const task = createClassificationTask({ id, sku, batchName, sourceCount: sourcePaths.length });
  await upsertClassificationTask(task);
  try {
    const aiRouting = normalizeAiRoutingSettings(currentSettings.aiRouting || DEFAULT_AI_ROUTING_SETTINGS);
    const apiKey = aiRouting.mode === "local_private" ? "" : await getSavedQwenKey();
    const route = buildTaskRoute("classification", { settings: aiRouting, hasApiKey: Boolean(apiKey) });
    const aiSettings = normalizeAiSettings({ ...(currentSettings.aiClassification || DEFAULT_AI_SETTINGS), model: aiRouting.classificationModel });
    const productProfile = await productProfileRepository.get(sku);
    const result = await processBatch({
      ...payload,
      taskId: id,
      sku,
      batchName,
      sourcePaths,
      rootDir: currentSettings.materialRoot
    }, {
      appVersion: app.getVersion(),
      resourcesPath: app.isPackaged ? process.resourcesPath : null,
      classificationRuntime: { settings: aiSettings, apiKey, route, productProfile },
      captionRepairSettings: currentSettings.captionRepair || { enabled: true, pythonPath: "", sampleFps: 4, preferCuda: true },
      onProgress: (progress) => process.stdout.write(`${JSON.stringify({ type: "progress", ...progress })}\n`)
    });
    const recent = await store.get("recentManifests") || [];
    await store.patch({
      recentManifests: [result.manifestPath, ...recent.filter((item) => item !== result.manifestPath)].slice(0, 30),
      lastBatchManifest: result.manifestPath
    });
    await upsertClassificationTask(completeClassificationTask(task, result));
    process.stdout.write(`${JSON.stringify({ type: "result", manifestPath: result.manifestPath, batchDir: result.batchDir, libraryDir: result.libraryDir, summary: result.summary })}\n`);
    return result;
  } catch (error) {
    await upsertClassificationTask(failClassificationTask(task, error)).catch(() => {});
    throw error;
  }
}

async function sanitizeSettings(settings) {
  const secrets = await store.get("providerSecrets") || {};
  const aiRouting = normalizeAiRoutingSettings(settings?.aiRouting || DEFAULT_AI_ROUTING_SETTINGS);
  return {
    ...settings,
    aiClassification: {
      ...normalizeAiSettings({ ...(settings?.aiClassification || DEFAULT_AI_SETTINGS), model: aiRouting.classificationModel }),
      hasApiKey: Boolean(secrets.qwen),
      secureStorageAvailable: safeStorage.isEncryptionAvailable()
    },
    aiEditor: normalizeLocalEditorSettings({
      ...(settings?.aiEditor || DEFAULT_LOCAL_EDITOR_SETTINGS),
      endpoint: aiRouting.localEndpoint,
      model: aiRouting.localModel
    }),
    aiRouting
  };
}

function registerIpc() {
  safeHandle("app:get-bootstrap", async () => {
    const storedSettings = await store.get("settings");
    const settings = await sanitizeSettings(storedSettings);
    const capabilities = await inspectCapabilities();
    const batches = await findManifests(settings.materialRoot);
    const trainingCases = await editingTrainingRepository(settings.materialRoot).list();
    const taskBoard = buildTodayTaskBoard({ records: await store.get("classificationTasks") || [], batches });
    return {
      app: { name: app.getName(), version: app.getVersion(), platform: process.platform },
      update: updateController?.getState() || null,
      window: { isMaximized: Boolean(mainWindow?.isMaximized()) },
      capabilities,
      settings,
      projectState: await store.get("projectState"),
      productProfiles: await productProfileRepository.list(),
      editingTraining: {
        caseCount: trainingCases.length,
        goldCount: trainingCases.filter((record) => record.labels?.accepted === true && Number(record.labels?.rating) === 5).length,
        rootDir: editingTrainingRepository(settings.materialRoot).rootDir
      },
      taskBoard,
      batches: batches.map((batch) => ({
        sku: batch.sku,
        batchName: batch.batchName,
        status: batch.status,
        updatedAt: batch.updatedAt,
        batchDir: batch.batchDir,
        libraryDir: batch.libraryDir || batch.batchDir,
        manifestPath: batch.manifestPath,
        summary: batch.summary,
        materials: (batch.materials || []).map((material) => ({ ...material, manifestPath: batch.manifestPath, batchDir: batch.batchDir, libraryDir: batch.libraryDir || batch.batchDir }))
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

  safeHandle("dialog:select-product-images", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "选择目标商品参考图",
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: "图片文件", extensions: ["jpg", "jpeg", "png", "webp", "bmp"] },
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

  safeHandle("product-profile:list", async () => productProfileRepository.list());
  safeHandle("product-profile:get", async (_event, payload) => productProfileRepository.get(payload.sku));
  safeHandle("product-profile:save", async (_event, payload) => productProfileRepository.save(payload.profile));
  safeHandle("product-profile:delete", async (_event, payload) => ({
    deleted: await productProfileRepository.remove(payload.sku)
  }));

  safeHandle("editing-training:list", async () => {
    const settings = await store.get("settings");
    return editingTrainingRepository(settings.materialRoot).list();
  });
  safeHandle("editing-training:mark-gold", async (_event, payload) => {
    const settings = await store.get("settings");
    const repository = editingTrainingRepository(settings.materialRoot);
    const previous = await repository.get(payload.caseId);
    if (!previous) throw Object.assign(new Error("找不到要设为金标的学习案例"), { code: "EDITING_TRAINING_CASE_NOT_FOUND" });
    return repository.save({
      ...previous,
      caseId: previous.caseId,
      script: payload.script && typeof payload.script === "object" ? payload.script : previous.script,
      learningRecipe: payload.learningRecipe && typeof payload.learningRecipe === "object" ? payload.learningRecipe : previous.learningRecipe,
      labels: { ...previous.labels, accepted: true, rating: 5, reasons: [String(payload.reason || "用户确认剪辑结构可复用")] }
    });
  });
  safeHandle("editing-training:delete", async (_event, payload) => {
    const settings = await store.get("settings");
    return editingTrainingRepository(settings.materialRoot).remove(payload.caseId, payload.reason || "用户从市场脚本学习中删除");
  });
  safeHandle("editing-training:restore", async (_event, payload) => {
    const settings = await store.get("settings");
    return editingTrainingRepository(settings.materialRoot).restore(payload.caseId);
  });
  safeHandle("editing-feedback:record", async (_event, payload) => {
    const settings = await store.get("settings");
    return editingFeedbackRepository(settings.materialRoot).record(payload);
  });
  safeHandle("editing-feedback:list", async (_event, payload) => {
    const settings = await store.get("settings");
    return editingFeedbackRepository(settings.materialRoot).list(payload?.caseId || "");
  });
  safeHandle("editing-feedback:delete", async (_event, payload) => {
    const settings = await store.get("settings");
    return editingFeedbackRepository(settings.materialRoot).remove(payload.id);
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
    const batchName = sanitizeFileSegment(payload.batchName, "本次导入");
    if (!sku) throw Object.assign(new Error("请选择或新建一个款号"), { code: "SKU_REQUIRED" });
    const task = createClassificationTask({ id, sku, batchName, sourceCount: payload.sourcePaths?.length || 0 });
    await upsertClassificationTask(task);
    activeTasks.set(id, controller);
    try {
      const aiRouting = normalizeAiRoutingSettings(currentSettings.aiRouting || DEFAULT_AI_ROUTING_SETTINGS);
      const apiKey = aiRouting.mode === "local_private" ? "" : await getSavedQwenKey();
      const route = buildTaskRoute("classification", { settings: aiRouting, hasApiKey: Boolean(apiKey) });
      const aiSettings = normalizeAiSettings({ ...(currentSettings.aiClassification || DEFAULT_AI_SETTINGS), model: aiRouting.classificationModel });
      const productProfile = await productProfileRepository.get(sku);
      const result = await processBatch({
        ...payload,
        taskId: id,
        sku,
        batchName,
        rootDir: currentSettings.materialRoot
      }, {
        appVersion: app.getVersion(),
        resourcesPath: app.isPackaged ? process.resourcesPath : null,
        signal: controller.signal,
        onProgress: (progress) => sendProgress(event, id, progress),
        classificationRuntime: { settings: aiSettings, apiKey, route, productProfile },
        captionRepairSettings: currentSettings.captionRepair || { enabled: true, pythonPath: "", sampleFps: 4, preferCuda: true }
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
  safeHandle("batch:trash", async (_event, payload) => trashClassificationBatch(payload.manifestPath));

  safeHandle("compliance:check-text", async (_event, payload) => checkText(payload.text));
  safeHandle("compliance:check-script", async (_event, payload) => checkScript(payload.script));

  safeHandle("competitor:analyze", async (event, payload) => {
    const id = requestedTaskId(payload?.clientTaskId, "market-script");
    const controller = new AbortController();
    activeTasks.set(id, controller);
    try {
      const currentSettings = await store.get("settings");
      const aiRouting = normalizeAiRoutingSettings(currentSettings.aiRouting || DEFAULT_AI_ROUTING_SETTINGS);
      const apiKey = aiRouting.mode === "local_private" ? "" : await getSavedQwenKey();
      const route = buildTaskRoute("competitor", { settings: aiRouting, hasApiKey: Boolean(apiKey) });
      const settings = normalizeAiSettings({ ...(currentSettings.aiClassification || DEFAULT_AI_SETTINGS), model: route.primary.model });
      const result = await analyzeCompetitorVideo(payload.filePath, {
        settings,
        apiKey,
        route,
        tempRoot: app.getPath("temp"),
        signal: controller.signal,
        onProgress: (progress) => sendProgress(event, id, progress)
      });
      const trainingCase = await editingTrainingRepository(currentSettings.materialRoot).save({
        caseId: payload.caseId,
        sku: String(payload.sku || ""),
        category: String(payload.category || "服装带货"),
        caseType: "reference_only",
        finalVideo: {
          path: payload.filePath,
          creativeId: String(payload.referenceId || ""),
          sourceType: "user_uploaded_reference"
        },
        script: {
          name: result.learningRecipe?.title || result.title || path.basename(payload.filePath),
          voiceMode: result.learningRecipe?.voiceMode || result.voiceMode || "partial_voice",
          blocks: result.learningRecipe?.blocks || result.blocks || [],
          editingRecipe: result.learningRecipe || {}
        },
        learningRecipe: result.learningRecipe || {},
        labels: { accepted: null, rating: null, reasons: [] },
        rights: { userOwnedOrAuthorized: true },
        analysisVersion: "editing-case-2026.08.1"
      });
      return { taskId: id, ...result, trainingCase };
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
      const aiRouting = normalizeAiRoutingSettings(currentSettings.aiRouting || DEFAULT_AI_ROUTING_SETTINGS);
      const apiKey = aiRouting.mode === "local_private" ? "" : await getSavedQwenKey();
      const route = buildTaskRoute("editor", { settings: aiRouting, hasApiKey: Boolean(apiKey) });
      const settings = normalizeLocalEditorSettings({
        ...(currentSettings.aiEditor || DEFAULT_LOCAL_EDITOR_SETTINGS),
        endpoint: aiRouting.localEndpoint,
        model: aiRouting.localModel
      });
      sendProgress(event, id, { stage: "editor_prepare", progress: 0.08, message: "正在读取人工确认的分类清单与用户投喂案例…" });
      const { performanceFeedback: _ignoredPerformanceFeedback, ...editorPayload } = payload || {};
      const catalogRequest = editorPayload.catalogRequest || {};
      const selectedIds = new Set((editorPayload.selectedMaterialIds || editorPayload.materials?.map((item) => item.id) || []).map(String));
      const manifestPaths = [...new Set((Array.isArray(catalogRequest.manifestPaths) ? catalogRequest.manifestPaths : []).filter(Boolean).map((item) => path.resolve(String(item))))];
      const catalog = manifestPaths.length
        ? await readClassifiedMaterialCatalog({ sku: catalogRequest.sku, manifestPaths, humanConfirmed: true })
        : createClassifiedMaterialCatalog({
          sku: catalogRequest.sku || editorPayload.materials?.[0]?.sku,
          humanConfirmed: true,
          manifests: [{
            sku: catalogRequest.sku || editorPayload.materials?.[0]?.sku,
            batchName: "当前人工选择",
            materials: editorPayload.materials || []
          }]
        });
      const planningMaterials = selectedIds.size
        ? catalog.materials.filter((material) => selectedIds.has(String(material.id)))
        : catalog.materials;
      if (!planningMaterials.length) {
        throw Object.assign(new Error("本次勾选素材不在当前人工确认的分类清单中"), { code: "EDITING_SELECTION_OUTSIDE_CONFIRMED_CATALOG" });
      }
      const cases = await editingTrainingRepository(currentSettings.materialRoot).list();
      const retrieval = retrieveEditingCases({
        cases,
        sku: catalog.sku,
        category: String(editorPayload.category || "服装带货"),
        script: editorPayload.script,
        limit: 5
      });
      const plan = await createEditingPlan({
        ...editorPayload,
        materials: planningMaterials,
        retrievedCases: retrieval.matches,
        qualityMode: true
      }, {
        settings,
        route,
        apiKey,
        region: currentSettings.aiClassification?.region,
        signal: controller.signal
      });
      sendProgress(event, id, { stage: "editor_done", progress: 1, message: "AI 剪辑师已完成逐段安排，请检查证据缺口" });
      return {
        taskId: id,
        ...plan,
        catalogSummary: {
          sku: catalog.sku,
          materialCount: catalog.materialCount,
          selectedMaterialCount: planningMaterials.length,
          categoryCounts: catalog.categoryCounts,
          categories: Object.fromEntries(Object.entries(catalog.categories).map(([categoryName, materials]) => [categoryName, materials.map((material) => ({ id: material.id, name: material.name || material.title || material.id }))])),
          policy: catalog.policy,
          audit: catalog.audit
        },
        retrieval
      };
    } finally {
      activeTasks.delete(id);
    }
  });

  safeHandle("voice:preview", async (_event, payload) => {
    const apiKey = await getSavedQwenKey();
    const previewDir = path.join(app.getPath("userData"), "voice-previews");
    const duration = Math.max(0, Number(payload?.duration || 0));
    const presetName = String(payload?.presetName || "真人短种草");
    const previewPath = path.join(previewDir, `${sanitizeFileSegment(presetName)}.wav`);
    const synthesis = await synthesizeQwenVoice(
      String(payload?.text || "买西裤最怕什么？太窄挑腿，太宽又容易没精神。这条我先不急着夸，直接看上身。"),
      previewPath,
      { apiKey, presetName, duration }
    );
    return { ...synthesis, fileUrl: pathToFileURL(previewPath).href };
  });

  safeHandle("mix:start", async (event, payload) => {
    const id = taskId("mix");
    const controller = new AbortController();
    activeTasks.set(id, controller);
    try {
      const currentSettings = await store.get("settings");
      const aiRouting = normalizeAiRoutingSettings(currentSettings.aiRouting || DEFAULT_AI_ROUTING_SETTINGS);
      const apiKey = aiRouting.mode === "local_private" ? "" : await getSavedQwenKey();
      const qualityRoute = buildTaskRoute("quality", { settings: aiRouting, hasApiKey: Boolean(apiKey) });
      const aiSettings = normalizeAiSettings({ ...(currentSettings.aiClassification || DEFAULT_AI_SETTINGS), model: qualityRoute.primary.model });
      const result = await mixBatch(payload, {
        qwenApiKey: apiKey,
        signal: controller.signal,
        onProgress: (progress) => sendProgress(event, id, { ...progress, progress: Number(progress.progress || 0) * 0.72 })
      });
      let repeatedAuditError = null;
      for (let index = 0; index < result.outputs.length; index += 1) {
        const output = result.outputs[index];
        sendProgress(event, id, {
          stage: "ai_quality",
          progress: 0.72 + (index / result.outputs.length) * 0.28,
          message: `${qualityRoute.primary.provider === "qwen" ? "千问云端" : "本地 Qwen"}正在逐条核对画面、脚本和可见风险词 ${index + 1}/${result.outputs.length}`
        });
        let audit;
        try {
          if (repeatedAuditError) throw repeatedAuditError;
          audit = await auditGeneratedOutput(output, {
            tempRoot: app.getPath("temp"),
            settings: aiSettings,
            apiKey,
            route: qualityRoute,
            signal: controller.signal,
            script: payload.script,
            materialSummary: (payload.materials || []).map((material) => ({
              name: material.name,
              type: material.type,
              typeLabel: material.typeLabel,
              productIdentity: material.productIdentity,
              shot: material.shot,
              actions: material.actions,
              visibleTexts: material.captionVerification?.after || [],
              evidence: material.evidence
            }))
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
            provider: qualityRoute.primary.provider,
            model: qualityRoute.primary.model,
            mode: `${qualityRoute.primary.provider}_visual_quality_audit_failed`,
            frameCount: 0
          };
        }
        const captionFinal = verifyFinalCaptions({
          expectedTexts: (payload.script?.blocks || []).map((block) => block.subtitleText ?? block.text ?? "").filter((text) => String(text).trim()),
          observedTexts: audit.visibleTexts,
          sourceTexts: (payload.materials || []).flatMap((material) => material.visibleTexts || []),
          observationAvailable: Number(audit.frameCount || 0) > 0
        });
        let audio;
        try {
          audio = await analyzeAudioQuality(output.filePath, output.duration, { signal: controller.signal });
          if (output.fingerprint) output.fingerprint.audioHash = audio.audioHash;
        } catch (error) {
          audio = { status: "blocked", score: 0, reasons: [`音频质量检测未完成：${error.message}`], source: "ffmpeg_ebur128_failed" };
        }
        const materialMap = new Map((payload.materials || []).map((material) => [String(material.id), material]));
        const outputMaterials = (output.materialIds || []).map((materialId) => materialMap.get(String(materialId))).filter(Boolean);
        const matchedCount = outputMaterials.filter((material) => material.productIdentity?.status === "matched").length;
        const mismatched = outputMaterials.filter((material) => material.productIdentity?.status === "mismatch");
        const productIdentity = mismatched.length
          ? { status: "mismatch", score: 0, coverage: outputMaterials.length ? matchedCount / outputMaterials.length : 0, reasons: [`成片使用了 ${mismatched.length} 个非目标商品镜头`] }
          : outputMaterials.length && matchedCount === outputMaterials.length
            ? { status: "match", score: 100, coverage: 1, reasons: [] }
            : { status: "review", score: 0, coverage: outputMaterials.length ? matchedCount / outputMaterials.length : 0, reasons: ["部分镜头的目标商品身份尚未确认"] };
        const fingerprint = output.fingerprint || {};
        const materialIds = fingerprint.materialIds || [];
        const cutDurations = fingerprint.cutDurations || [];
        const pacingPassed = materialIds.length > 0
          && new Set(materialIds).size === materialIds.length
          && cutDurations.every((duration) => Number(duration) >= 2 && Number(duration) <= 4);
        const hookMaterial = materialMap.get(String(fingerprint.hookMaterialId || ""));
        const hookPassed = Boolean(hookMaterial?.eligibleForMix === true && output.report.creativeStrategy?.hookStyle);
        output.report.visualSemantic = audit;
        output.report.captionVerification = {
          sourceMaterials: (payload.materials || []).map((material) => ({
            materialId: material.id,
            status: material.captionVerification?.status || "review",
            residualCount: material.captionVerification?.residualCount ?? null
          })),
          final: captionFinal
        };
        output.report.aiModel = { provider: audit.provider, model: audit.model, routeMode: qualityRoute.mode, checkedAt: new Date().toISOString() };
        output.report.productIdentity = productIdentity;
        output.report.hook = { status: hookPassed ? "pass" : "review", score: hookPassed ? 100 : 0, reasons: hookPassed ? [] : ["前 3 秒缺少已验证的目标商品钩子镜头"] };
        output.report.pacing = { status: pacingPassed ? "pass" : "blocked", score: pacingPassed ? 100 : 0, reasons: pacingPassed ? [] : ["时间线存在重复素材或单镜不在 2–4 秒范围"] };
        output.report.audio = audio;
        output.report.status = output.report.variantSimilarity?.status === "blocked" || captionFinal.status === "blocked" || audit.status === "blocked" || output.report.technical.status !== "pass" || output.report.script.status === "blocked"
          ? "blocked"
          : audit.status === "review" || output.report.materialCoverage.status !== "pass" || output.report.script.status !== "pass" ? "review" : "pass";
        const finalReport = finalizeQualityReport(output.report);
        const repairPlan = createRepairPlan(finalReport, Number(payload.repairAttempt || 0));
        result.outputs[index] = await finalizeCandidateOutput(output, { ...finalReport, repairPlan, repairActions: repairPlan.actions }, payload.batchDir);
      }
      const existingOutputs = await store.get("generatedOutputs") || [];
      const historyRecords = result.outputs.map((output) => ({
        creativeId: output.creativeId,
        outputName: output.name,
        fileName: path.basename(output.filePath),
        sku: String(payload.sku || ""),
        projectName: String(payload.projectName || payload.script?.name || ""),
        scriptId: String(payload.script?.id || ""),
        duration: Number(output.duration || 0),
        creativeStrategy: output.report?.creativeStrategy || null,
        status: output.status,
        score: output.score,
        generatedAt: output.report?.generatedAt || new Date().toISOString()
      }));
      await store.set("generatedOutputs", [...historyRecords, ...existingOutputs.filter((item) => !historyRecords.some((current) => current.creativeId === item.creativeId))].slice(0, 1000));
      sendProgress(event, id, { stage: "done", progress: 1, message: `${result.outputs.length} 条成片均已完成 AI 视觉质检` });
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

  safeHandle("material:trash", async (_event, payload) => trashMaterialFromManifest(payload));

  safeHandle("state:save-settings", async (_event, payload) => {
    const current = await store.get("settings");
    const next = {
      ...current,
      materialRoot: path.resolve(payload.materialRoot || current.materialRoot),
      keepOriginals: payload.keepOriginals !== false,
      captionMode: ["smart_mask", "keep"].includes(payload.captionMode) ? payload.captionMode : "smart_mask",
      minimumClipSeconds: 2,
      outputSpec: current.outputSpec
    };
    await store.set("settings", next);
    return sanitizeSettings(next);
  });

  safeHandle("ai:save-settings", async (_event, payload) => {
    const current = await store.get("settings");
    if (String(payload.apiKey || "").trim()) await saveQwenKey(payload.apiKey);
    const incoming = payload.settings || {};
    const aiRouting = normalizeAiRoutingSettings(incoming.aiRouting || current.aiRouting || DEFAULT_AI_ROUTING_SETTINGS);
    const classificationInput = incoming.aiClassification || incoming;
    const next = {
      ...current,
      aiClassification: normalizeAiSettings({
        ...(classificationInput || current.aiClassification || DEFAULT_AI_SETTINGS),
        model: aiRouting.classificationModel
      }),
      aiEditor: normalizeLocalEditorSettings({
        ...(current.aiEditor || DEFAULT_LOCAL_EDITOR_SETTINGS),
        endpoint: aiRouting.localEndpoint,
        model: aiRouting.localModel
      }),
      aiRouting
    };
    await store.set("settings", next);
    return sanitizeSettings(next);
  });

  safeHandle("ai:test-connection", async (_event, payload) => {
    const current = await store.get("settings");
    const incoming = payload.settings || {};
    const aiRouting = normalizeAiRoutingSettings(incoming.aiRouting || current.aiRouting || DEFAULT_AI_ROUTING_SETTINGS);
    const classificationInput = incoming.aiClassification || incoming;
    const settings = normalizeAiSettings({ ...(classificationInput || current.aiClassification || DEFAULT_AI_SETTINGS), model: aiRouting.classificationModel });
    if (aiRouting.mode === "local_private") {
      return testOllamaConnection({ settings: { endpoint: aiRouting.localEndpoint, model: aiRouting.localModel } });
    }
    const apiKey = String(payload.apiKey || "").trim() || await getSavedQwenKey();
    if (!apiKey && aiRouting.mode === "smart") {
      return testOllamaConnection({ settings: { endpoint: aiRouting.localEndpoint, model: aiRouting.localModel } });
    }
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
      captionRepair: { enabled: true, pythonPath: "", sampleFps: 4, preferCuda: true },
      minimumClipSeconds: 2,
      outputSpec: { width: 1080, height: 1920, aspectRatio: "9:16", fps: 30, videoCodec: "H.264", audioCodec: "AAC", sampleRate: 48000 },
      aiClassification: DEFAULT_AI_SETTINGS,
      aiEditor: DEFAULT_LOCAL_EDITOR_SETTINGS,
      aiRouting: DEFAULT_AI_ROUTING_SETTINGS
    },
    projectState: {},
    productProfiles: [],
    qianchuanFeedback: [],
    generatedOutputs: [],
    recentManifests: [],
    classificationTasks: [],
    providerSecrets: {}
  });
  await store.ready;
  await ensureNaturalSeedingScript();
  productProfileRepository = createProductProfileRepository(store);
  const storedSettings = await store.get("settings");
  if (!storedSettings.aiClassification) {
    await store.set("settings", { ...storedSettings, aiClassification: DEFAULT_AI_SETTINGS });
  }
  const migratedSettings = await store.get("settings");
  if (!migratedSettings.aiEditor) {
    await store.set("settings", { ...migratedSettings, aiEditor: DEFAULT_LOCAL_EDITOR_SETTINGS });
  }
  const routingSettings = await store.get("settings");
  if (!routingSettings.aiRouting) {
    await store.set("settings", { ...routingSettings, aiRouting: DEFAULT_AI_ROUTING_SETTINGS });
  }
  const recoveredTasks = recoverInterruptedTasks(await store.get("classificationTasks") || []);
  await store.set("classificationTasks", recoveredTasks);
  const headlessConfig = headlessBatchConfigPath();
  if (headlessConfig) {
    try {
      await runHeadlessClassification(headlessConfig);
      app.exit(0);
    } catch (error) {
      console.error(JSON.stringify({ type: "error", code: error.code || "PROCESS_FAILED", message: error.message }));
      app.exit(1);
    }
    return;
  }
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
