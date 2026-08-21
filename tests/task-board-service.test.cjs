const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {
  buildTodayTaskBoard,
  completeClassificationTask,
  createClassificationTask,
  failClassificationTask,
  localDateKey,
  recoverInterruptedTasks
} = require("../electron/services/task-board-service.cjs");

test("今日任务板按本机自然日统计分类素材", () => {
  const now = new Date(2026, 7, 21, 18, 0, 0);
  const todayTask = completeClassificationTask(
    createClassificationTask({ id: "task-1", sku: "918", batchName: "晚间上传", sourceCount: 2 }, new Date(2026, 7, 21, 17, 0, 0)),
    {
      manifestPath: path.join("D:\\素材", "918", "manifest.json"),
      batchDir: path.join("D:\\素材", "918"),
      summary: { sourceCount: 2, materialCount: 12, lowConfidenceCount: 2, unusableCount: 1, categories: { 人物穿搭: 7, 细节讲解: 5 } }
    },
    new Date(2026, 7, 21, 17, 30, 0)
  );
  const yesterdayTask = completeClassificationTask(
    createClassificationTask({ id: "task-2", sku: "919", batchName: "昨日", sourceCount: 1 }, new Date(2026, 7, 20, 12, 0, 0)),
    { summary: { sourceCount: 1, materialCount: 4 } },
    new Date(2026, 7, 20, 12, 10, 0)
  );

  const board = buildTodayTaskBoard({ records: [todayTask, yesterdayTask], now });
  assert.equal(board.date, "2026-08-21");
  assert.equal(board.batchCount, 1);
  assert.equal(board.sourceCount, 2);
  assert.equal(board.materialCount, 12);
  assert.equal(board.reviewCount, 2);
  assert.deepEqual(board.categories, { 人物穿搭: 7, 细节讲解: 5 });
});

test("任务记录与相同 manifest 只统计一次并由磁盘结果补全", () => {
  const now = new Date(2026, 7, 21, 12, 0, 0);
  const manifestPath = path.resolve("D:\\素材\\918\\2026-08-21_上午\\manifest.json");
  const record = createClassificationTask({ id: "task-1", sku: "918", batchName: "上午", sourceCount: 2 }, new Date(2026, 7, 21, 10, 0, 0));
  record.manifestPath = manifestPath;
  const board = buildTodayTaskBoard({
    records: [record],
    batches: [{
      manifestPath,
      status: "ready_for_review",
      sku: "918",
      batchName: "上午",
      createdAt: new Date(2026, 7, 21, 10, 0, 0).toISOString(),
      updatedAt: new Date(2026, 7, 21, 10, 20, 0).toISOString(),
      summary: { sourceCount: 2, materialCount: 9, lowConfidenceCount: 1 }
    }],
    now
  });
  assert.equal(board.batchCount, 1);
  assert.equal(board.completedCount, 1);
  assert.equal(board.materialCount, 9);
});

test("失败与上次退出时遗留任务会进入异常计数", () => {
  const startedAt = new Date(2026, 7, 21, 8, 0, 0);
  const interrupted = recoverInterruptedTasks([
    createClassificationTask({ id: "task-1", sku: "918", batchName: "中断", sourceCount: 1 }, startedAt)
  ], new Date(2026, 7, 21, 8, 5, 0));
  const failed = failClassificationTask(
    createClassificationTask({ id: "task-2", sku: "919", batchName: "失败", sourceCount: 1 }, startedAt),
    new Error("模型连接失败"),
    new Date(2026, 7, 21, 8, 6, 0)
  );
  const board = buildTodayTaskBoard({ records: [...interrupted, failed], now: new Date(2026, 7, 21, 9, 0, 0) });
  assert.equal(board.failedCount, 2);
  assert.equal(board.tasks[0].errorMessage, "模型连接失败");
  assert.equal(localDateKey(board.tasks[0].completedAt), "2026-08-21");
});
