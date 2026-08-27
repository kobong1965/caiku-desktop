const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const TRAINING_SCHEMA_VERSION = 1;
const CASE_TYPES = new Set(["paired_edit", "reference_only", "negative_example"]);
const USER_REFERENCE_SOURCE = "user_uploaded_reference";

function repositoryError(message, code, details = null) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  return error;
}

function plainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  try { return JSON.parse(JSON.stringify(value)); } catch { return {}; }
}

function text(value, limit = 500) {
  return String(value ?? "").trim().slice(0, limit);
}

function absolutePath(value) {
  const filePath = text(value, 4096);
  return filePath ? path.resolve(filePath) : "";
}

function normalizeTrainingCase(value = {}) {
  const caseType = CASE_TYPES.has(value.caseType) ? value.caseType : "reference_only";
  const sourceMaterials = (Array.isArray(value.sourceMaterials) ? value.sourceMaterials : [])
    .map((item) => ({
      materialId: text(item?.materialId || item?.id, 160),
      path: absolutePath(item?.path),
      classification: text(item?.classification || item?.typeLabel || item?.type, 80)
    }))
    .filter((item) => item.path);
  const finalVideoPath = absolutePath(value.finalVideo?.path);
  const sourceType = finalVideoPath
    ? text(value.finalVideo?.sourceType || USER_REFERENCE_SOURCE, 80)
    : "";
  if (sourceType && sourceType !== USER_REFERENCE_SOURCE) {
    throw repositoryError(
      "市场脚本案例只能来自用户主动投喂的视频",
      "EDITING_TRAINING_SOURCE_NOT_USER_PROVIDED"
    );
  }
  if (!sourceMaterials.length && !finalVideoPath) {
    throw repositoryError("训练案例至少需要原素材或用户投喂的参考成品", "EDITING_TRAINING_CONTENT_REQUIRED");
  }

  const labels = plainObject(value.labels);
  const rating = Number(labels.rating);
  labels.rating = Number.isFinite(rating) ? Math.max(1, Math.min(5, Math.round(rating))) : null;
  labels.accepted = labels.accepted === true ? true : labels.accepted === false ? false : null;
  labels.reasons = (Array.isArray(labels.reasons) ? labels.reasons : []).map((item) => text(item, 300)).filter(Boolean).slice(0, 20);

  return {
    sku: text(value.sku, 80),
    category: text(value.category, 100),
    caseType,
    sourceMaterials,
    finalVideo: finalVideoPath ? {
      path: finalVideoPath,
      creativeId: text(value.finalVideo?.creativeId, 160),
      sourceType: USER_REFERENCE_SOURCE
    } : null,
    script: plainObject(value.script),
    learningRecipe: plainObject(value.learningRecipe),
    voice: plainObject(value.voice),
    music: plainObject(value.music),
    goldTimeline: Array.isArray(value.goldTimeline) ? plainObject({ items: value.goldTimeline }).items || [] : [],
    labels,
    rights: { userOwnedOrAuthorized: value.rights?.userOwnedOrAuthorized === true },
    analysisVersion: text(value.analysisVersion || "editing-case-2026.08.1", 100)
  };
}

function contentHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function parseJsonLines(content, filePath) {
  return String(content || "").split(/\r?\n/).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); } catch {
      throw repositoryError(`训练案例库第 ${index + 1} 行损坏`, "EDITING_TRAINING_REPOSITORY_CORRUPT", { filePath, line: index + 1 });
    }
  });
}

