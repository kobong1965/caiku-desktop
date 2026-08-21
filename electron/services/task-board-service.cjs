const path = require("node:path");

const TASK_STATUSES = new Set(["processing", "completed", "failed", "interrupted"]);

function localDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function positiveCount(value) {
  const count = Number(value || 0);
  return Number.isFinite(count) ? Math.max(0, Math.round(count)) : 0;
}

function normalizeCategories(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([label, count]) => [String(label), positiveCount(count)]));
}

function normalizeTaskRecord(record = {}, index = 0) {
  const createdAt = record.createdAt || record.startedAt || record.updatedAt || new Date(0).toISOString();
  const status = TASK_STATUSES.has(record.status) ? record.status : "interrupted";
  return {
    id: String(record.id || record.taskId || `classification-task-${index}`),
    kind: "classification",
    status,
    sku: String(record.sku || "未分款"),
    batchName: String(record.batchName || "未命名批次"),
    createdAt,
    updatedAt: record.updatedAt || record.completedAt || createdAt,
    completedAt: record.completedAt || null,
    sourceCount: positiveCount(record.sourceCount),
    materialCount: positiveCount(record.materialCount),
    reviewCount: positiveCount(record.reviewCount),
    unusableCount: positiveCount(record.unusableCount),
    progress: Math.max(0, Math.min(1, Number(record.progress || 0))),
    message: String(record.message || ""),
    errorMessage: String(record.errorMessage || ""),
    manifestPath: record.manifestPath ? path.resolve(record.manifestPath) : null,
    batchDir: record.batchDir ? path.resolve(record.batchDir) : null,
    categories: normalizeCategories(record.categories),
    origin: record.origin === "manifest" ? "manifest" : "task-record"
  };
}

function statusFromManifest(status) {
  if (status === "ready_for_review" || status === "completed") return "completed";
  if (status === "failed") return "failed";
  if (status === "processing") return "processing";
  return "interrupted";
}

function taskFromManifest(batch = {}, index = 0) {
  const summary = batch.summary || {};
  return normalizeTaskRecord({
    id: batch.taskId || `manifest-task-${index}-${batch.sku || "unknown"}`,
    status: statusFromManifest(batch.status),
    sku: batch.sku,
    batchName: batch.batchName,
    createdAt: batch.createdAt || batch.updatedAt,
    updatedAt: batch.updatedAt || batch.createdAt,
    completedAt: batch.status === "ready_for_review" ? batch.updatedAt || batch.createdAt : null,
    sourceCount: summary.sourceCount ?? batch.sources?.length,
    materialCount: summary.materialCount ?? batch.materials?.length,
    reviewCount: summary.lowConfidenceCount,
    unusableCount: summary.unusableCount,
    manifestPath: batch.manifestPath,
    batchDir: batch.batchDir,
    categories: summary.categories,
    errorMessage: batch.error?.message,
    origin: "manifest"
  }, index);
}

function mergeTaskSources(records = [], batches = []) {
  const tasks = records.map(normalizeTaskRecord);
  const manifestIndex = new Map(tasks.filter((task) => task.manifestPath).map((task) => [task.manifestPath.toLowerCase(), task]));

  batches.forEach((batch, index) => {
    const manifestTask = taskFromManifest(batch, index);
    const key = manifestTask.manifestPath?.toLowerCase();
    const existing = key ? manifestIndex.get(key) : null;
    if (!existing) {
      tasks.push(manifestTask);
      if (key) manifestIndex.set(key, manifestTask);
      return;
    }
    existing.sourceCount = manifestTask.sourceCount;
    existing.materialCount = manifestTask.materialCount;
    existing.reviewCount = manifestTask.reviewCount;
    existing.unusableCount = manifestTask.unusableCount;
    existing.categories = manifestTask.categories;
    existing.batchDir ||= manifestTask.batchDir;
    if (manifestTask.status === "completed") {
      existing.status = "completed";
      existing.completedAt ||= manifestTask.completedAt;
      existing.progress = 1;
    }
  });

  return tasks.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

function createClassificationTask({ id, sku, batchName, sourceCount }, now = new Date()) {
  const timestamp = now.toISOString();
  return normalizeTaskRecord({
    id,
    status: "processing",
    sku,
    batchName,
    sourceCount,
    createdAt: timestamp,
    updatedAt: timestamp,
    progress: 0,
    message: "等待读取原视频"
  });
}

function completeClassificationTask(task, manifest, now = new Date()) {
  const timestamp = now.toISOString();
  const summary = manifest.summary || {};
  return normalizeTaskRecord({
    ...task,
    status: "completed",
    updatedAt: timestamp,
    completedAt: timestamp,
    progress: 1,
    message: `完成 ${positiveCount(summary.materialCount ?? manifest.materials?.length)} 个素材分类`,
    sourceCount: summary.sourceCount ?? manifest.sources?.length ?? task.sourceCount,
    materialCount: summary.materialCount ?? manifest.materials?.length,
    reviewCount: summary.lowConfidenceCount,
    unusableCount: summary.unusableCount,
    categories: summary.categories,
    manifestPath: manifest.manifestPath,
    batchDir: manifest.batchDir
  });
}

function failClassificationTask(task, error, now = new Date()) {
  const timestamp = now.toISOString();
  return normalizeTaskRecord({
    ...task,
    status: "failed",
    updatedAt: timestamp,
    completedAt: timestamp,
    message: "素材分类未完成",
    errorMessage: error?.message || String(error),
    manifestPath: error?.manifestPath || task.manifestPath,
    batchDir: error?.batchDir || task.batchDir
  });
}

function recoverInterruptedTasks(records = [], now = new Date()) {
  const timestamp = now.toISOString();
  return records.map((record, index) => {
    const task = normalizeTaskRecord(record, index);
    if (task.status !== "processing") return task;
    return normalizeTaskRecord({
      ...task,
      status: "interrupted",
      updatedAt: timestamp,
      completedAt: timestamp,
      message: "软件上次关闭时任务仍在处理中",
      errorMessage: "任务已中断，可重新上传这批视频"
    }, index);
  });
}

function buildTodayTaskBoard({ records = [], batches = [], now = new Date() } = {}) {
  const date = localDateKey(now);
  const tasks = mergeTaskSources(records, batches).filter((task) => localDateKey(task.completedAt || task.createdAt) === date);
  const categories = {};
  for (const task of tasks) {
    for (const [label, count] of Object.entries(task.categories)) categories[label] = (categories[label] || 0) + count;
  }
  return {
    date,
    tasks,
    batchCount: tasks.length,
    completedCount: tasks.filter((task) => task.status === "completed").length,
    processingCount: tasks.filter((task) => task.status === "processing").length,
    failedCount: tasks.filter((task) => task.status === "failed" || task.status === "interrupted").length,
    sourceCount: tasks.reduce((sum, task) => sum + task.sourceCount, 0),
    materialCount: tasks.reduce((sum, task) => sum + task.materialCount, 0),
    reviewCount: tasks.reduce((sum, task) => sum + task.reviewCount, 0),
    unusableCount: tasks.reduce((sum, task) => sum + task.unusableCount, 0),
    categories
  };
}

module.exports = {
  buildTodayTaskBoard,
  completeClassificationTask,
  createClassificationTask,
  failClassificationTask,
  localDateKey,
  mergeTaskSources,
  normalizeTaskRecord,
  recoverInterruptedTasks,
  taskFromManifest
};
