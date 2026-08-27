const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const ACTIONS = new Set(["accept", "reject", "change_material", "change_cut", "change_text"]);
const FORBIDDEN_KEYS = /^(performancefeedback|performance|qianchuan|roi|ctr|cvr|cpa|impressions|spend|orders|revenue|gmv)$/i;

function feedbackError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function stripQianchuanData(value) {
  if (Array.isArray(value)) return value.map(stripQianchuanData);
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.test(key)) continue;
    result[key] = stripQianchuanData(item);
  }
  return result;
}

function text(value, limit = 500) {
  return String(value ?? "").trim().slice(0, limit);
}

function parseLines(content, filePath) {
  return String(content || "").split(/\r?\n/).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); } catch {
      throw feedbackError(`剪辑反馈库第 ${index + 1} 行损坏：${filePath}`, "EDITING_FEEDBACK_REPOSITORY_CORRUPT");
    }
  });
}

function createEditingFeedbackService(options = {}) {
  if (!options.materialRoot) throw feedbackError("缺少素材盘路径", "EDITING_FEEDBACK_ROOT_REQUIRED");
  const rootDir = path.join(path.resolve(options.materialRoot), "_裁库智能体", "训练库");
  const feedbackPath = path.join(rootDir, "feedback.jsonl");
  const now = typeof options.now === "function" ? options.now : () => new Date().toISOString();
  const idFactory = typeof options.idFactory === "function"
    ? options.idFactory
    : () => `feedback-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  let queue = Promise.resolve();

  async function readAll() {
    await fs.mkdir(rootDir, { recursive: true });
    try { return parseLines(await fs.readFile(feedbackPath, "utf8"), feedbackPath); }
    catch (error) { if (error?.code === "ENOENT") return []; throw error; }
  }

  async function append(record) {
    await fs.mkdir(rootDir, { recursive: true });
    await fs.appendFile(feedbackPath, `${JSON.stringify(record)}\n`, "utf8");
  }

  function exclusive(run) {
    const next = queue.then(run, run);
    queue = next.catch(() => {});
    return next;
  }

  function latestById(records) {
    const map = new Map();
    for (const record of records) map.set(record.id, record);
    return map;
  }

  async function record(input = {}) {
    return exclusive(async () => {
      const clean = stripQianchuanData(input);
      const caseId = text(clean.caseId, 160);
      if (!caseId) throw feedbackError("反馈缺少训练案例编号", "EDITING_FEEDBACK_CASE_REQUIRED");
      if (!ACTIONS.has(clean.action)) throw feedbackError("反馈动作无效", "EDITING_FEEDBACK_ACTION_INVALID");
      const records = await readAll();
      const version = records.filter((item) => item.caseId === caseId && item.status === "active").length + 1;
      const rating = Number(clean.rating);
      const saved = {
        schemaVersion: 1,
        id: text(idFactory(), 160),
        caseId,
        planId: text(clean.planId, 160),
        version,
        status: "active",
        action: clean.action,
        rating: Number.isFinite(rating) ? Math.max(1, Math.min(5, Math.round(rating))) : null,
        reason: text(clean.reason, 1000),
        before: stripQianchuanData(clean.before && typeof clean.before === "object" ? clean.before : {}),
        after: stripQianchuanData(clean.after && typeof clean.after === "object" ? clean.after : {}),
        createdAt: now()
      };
      await append(saved);
      return saved;
    });
  }

  async function list(caseId = "") {
    const records = await readAll();
    return [...latestById(records).values()]
      .filter((item) => item.status === "active" && (!caseId || item.caseId === String(caseId)))
      .sort((left, right) => (left.caseId === right.caseId ? Number(left.version) - Number(right.version) : String(left.createdAt).localeCompare(String(right.createdAt))));
  }

  async function history(id) {
    return (await readAll()).filter((item) => item.id === String(id));
  }

  async function remove(id) {
    return exclusive(async () => {
      const records = await readAll();
      const previous = latestById(records).get(String(id));
      if (!previous) throw feedbackError("找不到要删除的反馈", "EDITING_FEEDBACK_NOT_FOUND");
      if (previous.status === "deleted") return previous;
      const deleted = { ...previous, status: "deleted", deletedAt: now() };
      await append(deleted);
      return deleted;
    });
  }

  return Object.freeze({ rootDir, feedbackPath, record, list, history, remove });
}

module.exports = {
  ACTIONS,
  createEditingFeedbackService,
  stripQianchuanData
};
