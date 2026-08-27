function text(value, limit = 300) {
  return String(value ?? "").trim().slice(0, limit);
}

function strings(value, limit = 30) {
  return (Array.isArray(value) ? value : []).map((item) => text(item)).filter(Boolean).slice(0, limit);
}

function recipeFrom(value = {}) {
  return value.learningRecipe || value.editingRecipe || value.script?.editingRecipe || {};
}

function structuralRecipe(caseRecord = {}) {
  const recipe = recipeFrom(caseRecord);
  return {
    caseId: text(caseRecord.caseId, 160),
    patternId: text(recipe.patternId, 120),
    hook: { type: text(recipe.hook?.type || "statement", 40) },
    narrativeOrder: strings(recipe.narrativeOrder, 30),
    requiredMaterialRoles: strings(recipe.requiredMaterialRoles, 20),
    editingTechniques: strings(recipe.editingTechniques || recipe.patterns, 30),
    pacing: recipe.pacing && typeof recipe.pacing === "object" ? {
      style: text(recipe.pacing.style, 80),
      rhythmNotes: strings(recipe.pacing.rhythmNotes, 12)
    } : {},
    subtitleStyle: recipe.subtitleStyle && typeof recipe.subtitleStyle === "object" ? {
      density: text(recipe.subtitleStyle.density, 80),
      position: text(recipe.subtitleStyle.position, 80),
      rhythm: text(recipe.subtitleStyle.rhythm, 120)
    } : {},
    voiceStyle: recipe.voiceStyle && typeof recipe.voiceStyle === "object" ? {
      tone: text(recipe.voiceStyle.tone, 100),
      cadence: text(recipe.voiceStyle.cadence, 100)
    } : {},
    musicStyle: recipe.musicStyle && typeof recipe.musicStyle === "object" ? {
      role: text(recipe.musicStyle.role, 100),
      energy: text(recipe.musicStyle.energy, 100)
    } : {},
    blocks: (Array.isArray(recipe.blocks) ? recipe.blocks : []).slice(0, 30).map((block) => ({
      narrativeRole: text(block.narrativeRole, 80),
      materialType: text(block.materialType || block.type, 80),
      duration: Number(Math.max(0, Number(block.duration || 0)).toFixed(3)),
      cutTechnique: text(block.cutTechnique, 80)
    })),
    factReuseAllowed: false
  };
}

function intersectionCount(left, right) {
  const rightSet = new Set(right);
  return new Set(left.filter((item) => rightSet.has(item))).size;
}

function candidateStatus(caseRecord = {}) {
  if (caseRecord.status === "deleted") return "deleted";
  if (caseRecord.caseType === "negative_example") return "negative_example";
  if (caseRecord.rights?.userOwnedOrAuthorized !== true) return "unauthorized";
  if (caseRecord.labels?.accepted === false) return "rejected";
  const rating = Number(caseRecord.labels?.rating);
  if (Number.isFinite(rating) && rating < 4) return "low_rating";
  return "eligible";
}

function scoreCase(caseRecord, query) {
  const recipe = structuralRecipe(caseRecord);
  let score = 0;
  const reasons = [];
  if (query.sku && text(caseRecord.sku) === query.sku) { score += 40; reasons.push("同一款号案例"); }
  if (query.category && text(caseRecord.category) === query.category) { score += 25; reasons.push("同一商品类目"); }
  if (query.recipe.patternId && recipe.patternId === query.recipe.patternId) { score += 30; reasons.push("脚本模式一致"); }
  if (query.recipe.hook?.type && recipe.hook.type === query.recipe.hook.type) { score += 10; reasons.push("开头钩子一致"); }
  const narrativeMatches = intersectionCount(recipe.narrativeOrder, strings(query.recipe.narrativeOrder));
  if (narrativeMatches) { score += Math.min(20, narrativeMatches * 5); reasons.push(`叙事角色匹配 ${narrativeMatches} 项`); }
  const materialMatches = intersectionCount(recipe.requiredMaterialRoles, strings(query.recipe.requiredMaterialRoles));
  if (materialMatches) { score += Math.min(15, materialMatches * 5); reasons.push(`素材分类匹配 ${materialMatches} 项`); }
  const techniqueMatches = intersectionCount(recipe.editingTechniques, strings(query.recipe.editingTechniques || query.recipe.patterns));
  if (techniqueMatches) { score += Math.min(10, techniqueMatches * 5); reasons.push(`剪辑手法匹配 ${techniqueMatches} 项`); }
  const rating = Number(caseRecord.labels?.rating);
  if (Number.isFinite(rating)) score += rating;
  return { score, reasons, recipe };
}

function retrieveEditingCases(input = {}) {
  const cases = Array.isArray(input.cases) ? input.cases : [];
  const recipe = recipeFrom(input.script || input);
  const query = {
    sku: text(input.sku, 80),
    category: text(input.category, 100),
    recipe
  };
  const excluded = [];
  const ranked = [];
  for (const caseRecord of cases) {
    const status = candidateStatus(caseRecord);
    if (status !== "eligible") {
      excluded.push({ caseId: text(caseRecord.caseId, 160), reason: status });
      continue;
    }
    const scored = scoreCase(caseRecord, query);
    ranked.push({
      caseId: text(caseRecord.caseId, 160),
      version: Number(caseRecord.version || 1),
      sku: text(caseRecord.sku, 80),
      category: text(caseRecord.category, 100),
      score: scored.score,
      reasons: scored.reasons,
      structuralRecipe: scored.recipe,
      factReuseAllowed: false
    });
  }
  const limit = Math.max(1, Math.min(5, Math.round(Number(input.limit || 5))));
  const matches = ranked.sort((left, right) => (right.score - left.score) || left.caseId.localeCompare(right.caseId)).slice(0, limit);
  return {
    matches,
    fallback: matches.length ? null : "use_current_script_and_classified_material_catalog",
    audit: {
      source: "user_provided_training_library_only",
      sourceCount: cases.length,
      eligibleCount: ranked.length,
      excludedCount: excluded.length,
      excluded,
      marketSearchAttempted: false,
      remoteDownloadAttempted: false
    }
  };
}

module.exports = {
  candidateStatus,
  retrieveEditingCases,
  structuralRecipe
};