function createEditingTrainingRepository(options = {}) {
  if (!options.materialRoot) throw repositoryError("缺少素材盘路径", "EDITING_TRAINING_ROOT_REQUIRED");
  const rootDir = path.join(path.resolve(options.materialRoot), "_裁库智能体", "训练库");
  const casesPath = path.join(rootDir, "cases.jsonl");
  const trashPath = path.join(rootDir, "trash", "cases.jsonl");
  const now = typeof options.now === "function" ? options.now : () => new Date().toISOString();
  const idFactory = typeof options.idFactory === "function"
    ? options.idFactory
    : () => `case-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  let operationQueue = Promise.resolve();

  async function initialize() {
    await Promise.all([
      fs.mkdir(rootDir, { recursive: true }),
      fs.mkdir(path.join(rootDir, "analysis"), { recursive: true }),
      fs.mkdir(path.join(rootDir, "thumbnails"), { recursive: true }),
      fs.mkdir(path.join(rootDir, "features"), { recursive: true }),
      fs.mkdir(path.join(rootDir, "trash"), { recursive: true })
    ]);
  }

  async function readRecords() {
    await initialize();
    try {
      return parseJsonLines(await fs.readFile(casesPath, "utf8"), casesPath);
    } catch (error) {
      if (error?.code === "ENOENT") return [];
      throw error;
    }
  }

  function latestByCase(records) {
    const latest = new Map();
    for (const record of records) {
      const previous = latest.get(record.caseId);
      if (!previous || Number(record.version) > Number(previous.version)) latest.set(record.caseId, record);
    }
    return latest;
  }

  async function appendRecord(record, alsoTrash = false) {
    await initialize();
    const line = `${JSON.stringify(record)}\n`;
    await fs.appendFile(casesPath, line, "utf8");
    if (alsoTrash) await fs.appendFile(trashPath, line, "utf8");
  }

  function exclusive(run) {
    const next = operationQueue.then(run, run);
    operationQueue = next.catch(() => {});
    return next;
  }

  async function current(caseId) {
    return latestByCase(await readRecords()).get(String(caseId || "")) || null;
  }

  async function save(value = {}) {
    return exclusive(async () => {
      const normalized = normalizeTrainingCase(value);
      const records = await readRecords();
      const requestedId = text(value.caseId, 160);
      const caseId = requestedId || text(idFactory(), 160);
      if (!caseId) throw repositoryError("无法生成案例编号", "EDITING_TRAINING_CASE_ID_REQUIRED");
      const previous = latestByCase(records).get(caseId) || null;
      const timestamp = now();
      const record = {
        schemaVersion: TRAINING_SCHEMA_VERSION,
        caseId,
        version: previous ? Number(previous.version) + 1 : 1,
        status: "active",
        ...normalized,
        contentHash: contentHash(normalized),
        createdAt: previous?.createdAt || timestamp,
        updatedAt: timestamp
      };
      await appendRecord(record);
      return record;
    });
  }

  async function list(listOptions = {}) {
    const records = [...latestByCase(await readRecords()).values()]
      .filter((record) => listOptions.includeDeleted === true || record.status !== "deleted")
      .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
    return records;
  }

  async function get(caseId, getOptions = {}) {
    const record = await current(caseId);
    if (!record || (record.status === "deleted" && getOptions.includeDeleted !== true)) return null;
    return record;
  }

  async function history(caseId) {
    return (await readRecords())
      .filter((record) => record.caseId === String(caseId || ""))
      .sort((left, right) => Number(left.version) - Number(right.version));
  }

  async function remove(caseId, reason = "用户删除") {
    return exclusive(async () => {
      const previous = await current(caseId);
      if (!previous) throw repositoryError("找不到要删除的训练案例", "EDITING_TRAINING_CASE_NOT_FOUND");
      if (previous.status === "deleted") return previous;
      const timestamp = now();
      const record = {
        ...previous,
        version: Number(previous.version) + 1,
        status: "deleted",
        deleteReason: text(reason, 500),
        deletedAt: timestamp,
        updatedAt: timestamp
      };
      await appendRecord(record, true);
      return record;
    });
  }

  async function restore(caseId) {
    return exclusive(async () => {
      const previous = await current(caseId);
      if (!previous) throw repositoryError("找不到要恢复的训练案例", "EDITING_TRAINING_CASE_NOT_FOUND");
      if (previous.status !== "deleted") return previous;
      const timestamp = now();
      const record = {
        ...previous,
        version: Number(previous.version) + 1,
        status: "active",
        deleteReason: "",
        restoredAt: timestamp,
        updatedAt: timestamp
      };
      delete record.deletedAt;
      await appendRecord(record);
      return record;
    });
  }

  return Object.freeze({ rootDir, casesPath, trashPath, initialize, save, list, get, history, remove, restore });
}

module.exports = {
  CASE_TYPES,
  TRAINING_SCHEMA_VERSION,
  USER_REFERENCE_SOURCE,
  createEditingTrainingRepository,
  normalizeTrainingCase
};
