const fs = require("node:fs");
const path = require("node:path");
const { createClassifiedMaterialCatalog } = require("../electron/services/classified-material-catalog-service.cjs");
const { applyStrictTimeline, validateEditingPlan } = require("../electron/services/ai-editor-service.cjs");
const { buildAlignedSentenceTimeline, validateSentenceAlignment } = require("../electron/services/sentence-media-alignment-service.cjs");

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

const fixturePath = path.resolve(argument("--fixture") || path.join(__dirname, "..", "tests", "fixtures", "editing-agent-trousers-golden.json"));
const reportPath = argument("--report") ? path.resolve(argument("--report")) : "";
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
const catalog = createClassifiedMaterialCatalog({ sku: fixture.sku, humanConfirmed: fixture.humanConfirmed, manifests: fixture.manifests });
const validated = validateEditingPlan(fixture.modelPlan, { script: fixture.script, materials: catalog.materials, model: "golden", provider: "fixture" });
const plan = applyStrictTimeline(validated, fixture.script, catalog.materials);
const aligned = buildAlignedSentenceTimeline({ script: fixture.script, editingPlan: plan });
const alignment = validateSentenceAlignment(aligned);
const usedIds = [...new Set(plan.decisions.flatMap((decision) => decision.timeline.map((item) => item.materialId)))].sort();
const checks = {
  planReady: plan.status === "ready",
  continuityPassed: plan.narrativeContinuity?.status === "pass",
  narrativeOrderMatched: JSON.stringify(plan.narrativeContinuity?.narrativeOrder) === JSON.stringify(fixture.expected.narrativeOrder),
  catalogComplete: catalog.materialCount === fixture.expected.materialCount && JSON.stringify(catalog.materials.map((item) => item.id).sort()) === JSON.stringify(fixture.expected.materialIds),
  noSecondaryFilter: catalog.audit.excludedBySecondaryQualityFilter === 0 && plan.timelineOptimization?.catalogPolicy === "trust_human_confirmed_classification",
  everyMaterialUsed: JSON.stringify(usedIds) === JSON.stringify(fixture.expected.materialIds),
  alignmentPassed: alignment.status === "pass" && aligned.totalDuration === fixture.expected.totalDuration
};
const report = {
  version: "editing-agent-golden-2026.08.1",
  fixturePath,
  passed: Object.values(checks).every(Boolean),
  checks,
  catalog: { sku: catalog.sku, materialCount: catalog.materialCount, categoryCounts: catalog.categoryCounts, audit: catalog.audit },
  plan: { status: plan.status, narrativeContinuity: plan.narrativeContinuity, timelineOptimization: plan.timelineOptimization },
  alignment,
  generatedAt: new Date().toISOString()
};
if (reportPath) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.passed) process.exitCode = 1;
