const { buildSentenceIntents } = require("./narrative-continuity-service.cjs");

function buildSentenceMediaBindings(input = {}) {
  const intents = buildSentenceIntents(input.script || {});
  const materialMap = new Map((Array.isArray(input.materials) ? input.materials : []).map((material) => [String(material.id), material]));
  const decisionMap = new Map((Array.isArray(input.decisions) ? input.decisions : []).map((decision) => [String(decision.blockId), decision]));
  return intents.map((intent) => {
    const decision = decisionMap.get(String(intent.blockId)) || {};
    const materialIds = [...new Set([
      ...(Array.isArray(decision.selectedMaterialIds) ? decision.selectedMaterialIds : []),
      ...(Array.isArray(decision.timeline) ? decision.timeline.map((item) => item.materialId) : [])
    ].map(String).filter(Boolean))];
    return {
      blockId: intent.blockId,
      sentenceIntent: intent,
      selectedMaterialIds: materialIds,
      selectedMaterials: materialIds.map((id) => materialMap.get(id)).filter(Boolean).map((material) => ({ ...material })),
      timeline: (Array.isArray(decision.timeline) ? decision.timeline : []).map((item) => ({
        materialId: String(item.materialId || ""),
        sourceStart: Number(item.sourceStart || 0),
        duration: Number(item.duration || 0)
      })),
      reason: String(decision.reason || "")
    };
  });
}

function cleanText(value) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 1200);
}

function formatSrtTime(value) {
  const milliseconds = Math.max(0, Math.round(Number(value || 0) * 1000));
  const hours = Math.floor(milliseconds / 3600000);
  const minutes = Math.floor((milliseconds % 3600000) / 60000);
  const seconds = Math.floor((milliseconds % 60000) / 1000);
  const remainder = milliseconds % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(remainder).padStart(3, "0")}`;
}

function joinVoiceSentences(sentences) {
  return sentences.map((sentence) => {
    const value = cleanText(sentence.voiceText);
    return value && !/[。！？!?]$/.test(value) ? `${value}。` : value;
  }).filter(Boolean).join("");
}

function buildAlignedSentenceTimeline(input = {}) {
  const script = input.script || {};
  const blocks = Array.isArray(script.blocks) ? script.blocks : [];
  const decisions = Array.isArray(input.editingPlan?.decisions) ? input.editingPlan.decisions : [];
  const decisionMap = new Map(decisions.map((decision) => [String(decision.blockId), decision]));
  let cursor = 0;
  const sentences = blocks.map((block, index) => {
    const blockId = String(block.id || `block-${index + 1}`);
    const decision = decisionMap.get(blockId) || {};
    const timeline = (Array.isArray(decision.timeline) ? decision.timeline : []).map((item) => ({
      materialId: String(item.materialId || ""),
      sourceStart: Number(item.sourceStart || 0),
      duration: Number(item.duration || 0)
    }));
    const plannedDuration = timeline.reduce((sum, item) => sum + Math.max(0, item.duration), 0);
    const duration = Number(Math.max(0.1, plannedDuration || Number(block.duration || 2)).toFixed(3));
    const start = Number(cursor.toFixed(3));
    const end = Number((start + duration).toFixed(3));
    const musicOnly = script.voiceMode === "music_only";
    const voiceEnabled = !musicOnly && (script.voiceMode === "full_voice" || block.voiceEnabled !== false);
    const canonicalVoiceText = voiceEnabled ? cleanText(block.voiceText ?? block.text ?? block.subtitleText ?? "") : "";
    const subtitleText = voiceEnabled
      ? canonicalVoiceText
      : cleanText(block.subtitleText ?? block.text ?? "");
    cursor = end;
    return {
      id: `sentence-${blockId}`,
      blockId,
      order: index,
      name: String(block.name || `段落 ${index + 1}`),
      start,
      end,
      duration,
      text: voiceEnabled ? canonicalVoiceText : subtitleText,
      voiceEnabled,
      voiceText: canonicalVoiceText,
      subtitleText,
      materialIds: [...new Set(timeline.map((item) => item.materialId).filter(Boolean))],
      timeline
    };
  });
  return {
    version: "sentence-media-alignment-2026.08.1",
    scriptId: String(script.id || ""),
    voiceMode: ["full_voice", "partial_voice", "music_only"].includes(script.voiceMode) ? script.voiceMode : "full_voice",
    sentences,
    voiceText: joinVoiceSentences(sentences.filter((sentence) => sentence.voiceEnabled)),
    totalDuration: Number(cursor.toFixed(3)),
    source: "single_sentence_timeline"
  };
}

function buildAlignedSrt(aligned = {}) {
  return (Array.isArray(aligned.sentences) ? aligned.sentences : [])
    .filter((sentence) => cleanText(sentence.subtitleText) && Number(sentence.end) > Number(sentence.start))
    .map((sentence, index) => `${index + 1}\n${formatSrtTime(sentence.start)} --> ${formatSrtTime(sentence.end)}\n${cleanText(sentence.subtitleText)}\n`)
    .join("\n");
}

function validateSentenceAlignment(aligned = {}) {
  const sentences = Array.isArray(aligned.sentences) ? aligned.sentences : [];
  const issues = [];
  let previousEnd = 0;
  for (const sentence of sentences) {
    if (sentence.voiceEnabled && cleanText(sentence.voiceText) !== cleanText(sentence.subtitleText)) {
      issues.push({ code: "VOICE_SUBTITLE_TEXT_MISMATCH", blockId: sentence.blockId, message: `${sentence.name} 的配音和字幕不是同一文本源` });
    }
    if (Number(sentence.start) < previousEnd - 0.001) {
      issues.push({ code: "SENTENCE_TIMELINE_OVERLAP", blockId: sentence.blockId, message: `${sentence.name} 与上一句时间重叠` });
    }
    previousEnd = Math.max(previousEnd, Number(sentence.end || 0));
  }
  if (aligned.voiceMode === "music_only" && cleanText(aligned.voiceText)) {
    issues.push({ code: "MUSIC_ONLY_HAS_VOICE", blockId: "", message: "纯音乐模式不应生成口播" });
  }
  return {
    version: aligned.version || "sentence-media-alignment-2026.08.1",
    status: issues.length ? "blocked" : "pass",
    issues,
    sentenceCount: sentences.length,
    totalDuration: Number(aligned.totalDuration || 0)
  };
}

module.exports = {
  buildAlignedSentenceTimeline,
  buildAlignedSrt,
  buildSentenceMediaBindings,
  cleanText,
  formatSrtTime,
  validateSentenceAlignment
};
