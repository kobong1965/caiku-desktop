(() => {
  const desktop = window.caiku;
  const nativeState = {
    bootstrap: null,
    settings: null,
    selectedSources: [],
    sourceInfo: [],
    activeManifest: null,
    activeTaskId: null,
    pendingKind: null,
    skuOptions: [],
    selectedSku: ""
  };

  function ensureRuntimeBanner() {
    let banner = document.querySelector("#desktopRuntime");
    if (!banner) {
      banner = document.createElement("div");
      banner.id = "desktopRuntime";
      banner.className = "desktop-runtime";
      document.querySelector("main")?.prepend(banner);
    }
    return banner;
  }

  function setRuntimeStatus(title, detail, isError = false) {
    const banner = ensureRuntimeBanner();
    banner.classList.toggle("is-error", isError);
    banner.innerHTML = `<span><strong>${escapeHtml(title)}</strong>${escapeHtml(detail || "")}</span><span>${desktop ? "桌面安全工作流" : "浏览器预览"}</span>`;
  }

  function formatBytes(value) {
    const bytes = Number(value || 0);
    if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
    if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
    return `${Math.round(bytes / 1024)} KB`;
  }

  function formatDuration(value) {
    const seconds = Math.max(0, Number(value || 0));
    const minutes = Math.floor(seconds / 60);
    const rest = Math.floor(seconds % 60);
    return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  }

  function setUploadStep(step) {
    document.querySelectorAll(".upload-stepper li").forEach((item, index) => {
      item.classList.toggle("is-current", index + 1 === step);
      item.classList.toggle("is-complete", index + 1 < step);
    });
  }

  function renderSelectedSources() {
    fileList.innerHTML = nativeState.selectedSources.map((sourcePath, index) => {
      const info = nativeState.sourceInfo.find((item) => item.filePath === sourcePath);
      const name = sourcePath.split(/[\\/]/).pop();
      const meta = info
        ? `${info.duration.toFixed(2)} 秒 · ${info.width}×${info.height} · ${formatBytes(info.size)}`
        : "等待读取视频信息";
      return `<div class="file-item" data-native-source="${index}"><span class="file-preview"><span class="generated-thumb">视频</span></span><span><strong>${escapeHtml(name)}</strong><small>${escapeHtml(meta)}</small></span><button type="button" data-remove-native-source="${index}" aria-label="移除${escapeHtml(name)}">×</button></div>`;
    }).join("");
    const count = nativeState.selectedSources.length;
    const legacyStart = document.querySelector("#startAnalysisButton");
    if (legacyStart) {
      legacyStart.textContent = `开始分析 ${count} 个视频`;
      legacyStart.disabled = count === 0;
    }

    const simpleList = document.querySelector("#simpleSourceList");
    if (simpleList) {
      simpleList.innerHTML = count
        ? nativeState.selectedSources.map((sourcePath, index) => {
          const info = nativeState.sourceInfo.find((item) => item.filePath === sourcePath);
          const name = sourcePath.split(/[\\/]/).pop();
          const meta = info
            ? `${info.duration.toFixed(2)} 秒 · ${info.width}×${info.height} · ${formatBytes(info.size)}`
            : "正在读取视频信息";
          return `<div class="simple-source-file"><span class="file-preview"><span class="generated-thumb">视频</span></span><span><strong title="${escapeHtml(name)}">${escapeHtml(name)}</strong><small>${escapeHtml(meta)}</small></span><button class="asset-delete" type="button" data-remove-simple-source="${index}" aria-label="删除${escapeHtml(name)}">删除</button></div>`;
        }).join("")
        : '<button class="simple-empty-upload" id="simpleEmptyUpload" type="button"><strong>添加视频</strong><small>支持 MP4、MOV，可一次选择多个视频或直接拖入</small></button>';
    }
    const hint = document.querySelector("#simpleUploadHint");
    if (hint) hint.textContent = count ? `已添加 ${count} 个视频，可继续添加或直接分析` : "还没有添加视频";
    const simpleStart = document.querySelector("#simpleStartAnalysis");
    if (simpleStart) {
      simpleStart.textContent = count ? `开始分析 ${count} 个视频` : "开始 AI 分析";
      simpleStart.disabled = count === 0;
    }
  }

  function syncSimpleBatchFields(direction = "toLegacy") {
    const simpleBatch = document.querySelector("#simpleBatchNameInput");
    if (!simpleBatch) return;
    if (direction === "fromLegacy") {
      simpleBatch.value = batchNameInput.value;
    } else {
      batchNameInput.value = simpleBatch.value;
      updateImportPathNative();
    }
  }

  function defaultBatchName() {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const hour = String(now.getHours()).padStart(2, "0");
    const minute = String(now.getMinutes()).padStart(2, "0");
    return `${month}月${day}日 ${hour}-${minute} 上传`;
  }

  function currentSkuChoice() {
    return document.querySelector("#newSkuInput")?.value.trim() || nativeState.selectedSku || "";
  }

  function updateSkuPathPreview() {
    const sku = currentSkuChoice();
    const batchName = document.querySelector("#skuBatchNameInput")?.value.trim() || "待命名批次";
    const preview = document.querySelector("#skuPathPreview");
    if (preview) preview.textContent = sku ? `${nativeState.settings.materialRoot}\\${sku}\\今天_${batchName}` : "请选择款号";
  }

  function renderSkuOptions(filter = "") {
    const list = document.querySelector("#skuOptionList");
    const needle = String(filter || "").trim().toLowerCase();
    const options = nativeState.skuOptions.filter((option) => option.sku.toLowerCase().includes(needle));
    list.innerHTML = options.length ? options.map((option) => `<label class="sku-option ${nativeState.selectedSku === option.sku ? "is-selected" : ""}"><input type="radio" name="skuOption" value="${escapeHtml(option.sku)}" ${nativeState.selectedSku === option.sku ? "checked" : ""}><span><strong>${escapeHtml(option.sku)}</strong><small>${Number(option.batchCount || 0)} 个批次 · ${Number(option.materialCount || 0)} 个素材</small></span><i>选择</i></label>`).join("") : '<div class="sku-option-empty">没有匹配的已有款号，可以在下方新建。</div>';
    list.querySelectorAll('input[name="skuOption"]').forEach((input) => input.addEventListener("change", () => {
      nativeState.selectedSku = input.value;
      document.querySelector("#newSkuInput").value = "";
      renderSkuOptions(document.querySelector("#skuSearchInput").value);
      updateSkuPathPreview();
    }));
  }

  async function openSkuPickerDialog() {
    if (!nativeState.selectedSources.length) {
      showToast("请先选择至少一个原视频", true);
      return;
    }
    try {
      nativeState.skuOptions = await desktop.listSkuOptions();
      const preferredSku = nativeState.activeManifest?.sku || skuInput.value.trim();
      nativeState.selectedSku = nativeState.skuOptions.some((option) => option.sku === preferredSku) ? preferredSku : nativeState.skuOptions[0]?.sku || "";
      document.querySelector("#skuSearchInput").value = "";
      document.querySelector("#newSkuInput").value = "";
      document.querySelector("#skuBatchNameInput").value = document.querySelector("#simpleBatchNameInput")?.value.trim() || batchNameInput.value.trim() || defaultBatchName();
      document.querySelector("#skuPickerSummary").textContent = `已上传 ${nativeState.selectedSources.length} 个视频。选择款号后才会建立素材盘目录并开始分析。`;
      renderSkuOptions();
      updateSkuPathPreview();
      setUploadStep(2);
      const dialog = document.querySelector("#skuPickerDialog");
      if (!dialog.open) dialog.showModal();
      setTimeout(() => document.querySelector(nativeState.skuOptions.length ? "#skuSearchInput" : "#newSkuInput")?.focus(), 0);
    } catch (error) {
      showNativeError("读取款号素材盘失败", error);
    }
  }

  async function confirmSkuAndStart() {
    const sku = currentSkuChoice();
    const batchName = document.querySelector("#skuBatchNameInput").value.trim() || defaultBatchName();
    if (!sku) {
      showToast("请选择已有款号或输入新款号", true);
      document.querySelector("#newSkuInput").focus();
      return;
    }
    skuInput.value = sku;
    batchNameInput.value = batchName;
    const simpleBatch = document.querySelector("#simpleBatchNameInput");
    if (simpleBatch) simpleBatch.value = batchName;
    updateImportPathNative();
    document.querySelector("#skuPickerDialog").close();
    setUploadStep(3);
    await startNativeProcessing();
  }

  async function refreshTaskBoard({ silent = false } = {}) {
    try {
      const board = await desktop.getTodayTasks();
      nativeState.taskBoard = board;
      window.renderTaskBoard?.(board);
      if (!silent) showToast("今日任务统计已刷新");
    } catch (error) {
      if (!silent) showNativeError("刷新任务板失败", error);
    }
  }

  function resetSimpleResult() {
    const title = document.querySelector("#simple-result-title");
    const path = document.querySelector("#simpleResultPath");
    const status = document.querySelector("#simpleResultStatus");
    if (title) title.textContent = "尚未处理新批次";
    if (path) path.textContent = "添加视频并完成分析后，结果会自动保存到素材盘。";
    if (status) {
      status.className = "status-pill";
      status.textContent = "等待上传";
    }
    document.querySelector("#simpleMaterialCount").textContent = "0";
    document.querySelector("#simpleReviewCount").textContent = "0";
    document.querySelector("#simpleMinimumDuration").textContent = "≥ 2 秒";
  }

  async function addSourcePaths(paths) {
    const additions = [...new Set(paths || [])].filter((sourcePath) => sourcePath && !nativeState.selectedSources.includes(sourcePath));
    if (!additions.length) return;
    nativeState.selectedSources.push(...additions);
    setUploadStep(1);
    renderSelectedSources();
    try {
      const probes = await desktop.probeVideos(additions);
      nativeState.sourceInfo.push(...probes);
      renderSelectedSources();
      showToast(`已读取 ${probes.length} 个原视频，最短片段规则锁定为 2 秒`);
    } catch (error) {
      showNativeError("读取视频失败", error);
    }
  }

  function showNativeProgress(title, text) {
    const dialog = document.querySelector("#progressDialog");
    document.querySelector("#progressTitle").textContent = title;
    document.querySelector("#progressText").textContent = text;
    document.querySelector("#dialogProgressBar").style.width = "0%";
    document.querySelector("#dialogProgressValue").textContent = "0%";
    if (!dialog.open) dialog.showModal();
  }

  function updateNativeProgress(payload) {
    nativeState.activeTaskId = payload.taskId || nativeState.activeTaskId;
    const percent = Math.max(0, Math.min(100, Math.round(Number(payload.progress || 0) * 100)));
    document.querySelector("#dialogProgressBar").style.width = `${percent}%`;
    document.querySelector("#dialogProgressValue").textContent = `${percent}%`;
    if (payload.message) document.querySelector("#progressText").textContent = payload.message;
  }

  function closeNativeProgress() {
    const dialog = document.querySelector("#progressDialog");
    if (dialog.open) dialog.close();
    nativeState.activeTaskId = null;
    nativeState.pendingKind = null;
  }

  function ensureNativeReportDialog() {
    let dialog = document.querySelector("#nativeReportDialog");
    if (dialog) return dialog;
    dialog = document.createElement("dialog");
    dialog.id = "nativeReportDialog";
    dialog.className = "app-dialog";
    dialog.innerHTML = '<button class="dialog-close" type="button" data-close-native-report aria-label="关闭">×</button><p class="eyebrow" id="nativeReportEyebrow">本地检查</p><h2 id="nativeReportTitle">检查结果</h2><p id="nativeReportMessage"></p><div class="native-report" id="nativeReportItems"></div><div class="dialog-actions"><button class="button primary" type="button" data-close-native-report>知道了</button></div>';
    document.body.append(dialog);
    dialog.addEventListener("click", (event) => {
      if (event.target.closest("[data-close-native-report]")) dialog.close();
    });
    return dialog;
  }

  function showNativeReport(title, message, issues = [], eyebrow = "本地检查") {
    const dialog = ensureNativeReportDialog();
    dialog.querySelector("#nativeReportEyebrow").textContent = eyebrow;
    dialog.querySelector("#nativeReportTitle").textContent = title;
    dialog.querySelector("#nativeReportMessage").textContent = message;
    dialog.querySelector("#nativeReportItems").innerHTML = issues.length
      ? issues.map((issue) => `<div class="native-report-item"><strong>${escapeHtml(issue.term || issue.name || issue.level || "需要复核")}</strong><small>${escapeHtml(issue.message || issue.detail || issue.suggestion || "")}</small>${issue.suggestion ? `<small>建议：${escapeHtml(issue.suggestion)}</small>` : ""}</div>`).join("")
      : '<div class="native-report-item"><strong>没有发现阻断项</strong><small>仍需在正式投放前人工确认商品资质、价格、库存和平台实时规则。</small></div>';
    if (!dialog.open) dialog.showModal();
  }

  function showNativeError(title, error) {
    closeNativeProgress();
    setRuntimeStatus("桌面服务需要处理", error.message, true);
    showNativeReport(title, error.message || "未知错误", error.details?.issues || [{ name: error.code || "错误", detail: error.stderr || "请检查文件后重试" }], "任务未完成");
    showToast(error.message || title, true);
  }

  function collectAiSettings() {
    return {
      enabled: true,
      provider: "qwen",
      region: document.querySelector("#qwenRegionSelect")?.value || "china",
      model: document.querySelector("#qwenModelSelect")?.value || "qwen3.5-flash",
      framesPerClip: Number(document.querySelector("#aiFramesSelect")?.value || 4),
      confidenceThreshold: Number(document.querySelector("#aiConfidenceSelect")?.value || 0.85),
      allowOfflineFallback: document.querySelector("#allowOfflineFallback")?.checked === true
    };
  }

  function setAiConnectionStatus(message, tone = "") {
    const status = document.querySelector("#aiConnectionStatus");
    if (!status) return;
    status.textContent = message;
    status.className = `model-connection-status${tone ? ` is-${tone}` : ""}`;
  }

  function updateBatchModelStatus() {
    const card = document.querySelector("#batchModelStatus");
    if (!card || !nativeState.settings) return;
    const ai = nativeState.settings.aiClassification || {};
    card.classList.remove("is-missing", "is-error");
    const title = card.querySelector("strong");
    const detail = card.querySelector("small");
    if (ai.hasApiKey) {
      title.textContent = `千问视觉分类已配置 · ${ai.model || "qwen3.5-flash"}`;
      detail.textContent = `每片段抽取 ${ai.framesPerClip || 4} 帧；低于 ${Math.round(Number(ai.confidenceThreshold || 0.85) * 100)}% 进入人工复核。`;
    } else if (ai.allowOfflineFallback) {
      card.classList.add("is-missing");
      title.textContent = "千问密钥未配置 · 将使用离线兜底";
      detail.textContent = "所有兜底分类都会强制标记待复核；建议先配置 API Key。";
    } else {
      card.classList.add("is-error");
      title.textContent = "千问 API Key 未配置 · 暂不能开始分类";
      detail.textContent = "请先配置视觉模型，确保素材依据画面内容分配。";
    }
  }

  function openModelSettings() {
    navigate("settings");
    document.querySelector('[data-settings-tab="model"]')?.click();
    document.querySelector("#qwenApiKeyInput")?.focus();
  }

  async function testNativeAiConnection() {
    const button = document.querySelector("#testAiConnection");
    const keyInput = document.querySelector("#qwenApiKeyInput");
    button.disabled = true;
    button.textContent = "连接中…";
    setAiConnectionStatus("正在验证模型与密钥");
    try {
      const result = await desktop.testAiConnection(collectAiSettings(), keyInput.value.trim());
      setAiConnectionStatus(`连接成功 · ${result.model} · ${result.latencyMs} ms`, "success");
      showToast("千问视觉模型连接成功");
    } catch (error) {
      setAiConnectionStatus(error.message || "连接失败", "error");
      showToast(error.message || "千问连接失败", true);
    } finally {
      button.disabled = false;
      button.textContent = "测试连接";
    }
  }

  async function clearNativeAiKey() {
    try {
      nativeState.settings = await desktop.clearAiKey();
      document.querySelector("#qwenApiKeyInput").value = "";
      setAiConnectionStatus("已清除保存的密钥");
      updateBatchModelStatus();
      showToast("已从 Windows 安全存储中清除千问 API Key");
    } catch (error) {
      showNativeError("清除千问密钥失败", error);
    }
  }

  function applyManifestToClipEditor(manifest) {
    const grid = document.querySelector("#clipGrid");
    if (!grid) return;
    const materials = manifest.materials || [];
    grid.innerHTML = materials.map((material) => {
      const needsReview = material.captionStatus === "treated_needs_review" || material.classificationNeedsReview;
      const category = `${material.type}${needsReview ? " issue" : ""}`;
      const modeLabel = material.classificationMode === "qwen_vision" ? `Qwen ${Math.round(Number(material.classificationConfidence || 0) * 100)}%` : "离线兜底 · 待复核";
      return `
      <button class="clip-card" data-clip data-material-id="${escapeHtml(material.id)}" data-category="${escapeHtml(category)}" data-name="${escapeHtml(material.name)}" data-duration="${Number(material.duration).toFixed(2)}" data-time="${Number(material.sourceStart).toFixed(2)}s — ${Number(material.sourceEnd).toFixed(2)}s" data-source-image="${escapeHtml(material.image)}" data-video-url="${escapeHtml(material.videoUrl || "")}" data-audio-muted="${material.sourceAudioMuted === true ? "true" : "mix-guard"}">
        <span class="clip-image"><img src="${material.image}" alt="${escapeHtml(material.name)}"><span class="clip-audio-badge">静音</span><span class="clip-play-cue" aria-hidden="true">▶</span>${needsReview ? "<i>待复核</i>" : ""}<b>${Number(material.duration).toFixed(2)}s</b></span>
        <span><strong>${escapeHtml(material.name)}</strong><small>${escapeHtml(material.typeLabel)} · ${modeLabel}</small></span>
      </button>`;
    }).join("");
    grid.querySelectorAll("[data-clip]").forEach((card, index) => card.addEventListener("click", () => {
      grid.querySelectorAll("[data-clip]").forEach((item) => item.classList.toggle("is-selected", item === card));
      selectClip(card, { play: true });
      if (index === 0) card.classList.add("is-selected");
    }));
    const first = grid.querySelector("[data-clip]");
    if (first) {
      first.classList.add("is-selected");
      selectClip(first);
    }
    const counts = {
      all: materials.length,
      issue: materials.filter((item) => item.captionStatus === "treated_needs_review" || item.classificationNeedsReview).length,
      outfit: materials.filter((item) => item.type === "outfit").length,
      overall: materials.filter((item) => item.type === "overall").length,
      detail: materials.filter((item) => item.type === "detail").length,
      review: materials.filter((item) => item.type === "review").length,
      action: materials.filter((item) => item.type === "action").length,
      speech: materials.filter((item) => item.type === "speech").length,
      other: materials.filter((item) => item.type === "other").length
    };
    Object.entries(counts).forEach(([type, count]) => {
      const badge = document.querySelector(`[data-filter="${type}"] span`);
      if (badge) badge.textContent = String(count);
    });
    setClipFilter("all");
  }

  function applyManifest(manifest) {
    nativeState.activeManifest = manifest;
    const realMaterials = (manifest.materials || []).map((material) => ({
      ...material,
      duration: Number(material.duration),
      image: material.image || "assets/video1-detail.jpg",
      uses: Number(material.uses || 0),
      manifestPath: material.manifestPath || manifest.manifestPath,
      batchDir: material.batchDir || manifest.batchDir
    }));
    appState.materials = realMaterials;
    appState.editingMaterialIds = realMaterials.slice(0, Math.min(8, realMaterials.length)).map((material) => material.id);
    libraryFolder = "all";
    document.querySelectorAll("[data-folder]").forEach((item) => item.classList.toggle("is-active", item.dataset.folder === "all"));
    currentBatchLabel.textContent = `${manifest.sku} · ${manifest.batchName}`;
    document.querySelector("#editingProjectTitle").textContent = `${manifest.sku} · ${manifest.batchName} 混剪`;
    renderLibrary();
    renderEditing();
    applyManifestToClipEditor(manifest);
    document.querySelector("#summaryIssueCount").textContent = "0";
    document.querySelector("#summaryIssueText").textContent = "全部片段 ≥ 2 秒";
    document.querySelector(".batch-summary > div:first-child strong").textContent = String(realMaterials.length);
    const stageLabels = document.querySelectorAll(".production-line .line-stage small");
    if (stageLabels[0]) stageLabels[0].textContent = `${manifest.sources?.length || 0} 个文件`;
    if (stageLabels[1]) stageLabels[1].textContent = `${realMaterials.length} 个片段`;
    const issueCount = realMaterials.filter((item) => item.captionStatus === "treated_needs_review" || item.classificationNeedsReview).length;
    document.querySelector("#summaryIssueCount").textContent = String(issueCount);
    document.querySelector("#summaryIssueText").textContent = issueCount ? "字幕区需人工抽检" : "全部检查通过";
    document.querySelector("#navIssueCount").textContent = String(issueCount);
    document.querySelector("#lineIssueLabel").textContent = `${issueCount} 个待复核`;
    document.querySelector("#filterIssueCount").textContent = String(issueCount);
    document.querySelector("#batch-panel-title").textContent = `${manifest.batchName} · ${manifest.sku}`;
    const unusableBadge = document.querySelector('[data-folder="unusable"] b');
    if (unusableBadge) unusableBadge.textContent = String(manifest.summary?.unusableCount || 0);
    const fixedFolderButtons = [...document.querySelectorAll("[data-folder]")].filter((button) => !["all", "unusable"].includes(button.dataset.folder));
    if (fixedFolderButtons[0]) {
      fixedFolderButtons[0].dataset.folder = manifest.sku;
      const strong = fixedFolderButtons[0].querySelector("strong");
      const small = fixedFolderButtons[0].querySelector("small");
      const badge = fixedFolderButtons[0].querySelector("b");
      if (strong) strong.textContent = manifest.sku;
      if (small) small.textContent = manifest.batchName;
      if (badge) badge.textContent = String(realMaterials.length);
    }
    if (fixedFolderButtons[1]) fixedFolderButtons[1].hidden = true;
    document.querySelector("#nextActionTitle").textContent = `${realMaterials.length} 个片段等待分类与字幕区复核`;
    document.querySelector("#nextActionText").textContent = `已归档到 ${manifest.batchDir}`;
    const simpleTitle = document.querySelector("#simple-result-title");
    const simplePath = document.querySelector("#simpleResultPath");
    const simpleStatus = document.querySelector("#simpleResultStatus");
    if (simpleTitle) simpleTitle.textContent = `${manifest.sku} · ${manifest.batchName}`;
    if (simplePath) simplePath.textContent = `已保存到 ${manifest.batchDir}`;
    if (simpleStatus) {
      simpleStatus.className = `status-pill ${issueCount ? "processing" : "success"}`;
      simpleStatus.textContent = issueCount ? "需要复核" : "处理完成";
    }
    document.querySelector("#simpleMaterialCount").textContent = String(realMaterials.length);
    document.querySelector("#simpleReviewCount").textContent = String(issueCount);
    const shortest = realMaterials.length ? Math.min(...realMaterials.map((item) => Number(item.duration || 0))) : 2;
    document.querySelector("#simpleMinimumDuration").textContent = `${Math.max(2, shortest).toFixed(1)} 秒`;
    const qwenCount = realMaterials.filter((material) => material.classificationMode === "qwen_vision").length;
    setRuntimeStatus(qwenCount === realMaterials.length && realMaterials.length ? "千问分类批次已连接" : "历史素材批次已连接", qwenCount === realMaterials.length && realMaterials.length ? `${manifest.sku} · ${realMaterials.length} 个 Qwen 分类片段 · 全部 ≥ 2 秒` : `${manifest.sku} · ${realMaterials.length} 个合格片段 · 历史分类未记录模型，建议重新上传分析`);
  }

  function collectScriptText(script) {
    return (script?.blocks || []).map((block) => block.subtitleText || block.voiceText || block.text || block.name || "").join("。");
  }

  function mapNativeOutput(output) {
    const report = output.report || {};
    const scriptStatus = report.script?.status || "review";
    const coverageStatus = report.materialCoverage?.status || "review";
    const visualStatus = report.visualSemantic?.status || "review";
    const voiceStatus = report.voice?.status || "not_selected";
    const technicalStatus = report.technical?.status || "blocked";
    const status = output.status === "pass" ? "pass" : "risk";
    const issues = [];
    if (scriptStatus !== "pass") issues.push("文案风险词需要复核");
    if (coverageStatus !== "pass") issues.push(report.materialCoverage?.message || "素材分类覆盖需要复核");
    if (visualStatus !== "pass") issues.push(report.visualSemantic?.summary || "千问画面与文案一致性需要复核");
    if (voiceStatus === "not_selected") issues.push("需要口播但未生成独立配音");
    if (technicalStatus !== "pass") issues.push("导出技术规格未通过");
    return {
      ...output,
      status,
      duration: formatDuration(output.duration),
      issue: issues.length ? issues.join("；") : "离线四项基础检查通过，可进入人工终审。",
      checks: [
        { name: "千问画面与文案一致性", passed: visualStatus === "pass", detail: report.visualSemantic?.summary || "已抽取成片关键帧并与脚本要求核对" },
        { name: voiceStatus === "not_required" ? "纯音乐模式" : "口播音轨可用", passed: voiceStatus !== "not_selected", detail: report.voice?.note || "已检查音轨" },
        { name: "极限词与风险表达", passed: scriptStatus === "pass", detail: scriptStatus === "pass" ? "离线规则库未发现风险表达" : "请查看逐词报告并人工复核" },
        { name: "1080×1920 投放规格", passed: technicalStatus === "pass", detail: report.technical?.expected || "1080×1920 · 9:16 · H.264 · AAC" }
      ]
    };
  }

  async function chooseVideos() {
    const paths = await desktop.selectVideos();
    await addSourcePaths(paths);
  }

  async function startNativeProcessing() {
    if (!skuInput.value.trim() || !batchNameInput.value.trim()) {
      showToast("请先在弹窗中选择款号和批次名称", true);
      return;
    }
    if (!nativeState.selectedSources.length) {
      showToast("请先选择至少一个原视频", true);
      return;
    }
    const ai = nativeState.settings.aiClassification || {};
    if (!ai.hasApiKey && !ai.allowOfflineFallback) {
      openModelSettings();
      setAiConnectionStatus("请先填写并测试千问 API Key", "error");
      showToast("请先配置千问视觉模型，素材才会按画面内容分类", true);
      return;
    }
    nativeState.pendingKind = "process";
    showNativeProgress("正在拆分、去字幕并分类", "读取镜头变化，所有低于 2 秒的边界会自动合并…");
    try {
      const manifest = await desktop.processBatch({
        sku: skuInput.value.trim(),
        batchName: batchNameInput.value.trim(),
        rootDir: nativeState.settings.materialRoot,
        sourcePaths: nativeState.selectedSources,
        keepOriginals: document.querySelector("#keepOriginals").checked,
        minimumClipSeconds: 2,
        maximumClipSeconds: 9,
        sceneThreshold: 0.32,
        captionMode: nativeState.settings.captionMode || "smart_mask"
      });
      closeNativeProgress();
      applyManifest(manifest);
      nativeState.selectedSources = [];
      nativeState.sourceInfo = [];
      renderSelectedSources();
      setUploadStep(1);
      await refreshTaskBoard({ silent: true });
      navigate("cleanup");
      showToast(`分析完成：${manifest.materials.length} 个片段已分类，请检查结果`);
      scheduleProjectSave();
    } catch (error) {
      showNativeError("素材处理失败", error);
      setUploadStep(1);
      await refreshTaskBoard({ silent: true });
    }
  }

  async function runNativePrecheck() {
    const script = appState.scripts.find((item) => item.id === appState.editingScriptId);
    if (!script) {
      showToast("请先选择脚本", true);
      return;
    }
    const status = document.querySelector("#scriptPrecheckStatus");
    status.className = "status-pill processing";
    status.textContent = "检查中";
    try {
      const report = await desktop.checkText(collectScriptText(script));
      status.className = `status-pill ${report.status === "pass" ? "success" : "danger"}`;
      status.textContent = report.status === "pass" ? "✓ 可进入生成" : `! ${report.issues.length} 项需处理`;
      showNativeReport(
        report.status === "pass" ? "文案预检通过" : "文案需要修改或复核",
        `离线规则库 ${report.ruleVersion} · 得分 ${report.score}`,
        report.issues,
        "脚本发布前检查"
      );
    } catch (error) {
      showNativeError("文案检查失败", error);
    }
  }

  async function runNativeEditingPlan() {
    const script = appState.scripts.find((item) => item.id === appState.editingScriptId);
    const materials = appState.editingMaterialIds.map((id) => appState.materials.find((item) => item.id === id)).filter((item) => item?.filePath);
    if (!nativeState.activeManifest?.batchDir || !script || !materials.length) {
      showToast("请先连接真实素材批次，并选择脚本和画面素材", true);
      return;
    }
    nativeState.pendingKind = "editor-plan";
    showNativeProgress("本地 AI 剪辑师正在安排", `Qwen 3.5 正在核对 ${script.blocks.length} 个脚本段落与 ${materials.length} 个候选素材…`);
    try {
      const plan = await desktop.createEditingPlan({
        projectName: document.querySelector("#editingProjectTitle").textContent,
        script,
        materials
      });
      closeNativeProgress();
      appState.editingPlan = { ...plan, confirmed: false };
      renderEditing();
      scheduleProjectSave();
      const missingCount = plan.decisions.filter((decision) => decision.evidenceStatus === "missing").length;
      setRuntimeStatus("本地 AI 剪辑师已完成安排", missingCount ? `${missingCount} 个段落缺少直接画面证据，请检查改词建议` : `${plan.decisions.length} 个段落均已生成可执行时间线`);
      showToast(missingCount ? `计划已生成，${missingCount} 个段落需要人工复核` : "计划已生成，请确认后开始混剪");
    } catch (error) {
      showNativeError("AI 剪辑规划失败", error);
    }
  }

  async function chooseAudio(kind) {
    try {
      const paths = await desktop.selectAudio(kind);
      if (!paths.length) return;
      const key = kind === "music" ? "music" : "voices";
      appState[key] = paths.map((filePath, index) => ({
        id: `${key}-${Date.now()}-${index}`,
        name: filePath.split(/[\\/]/).pop(),
        filePath,
        meta: kind === "music" ? "本地音乐 · 混音 -20 dB" : "本地配音 · 原文件不修改"
      }));
      renderEditing();
      scheduleProjectSave();
      showToast(`已选择 ${paths.length} 个${kind === "music" ? "音乐" : "配音"}文件`);
    } catch (error) {
      showNativeError("选择音频失败", error);
    }
  }

  async function startNativeMix() {
    const script = appState.scripts.find((item) => item.id === appState.editingScriptId);
    const materials = appState.editingMaterialIds.map((id) => appState.materials.find((item) => item.id === id)).filter((item) => item?.filePath);
    if (!nativeState.activeManifest?.batchDir || !script || !materials.length) {
      showToast("请先连接真实素材批次，并选择脚本和画面素材", true);
      return;
    }
    if (materials.some((material) => Number(material.duration) < 2)) {
      showToast("所选素材包含低于 2 秒的片段，已阻止混剪", true);
      return;
    }
    if (!appState.editingPlan || appState.editingPlan.confirmed !== true || window.caikuEditingPlanIsStale?.() || appState.editingPlan.status === "blocked") {
      showToast("请先让 AI 剪辑师安排镜头，检查并确认决策单", true);
      return;
    }
    if (!appState.music.length) {
      showToast("请先添加本次混剪使用的背景音乐", true);
      return;
    }
    const musicOnly = script.voiceMode === "music_only";
    nativeState.pendingKind = "mix";
    showNativeProgress("正在混剪并逐条质检", `生成 ${appState.outputCount} 条 1080×1920 成片…`);
    try {
      const result = await desktop.mixBatch({
        batchDir: nativeState.activeManifest.batchDir,
        projectName: document.querySelector("#editingProjectTitle").textContent,
        materials,
        script,
        voicePath: musicOnly ? null : appState.voices[0]?.filePath || null,
        musicPath: appState.music[0]?.filePath || null,
        voiceMode: script.voiceMode || "full_voice",
        useOfflineVoice: !musicOnly && !appState.voices.length,
        outputCount: appState.outputCount,
        allowComplianceOverride: false,
        requireEditingPlan: true,
        editingPlan: appState.editingPlan
      });
      closeNativeProgress();
      appState.outputs = result.outputs.map(mapNativeOutput);
      appState.mixOutputDir = result.outputDir;
      appState.productionStep = 5;
      renderEditing();
      setRuntimeStatus("本地成片任务已完成", `${appState.outputs.length} 条 1080×1920 成片 · 每条均有独立质检报告`);
      showToast(`${appState.outputs.length} 条成片与逐条质检报告已保存`);
      window.showMixCompleteDialog?.(result.outputDir, appState.outputs.length, 0);
      scheduleProjectSave();
    } catch (error) {
      showNativeError(error.code === "COMPLIANCE_BLOCKED" ? "文案风险已阻止生成" : "混剪任务失败", error);
    }
  }

  async function openCurrentBatch() {
    if (!nativeState.activeManifest?.batchDir) {
      showToast("当前还没有已连接的素材批次", true);
      return;
    }
    await desktop.openPath(nativeState.activeManifest.batchDir);
  }

  function deleteCurrentBatch() {
    const manifest = nativeState.activeManifest;
    if (!manifest?.batchDir) {
      showToast("当前还没有可删除的素材批次", true);
      return;
    }
    askConfirm(
      `删除整个批次“${manifest.sku} · ${manifest.batchName}”？`,
      "该批次的拆分素材、缩略图、成片和报告会一起移入系统回收站；你最初上传位置中的原视频不会删除。",
      async () => {
        try {
          await desktop.trashPath(manifest.batchDir);
          nativeState.activeManifest = null;
          appState.materials = [];
          appState.editingMaterialIds = [];
          appState.outputs = [];
          renderLibrary();
          renderEditing();
          resetSimpleResult();
          setRuntimeStatus("当前批次已移入回收站", "可以从素材分类上传新批次，或到素材管理重新读取素材盘");
          showToast("整批素材已移入系统回收站，可在回收站恢复");
          scheduleProjectSave();
        } catch (error) {
          showNativeError("删除批次失败", error);
        }
      }
    );
  }

  async function chooseMaterialRoot() {
    const root = await desktop.selectFolder(nativeState.settings.materialRoot);
    if (!root) return;
    nativeState.settings.materialRoot = root;
    document.querySelector("#materialRootInput").value = root;
    updateImportPathNative();
    showToast("素材盘目录已选择，点击保存设置后生效");
  }

  function updateImportPathNative() {
    if (!nativeState.settings) return;
    importPathPreview.textContent = `${nativeState.settings.materialRoot}\\${skuInput.value || "未填写款号"}\\${batchNameInput.value || "未填写批次"}`;
  }

  async function saveNativeSettings() {
    try {
      const baseSettings = await desktop.saveSettings({
        materialRoot: document.querySelector("#materialRootInput").value,
        keepOriginals: document.querySelector("#keepOriginals").checked,
        captionMode: document.querySelector("#captionModeSelect").value
      });
      nativeState.settings = await desktop.saveAiSettings(
        collectAiSettings(),
        document.querySelector("#qwenApiKeyInput").value.trim()
      );
      nativeState.settings = { ...baseSettings, ...nativeState.settings };
      document.querySelector("#qwenApiKeyInput").value = "";
      updateImportPathNative();
      updateBatchModelStatus();
      setAiConnectionStatus(nativeState.settings.aiClassification?.hasApiKey ? "密钥已安全保存" : "未配置密钥");
      setRuntimeStatus("设置已保存", nativeState.settings.materialRoot);
      navigate("source");
      showToast("设置已保存到本机用户数据目录");
    } catch (error) {
      showNativeError("保存设置失败", error);
    }
  }

  let projectSaveTimer;
  function scheduleProjectSave() {
    if (!desktop) return;
    clearTimeout(projectSaveTimer);
    projectSaveTimer = setTimeout(() => {
      desktop.saveProjectState({
        scripts: appState.scripts,
        competitorAnalyses: appState.competitorAnalyses,
        editingScriptId: appState.editingScriptId,
        activeManagedScriptId: appState.activeManagedScriptId,
        editingMaterialIds: appState.editingMaterialIds,
        selectedAiVoice: appState.selectedAiVoice,
        outputCount: appState.outputCount,
        voices: appState.voices,
        music: appState.music,
        mixOutputDir: appState.mixOutputDir,
        editingPlan: appState.editingPlan,
        lastManifestPath: nativeState.activeManifest?.manifestPath || nativeState.bootstrap?.batches?.[0]?.manifestPath || null
      }).catch(() => {});
    }, 500);
  }
  window.caikuScheduleProjectSave = scheduleProjectSave;

  async function initializeDesktop() {
    if (!desktop) {
      setRuntimeStatus("网页交互预览", "真实文件处理只在裁库桌面版中启用");
      return;
    }
    setRuntimeStatus("正在连接本地视频引擎", "检查 FFmpeg 与素材盘…");
    try {
      const bootstrap = await desktop.getBootstrap();
      nativeState.bootstrap = bootstrap;
      nativeState.settings = bootstrap.settings;
      nativeState.taskBoard = bootstrap.taskBoard;
      document.querySelector("#desktopVersionLabel").textContent = `v${bootstrap.app.version} · 本地素材工作台`;
      window.renderUpdateStatus?.({ ...(bootstrap.update || {}), currentVersion: bootstrap.app.version });
      applyWindowState(bootstrap.window || {});
      window.renderTaskBoard?.(bootstrap.taskBoard || {});
      document.querySelector("#materialRootInput").value = bootstrap.settings.materialRoot;
      document.querySelector("#captionModeSelect").value = bootstrap.settings.captionMode || "smart_mask";
      document.querySelector("#keepOriginals").checked = bootstrap.settings.keepOriginals !== false;
      const ai = bootstrap.settings.aiClassification || {};
      document.querySelector("#qwenRegionSelect").value = ai.region || "china";
      document.querySelector("#qwenModelSelect").value = ai.model || "qwen3.5-flash";
      document.querySelector("#aiFramesSelect").value = String(ai.framesPerClip || 4);
      document.querySelector("#aiConfidenceSelect").value = String(ai.confidenceThreshold || 0.85);
      document.querySelector("#allowOfflineFallback").checked = ai.allowOfflineFallback === true;
      setAiConnectionStatus(ai.hasApiKey ? "已安全保存密钥，可测试连接" : "未配置千问 API Key", ai.hasApiKey ? "success" : "error");
      updateBatchModelStatus();
      fileList.innerHTML = "";
      syncSimpleBatchFields("fromLegacy");
      renderSelectedSources();
      updateImportPathNative();
      const saved = bootstrap.projectState || {};
      if (Array.isArray(saved.scripts) && saved.scripts.length) appState.scripts = saved.scripts;
      if (saved.editingScriptId && appState.scripts.some((item) => item.id === saved.editingScriptId)) appState.editingScriptId = saved.editingScriptId;
      if (saved.activeManagedScriptId && appState.scripts.some((item) => item.id === saved.activeManagedScriptId)) appState.activeManagedScriptId = saved.activeManagedScriptId;
      if (Array.isArray(saved.competitorAnalyses)) appState.competitorAnalyses = saved.competitorAnalyses;
      if (saved.selectedAiVoice) appState.selectedAiVoice = saved.selectedAiVoice;
      if (saved.outputCount) appState.outputCount = saved.outputCount;
      if (Array.isArray(saved.voices)) appState.voices = saved.voices;
      if (Array.isArray(saved.music)) appState.music = saved.music;
      if (saved.mixOutputDir) appState.mixOutputDir = saved.mixOutputDir;
      if (saved.editingPlan && typeof saved.editingPlan === "object") appState.editingPlan = saved.editingPlan;
      appState.scripts.forEach(normalizeScript);
      renderCompetitorAnalyses();
      renderManagedScripts();
      renderScriptEditor();
      const lastManifestPath = saved.lastManifestPath;
      let batch = bootstrap.batches.find((item) => item.manifestPath === lastManifestPath) || bootstrap.batches[0];
      if (batch?.manifestPath) {
        batch = await desktop.loadManifest(batch.manifestPath);
        batch.manifestPath = batch.manifestPath || lastManifestPath || bootstrap.batches[0]?.manifestPath;
        applyManifest(batch);
        const materialIndex = new Map();
        for (const diskBatch of bootstrap.batches) {
          for (const material of diskBatch.materials || []) {
            materialIndex.set(material.id, { ...material, duration: Number(material.duration), image: material.image || "assets/video1-detail.jpg", uses: Number(material.uses || 0), manifestPath: material.manifestPath || diskBatch.manifestPath, batchDir: material.batchDir || diskBatch.batchDir });
          }
        }
        for (const material of batch.materials || []) {
          materialIndex.set(material.id, { ...material, duration: Number(material.duration), image: material.image || "assets/video1-detail.jpg", uses: Number(material.uses || 0), manifestPath: material.manifestPath || batch.manifestPath, batchDir: material.batchDir || batch.batchDir });
        }
        appState.materials = [...materialIndex.values()];
        if (Array.isArray(saved.editingMaterialIds)) {
          appState.editingMaterialIds = saved.editingMaterialIds.filter((id) => appState.materials.some((material) => material.id === id));
        }
        renderLibrary();
        renderEditing();
      } else {
        appState.materials = [];
        appState.editingMaterialIds = [];
        renderLibrary();
        renderEditing();
      }
      if (!bootstrap.capabilities.ffmpeg || !bootstrap.capabilities.ffprobe) {
        setRuntimeStatus("视频引擎不可用", bootstrap.capabilities.ffmpegError || bootstrap.capabilities.ffprobeError || "未找到 FFmpeg", true);
      } else if (!batch) {
        setRuntimeStatus("桌面版已就绪", `FFmpeg 可用 · 素材盘 ${bootstrap.settings.materialRoot}`);
      }
    } catch (error) {
      showNativeError("桌面版初始化失败", error);
    }
  }

  if (desktop) {
    desktop.onProgress(updateNativeProgress);

    document.addEventListener("click", (event) => {
      const action = event.target.closest("#dropZone, #simpleUploadButton, #simpleEmptyUpload, #startAnalysisButton, #simpleStartAnalysis, #confirmSkuAnalysis, #refreshTaskBoard, #runScriptPrecheck, #planWithAiEditor, #replanWithAiEditor, #startConnectedMix, #addVoiceAsset, #addMusicAsset, #chooseMaterialRoot, #saveSettingsButton, #openLibraryFolder, #openCurrentBatch, #simpleOpenBatch, #deleteCurrentBatch, #simpleDeleteBatch, #addLibraryButton, #emptyAddMaterial, #testAiConnection, #clearAiKey, #toggleQwenKey, [data-open-model-settings], [data-open-task-dir], [data-remove-native-source], [data-remove-simple-source]");
      if (!action) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (action.matches("#dropZone, #simpleUploadButton, #simpleEmptyUpload")) chooseVideos().catch((error) => showNativeError("选择视频失败", error));
      else if (action.matches("#startAnalysisButton, #simpleStartAnalysis")) openSkuPickerDialog();
      else if (action.matches("#confirmSkuAnalysis")) confirmSkuAndStart();
      else if (action.matches("#refreshTaskBoard")) refreshTaskBoard();
      else if (action.matches("#runScriptPrecheck")) runNativePrecheck();
      else if (action.matches("#planWithAiEditor, #replanWithAiEditor")) runNativeEditingPlan();
      else if (action.matches("#startConnectedMix")) startNativeMix();
      else if (action.matches("#addVoiceAsset")) chooseAudio("voice");
      else if (action.matches("#addMusicAsset")) chooseAudio("music");
      else if (action.matches("#chooseMaterialRoot")) chooseMaterialRoot();
      else if (action.matches("#saveSettingsButton")) saveNativeSettings();
      else if (action.matches("#testAiConnection")) testNativeAiConnection();
      else if (action.matches("#clearAiKey")) clearNativeAiKey();
      else if (action.matches("#toggleQwenKey")) {
        const input = document.querySelector("#qwenApiKeyInput");
        input.type = input.type === "password" ? "text" : "password";
        action.textContent = input.type === "password" ? "显示" : "隐藏";
      }
      else if (action.matches("[data-open-model-settings]")) openModelSettings();
      else if (action.matches("#openLibraryFolder")) desktop.openPath(nativeState.settings.materialRoot).catch((error) => showNativeError("打开素材盘失败", error));
      else if (action.matches("[data-open-task-dir]")) desktop.openPath(action.dataset.openTaskDir).catch((error) => showNativeError("打开任务目录失败", error));
      else if (action.matches("#openCurrentBatch, #simpleOpenBatch")) openCurrentBatch().catch((error) => showNativeError("打开批次失败", error));
      else if (action.matches("#deleteCurrentBatch, #simpleDeleteBatch")) deleteCurrentBatch();
      else if (action.matches("#addLibraryButton, #emptyAddMaterial")) {
        navigate("import");
        showToast("外部视频需先进入原素材处理，确保规格统一且每段 ≥ 2 秒");
      } else if (action.matches("[data-remove-native-source]")) {
        const index = Number(action.dataset.removeNativeSource);
        const [removed] = nativeState.selectedSources.splice(index, 1);
        nativeState.sourceInfo = nativeState.sourceInfo.filter((item) => item.filePath !== removed);
        renderSelectedSources();
      } else if (action.matches("[data-remove-simple-source]")) {
        const index = Number(action.dataset.removeSimpleSource);
        const [removed] = nativeState.selectedSources.splice(index, 1);
        nativeState.sourceInfo = nativeState.sourceInfo.filter((item) => item.filePath !== removed);
        renderSelectedSources();
      }
    }, true);

    dropZone.addEventListener("drop", (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const paths = [...event.dataTransfer.files].map((file) => desktop.getPathForFile(file)).filter(Boolean);
      addSourcePaths(paths);
    }, true);

    const simpleUploadPanel = document.querySelector(".simple-upload-panel");
    simpleUploadPanel?.addEventListener("dragover", (event) => {
      event.preventDefault();
      simpleUploadPanel.classList.add("is-dragging");
    });
    simpleUploadPanel?.addEventListener("dragleave", () => simpleUploadPanel.classList.remove("is-dragging"));
    simpleUploadPanel?.addEventListener("drop", (event) => {
      event.preventDefault();
      simpleUploadPanel.classList.remove("is-dragging");
      const paths = [...event.dataTransfer.files].map((file) => desktop.getPathForFile(file)).filter(Boolean);
      addSourcePaths(paths);
    });

    skuInput.addEventListener("input", updateImportPathNative);
    batchNameInput.addEventListener("input", updateImportPathNative);
    document.querySelector("#simpleBatchNameInput")?.addEventListener("input", () => syncSimpleBatchFields());
    document.querySelector("#skuSearchInput")?.addEventListener("input", (event) => renderSkuOptions(event.target.value));
    document.querySelector("#newSkuInput")?.addEventListener("input", (event) => {
      if (event.target.value.trim()) nativeState.selectedSku = "";
      renderSkuOptions(document.querySelector("#skuSearchInput").value);
      updateSkuPathPreview();
    });
    document.querySelector("#skuBatchNameInput")?.addEventListener("input", updateSkuPathPreview);
    document.querySelector("#skuPickerDialog")?.addEventListener("close", () => {
      if (nativeState.pendingKind !== "process") setUploadStep(1);
    });
    document.addEventListener("change", scheduleProjectSave);
    document.addEventListener("input", scheduleProjectSave);
    document.addEventListener("click", scheduleProjectSave);
  }

  initializeDesktop();
})();
