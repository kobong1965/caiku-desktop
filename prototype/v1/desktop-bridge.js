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
    selectedSku: "",
    productProfiles: [],
    activeProductProfileSku: "",
    productProfileDraft: { referenceImages: [], allowedClaims: [], verificationRequired: [] }
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
    return "本次导入";
  }

  function currentSkuChoice() {
    return document.querySelector("#newSkuInput")?.value.trim() || nativeState.selectedSku || "";
  }

  function manifestLibraryDir(manifest = nativeState.activeManifest) {
    return manifest?.libraryDir || manifest?.batchDir || "";
  }

  function updateSkuPathPreview() {
    const sku = currentSkuChoice();
    const preview = document.querySelector("#skuPathPreview");
    if (preview) preview.textContent = sku ? `${nativeState.settings.materialRoot}\\${sku}` : "请选择款号";
    updateSkuProductProfileStatus();
  }

  function findProductProfile(sku) {
    const key = String(sku || "").trim().toLocaleLowerCase("zh-CN");
    return nativeState.productProfiles.find((profile) => String(profile.sku || "").toLocaleLowerCase("zh-CN") === key) || null;
  }

  function updateSkuProductProfileStatus() {
    const status = document.querySelector("#skuProductProfileStatus");
    if (!status) return;
    const sku = currentSkuChoice();
    const profile = findProductProfile(sku);
    status.classList.toggle("is-ready", Boolean(profile));
    const copy = status.querySelector("div");
    if (!sku) copy.innerHTML = "<strong>尚未选择款号</strong><small>选择后会检查目标商品资料卡</small>";
    else if (profile) copy.innerHTML = `<strong>${escapeHtml(profile.sku)} · ${escapeHtml(profile.name || "已建立商品资料")}</strong><small>${profile.referenceImages.length} 张参考图 · ${profile.allowedClaims.length} 个可用卖点</small>`;
    else copy.innerHTML = `<strong>${escapeHtml(sku)} 还没有商品资料卡</strong><small>可以继续分类，但成片进入可投放目录前必须补全</small>`;
  }

  function emptyProductProfile(sku = "") {
    return { sku, name: "", category: "", color: "", silhouette: "", fabric: "", audience: "", referenceImages: [], allowedClaims: [], verificationRequired: [] };
  }

  function renderProductProfileCollections() {
    const draft = nativeState.productProfileDraft;
    const references = document.querySelector("#productReferenceList");
    if (references) references.innerHTML = draft.referenceImages.length ? draft.referenceImages.map((image, index) => {
      const name = image.filePath.split(/[\\/]/).pop();
      return `<div class="profile-reference-item"><span>图</span><span><strong>${escapeHtml(image.label || name)}</strong><small title="${escapeHtml(image.filePath)}">${escapeHtml(name)}</small></span><button type="button" data-remove-product-reference="${index}" aria-label="删除参考图${escapeHtml(name)}">删除</button></div>`;
    }).join("") : '<div class="profile-collection-empty">暂未添加参考图</div>';

    const renderClaims = (selector, values, attribute) => {
      const target = document.querySelector(selector);
      if (!target) return;
      target.innerHTML = values.length ? values.map((value, index) => `<span class="profile-chip">${escapeHtml(value)}<button type="button" ${attribute}="${index}" aria-label="删除${escapeHtml(value)}">×</button></span>`).join("") : '<span class="profile-collection-empty">暂未添加</span>';
    };
    renderClaims("#allowedClaimList", draft.allowedClaims, "data-remove-allowed-claim");
    renderClaims("#verificationClaimList", draft.verificationRequired, "data-remove-verification-claim");
  }

  function renderProductProfileForm(profile = emptyProductProfile()) {
    const source = { ...emptyProductProfile(), ...profile };
    nativeState.activeProductProfileSku = findProductProfile(source.sku)?.sku || "";
    nativeState.productProfileDraft = {
      referenceImages: Array.isArray(source.referenceImages) ? source.referenceImages.map((item) => ({ ...item })) : [],
      allowedClaims: Array.isArray(source.allowedClaims) ? [...source.allowedClaims] : [],
      verificationRequired: Array.isArray(source.verificationRequired) ? [...source.verificationRequired] : []
    };
    const values = {
      productProfileSku: source.sku,
      productProfileName: source.name,
      productProfileCategory: source.category,
      productProfileColor: source.color,
      productProfileSilhouette: source.silhouette,
      productProfileFabric: source.fabric,
      productProfileAudience: source.audience
    };
    Object.entries(values).forEach(([id, value]) => {
      const input = document.querySelector(`#${id}`);
      if (input) input.value = value || "";
    });
    const skuInputElement = document.querySelector("#productProfileSku");
    if (skuInputElement) skuInputElement.readOnly = Boolean(nativeState.activeProductProfileSku);
    const title = document.querySelector("#productProfileEditorTitle");
    if (title) title.textContent = nativeState.activeProductProfileSku ? `${source.sku} · ${source.name || "未命名商品"}` : "新建商品资料卡";
    const deleteButton = document.querySelector("#deleteProductProfile");
    if (deleteButton) deleteButton.hidden = !nativeState.activeProductProfileSku;
    const saveState = document.querySelector("#productProfileSaveState");
    if (saveState) saveState.textContent = nativeState.activeProductProfileSku ? "修改后点击保存" : "填写款号后保存";
    renderProductProfileCollections();
    renderProductProfileList(document.querySelector("#productProfileSearch")?.value || "");
  }

  function renderProductProfileList(filter = "") {
    const list = document.querySelector("#productProfileList");
    if (!list) return;
    const needle = String(filter || "").trim().toLocaleLowerCase("zh-CN");
    const profiles = nativeState.productProfiles.filter((profile) => `${profile.sku} ${profile.name} ${profile.category}`.toLocaleLowerCase("zh-CN").includes(needle));
    list.innerHTML = profiles.length ? profiles.map((profile) => `<button class="product-profile-card ${nativeState.activeProductProfileSku === profile.sku ? "is-active" : ""}" type="button" data-product-profile-sku="${escapeHtml(profile.sku)}"><span><strong>${escapeHtml(profile.sku)} · ${escapeHtml(profile.name || "未命名商品")}</strong><small>${escapeHtml(profile.category || "未填写品类")} · ${profile.referenceImages.length} 张图</small></span><b>编辑</b></button>`).join("") : '<div class="product-profile-empty">没有匹配的商品资料卡。</div>';
  }

  function openProductProfileSettings(sku = "") {
    const picker = document.querySelector("#skuPickerDialog");
    if (picker?.open) picker.close();
    navigate("settings");
    document.querySelector('[data-settings-tab="product"]')?.click();
    renderProductProfileForm(findProductProfile(sku) || emptyProductProfile(sku));
    setTimeout(() => document.querySelector(sku ? "#productProfileName" : "#productProfileSku")?.focus(), 0);
  }

  function addUniqueProductClaim(kind) {
    const isAllowed = kind === "allowed";
    const input = document.querySelector(isAllowed ? "#allowedClaimInput" : "#verificationClaimInput");
    const key = isAllowed ? "allowedClaims" : "verificationRequired";
    const value = input?.value.trim() || "";
    if (!value) return;
    if (!nativeState.productProfileDraft[key].some((item) => item.toLocaleLowerCase("zh-CN") === value.toLocaleLowerCase("zh-CN"))) {
      nativeState.productProfileDraft[key].push(value);
    }
    input.value = "";
    renderProductProfileCollections();
  }

  async function addProductReferenceImages() {
    const paths = await desktop.selectProductImages();
    const existing = new Set(nativeState.productProfileDraft.referenceImages.map((item) => item.filePath.toLocaleLowerCase("zh-CN")));
    paths.forEach((filePath, index) => {
      const key = filePath.toLocaleLowerCase("zh-CN");
      if (existing.has(key)) return;
      existing.add(key);
      nativeState.productProfileDraft.referenceImages.push({ id: `reference-${Date.now()}-${index}`, filePath, label: filePath.split(/[\\/]/).pop() });
    });
    renderProductProfileCollections();
  }

  async function saveProductProfileFromForm() {
    const profile = {
      sku: document.querySelector("#productProfileSku").value,
      name: document.querySelector("#productProfileName").value,
      category: document.querySelector("#productProfileCategory").value,
      color: document.querySelector("#productProfileColor").value,
      silhouette: document.querySelector("#productProfileSilhouette").value,
      fabric: document.querySelector("#productProfileFabric").value,
      audience: document.querySelector("#productProfileAudience").value,
      ...nativeState.productProfileDraft
    };
    const saved = await desktop.saveProductProfile(profile);
    nativeState.productProfiles = await desktop.listProductProfiles();
    renderProductProfileForm(saved);
    updateSkuProductProfileStatus();
    showToast(`商品资料卡 ${saved.sku} 已保存`);
  }

  function deleteActiveProductProfile() {
    const sku = nativeState.activeProductProfileSku;
    if (!sku) return;
    askConfirm(`删除 ${sku} 的商品资料卡？`, "只删除商品身份、参考图索引和主张规则，不会删除素材盘中的视频和图片文件。", () => {
      desktop.deleteProductProfile(sku).then(() => desktop.listProductProfiles()).then((profiles) => {
        nativeState.productProfiles = profiles;
        renderProductProfileForm(emptyProductProfile());
        updateSkuProductProfileStatus();
        showToast(`${sku} 的商品资料卡已删除`);
      }).catch((error) => showNativeError("删除商品资料卡失败", error));
    });
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
    dialog.setAttribute("aria-labelledby", "nativeReportTitle");
    dialog.setAttribute("aria-describedby", "nativeReportMessage");
    dialog.innerHTML = '<button class="dialog-close" type="button" data-close-native-report aria-label="关闭">×</button><p class="eyebrow" id="nativeReportEyebrow">本地检查</p><h2 id="nativeReportTitle">检查结果</h2><p id="nativeReportMessage"></p><div class="native-report" id="nativeReportItems" role="status" aria-live="polite"></div><div class="dialog-actions"><button class="button secondary" type="button" data-close-native-report>知道了</button><button class="button primary" type="button" id="nativeReportAction" hidden>去处理</button></div>';
    document.body.append(dialog);
    dialog.addEventListener("click", (event) => {
      if (event.target.closest("[data-close-native-report]")) dialog.close();
    });
    return dialog;
  }

  function nativeIssuePosition(issue) {
    if (!issue?.blockName && !issue?.blockId) return "";
    const fieldLabels = { voiceText: "口播文字", subtitleText: "屏幕字幕", text: "文案", name: "段落名称" };
    return `${issue.blockName || issue.blockId}${issue.field ? ` · ${fieldLabels[issue.field] || issue.field}` : ""}`;
  }

  function showNativeReport(title, message, issues = [], eyebrow = "本地检查", options = {}) {
    const dialog = ensureNativeReportDialog();
    dialog.querySelector("#nativeReportEyebrow").textContent = eyebrow;
    dialog.querySelector("#nativeReportTitle").textContent = title;
    dialog.querySelector("#nativeReportMessage").textContent = message;
    dialog.querySelector("#nativeReportItems").innerHTML = issues.length
      ? issues.map((issue) => {
        const position = nativeIssuePosition(issue);
        return `<div class="native-report-item"><strong>${escapeHtml(issue.term ? `命中词：${issue.term}` : issue.name || issue.level || "需要复核")}</strong>${position ? `<small>位置：${escapeHtml(position)}</small>` : ""}${issue.excerpt ? `<small>原句：${escapeHtml(issue.excerpt)}</small>` : ""}<small>${escapeHtml(issue.message || issue.detail || issue.suggestion || "")}</small>${issue.suggestion ? `<small>建议：${escapeHtml(issue.suggestion)}</small>` : ""}</div>`;
      }).join("")
      : '<div class="native-report-item"><strong>没有发现待修改项</strong><small>仍需在正式投放前人工确认商品资质、价格、库存和平台实时规则。</small></div>';
    const action = dialog.querySelector("#nativeReportAction");
    action.hidden = !options.actionLabel;
    action.textContent = options.actionLabel || "去处理";
    action.onclick = options.onAction ? () => {
      dialog.close();
      options.onAction();
    } : null;
    if (!dialog.open) dialog.showModal();
    (action.hidden ? dialog.querySelector("[data-close-native-report]") : action)?.focus();
  }

  function isComplianceBlockedError(error) {
    const report = error?.details || error?.report;
    return error?.code === "COMPLIANCE_BLOCKED"
      || (report?.status === "blocked" && String(report?.ruleVersion || "").startsWith("CN-DOUYIN"))
      || /阻断级风险词|文案风险/.test(String(error?.message || ""));
  }

  function openComplianceIssueInScript(issue = {}) {
    appState.activeManagedScriptId = appState.editingScriptId;
    renderManagedScripts();
    renderScriptEditor();
    navigate("scripts");
    const field = issue.field === "subtitleText" ? "subtitle" : "voice";
    requestAnimationFrame(() => {
      const input = document.querySelector(`[data-block-${field}="${CSS.escape(String(issue.blockId || ""))}"]`);
      input?.scrollIntoView({ behavior: "smooth", block: "center" });
      input?.focus({ preventScroll: true });
    });
  }

  function showNativeError(title, error) {
    closeNativeProgress();
    const report = error?.details || error?.report || null;
    const issues = report?.issues || [{ name: error?.code || "错误", detail: error?.stderr || "请检查文件后重试" }];
    const complianceBlocked = isComplianceBlockedError(error);
    setRuntimeStatus("桌面服务需要处理", error.message, true);
    showNativeReport(
      complianceBlocked ? "候选生成未完成" : title,
      complianceBlocked ? "生成服务未能写出候选成片。下方风险文案可修改后重试；已有素材不受影响。" : error.message || "未知错误",
      issues,
      "任务未完成",
      complianceBlocked ? { actionLabel: "去修改脚本", onAction: () => openComplianceIssueInScript(issues[0]) } : {}
    );
    showToast(error.message || title, true);
  }

  function collectAiSettings() {
    return {
      aiClassification: {
        enabled: true,
        provider: "qwen",
        region: document.querySelector("#qwenRegionSelect")?.value || "china",
        model: document.querySelector("#qwenModelSelect")?.value || "qwen3.7-flash-2026-07-15",
        framesPerClip: Number(document.querySelector("#aiFramesSelect")?.value || 4),
        confidenceThreshold: Number(document.querySelector("#aiConfidenceSelect")?.value || 0.85),
        allowOfflineFallback: document.querySelector("#allowOfflineFallback")?.checked === true
      },
      aiRouting: {
        mode: document.querySelector("#aiExecutionModeSelect")?.value || "smart",
        classificationModel: document.querySelector("#qwenModelSelect")?.value || "qwen3.7-flash-2026-07-15",
        editorModel: document.querySelector("#qwenEditorModelSelect")?.value || "qwen3.7-plus-2026-05-26",
        reviewerModel: document.querySelector("#qwenReviewerModelSelect")?.value || "qwen3.8-max",
        localEndpoint: nativeState.settings?.aiRouting?.localEndpoint || "http://127.0.0.1:11434",
        localModel: document.querySelector("#localEditorModelInput")?.value.trim() || "qwen3.5:latest",
        allowLocalFallback: document.querySelector("#allowLocalModelFallback")?.checked !== false,
        allowPremiumEscalation: document.querySelector("#allowPremiumEscalation")?.checked !== false,
        reviewerThreshold: nativeState.settings?.aiRouting?.reviewerThreshold || 0.72
      }
    };
  }

  function renderAiRouteSummary(settings = null) {
    const routing = settings || collectAiSettings().aiRouting;
    const badge = document.querySelector("#aiEditorRouteBadge");
    const detail = document.querySelector("#aiEditorRouteDescription");
    const local = routing.mode === "local_private";
    const cloud = routing.mode === "cloud_accuracy";
    if (badge) badge.textContent = local ? `本地隐私 · ${routing.localModel || "Qwen3.5"}` : cloud ? "云端高精度 · Plus" : "智能混合 · Plus + 本地兜底";
    if (detail) detail.textContent = local
      ? "本地 Qwen 会逐段核对脚本与素材，素材不出机；证据不足时仍会给出诚实替代和改词建议。"
      : cloud
        ? "云端 Plus 负责逐段选镜，疑难计划可升级 Max；没有对应素材证据时不会硬配卖点。"
        : "云端 Plus 优先安排，失败时本地 Qwen 自动接手；没有拉伸、下蹲等证据时会提出诚实替代和改词建议。";
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
    const routing = nativeState.settings.aiRouting || {};
    card.classList.remove("is-missing", "is-error");
    const title = card.querySelector("strong");
    const detail = card.querySelector("small");
    if (routing.mode === "local_private") {
      title.textContent = `本地隐私分类 · ${routing.localModel || "qwen3.5:latest"}`;
      detail.textContent = "素材不出机；由本机 Ollama 读取抽帧，低置信度进入人工复核。";
    } else if (ai.hasApiKey) {
      title.textContent = `千问视觉分类已配置 · ${routing.classificationModel || ai.model || "qwen3.7-flash-2026-07-15"}`;
      detail.textContent = `每片段抽取 ${ai.framesPerClip || 4} 帧；低于 ${Math.round(Number(ai.confidenceThreshold || 0.85) * 100)}% 进入人工复核。`;
    } else if (routing.mode === "smart") {
      card.classList.add("is-missing");
      title.textContent = `未配置云端密钥 · 本地 ${routing.localModel || "qwen3.5:latest"} 接手`;
      detail.textContent = "仍可分类，但全部在本机执行；配置 API Key 后会自动使用云端主力模型。";
    } else if (ai.allowOfflineFallback) {
      card.classList.add("is-missing");
      title.textContent = "千问密钥未配置 · 将使用离线兜底";
      detail.textContent = "所有兜底分类都会强制标记待复核；建议先配置 API Key。";
    } else {
      card.classList.add("is-error");
      title.textContent = "云端高精度模式缺少 API Key · 暂不能开始分类";
      detail.textContent = "请保存千问 API Key，或把运行方式改为智能混合/本地隐私。";
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
      showToast(result.provider === "ollama" ? "本地 Qwen 连接成功" : "千问云端模型连接成功");
    } catch (error) {
      setAiConnectionStatus(error.message || "连接失败", "error");
      showToast(error.message || "AI 模型连接失败", true);
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
      const isLowReuse = material.lowReuse === true;
      const isBlocked = isLowReuse || material.captionStatus === "residual_blocked";
      const needsReview = isBlocked || material.captionStatus === "treated_needs_review" || material.classificationNeedsReview;
      const category = `${material.type}${needsReview ? " issue" : ""}`;
      const modeLabel = material.classificationMode === "qwen_vision"
        ? `云端 Qwen ${Math.round(Number(material.classificationConfidence || 0) * 100)}%`
        : material.classificationMode === "ollama_vision"
          ? `本地 Qwen ${Math.round(Number(material.classificationConfidence || 0) * 100)}%${material.classificationFallbackUsed ? " · 回退" : ""}`
          : "离线规则 · 待复核";
      return `
      <button class="clip-card" data-clip data-material-id="${escapeHtml(material.id)}" data-category="${escapeHtml(category)}" data-name="${escapeHtml(material.name)}" data-duration="${Number(material.duration).toFixed(2)}" data-time="${Number(material.sourceStart).toFixed(2)}s — ${Number(material.sourceEnd).toFixed(2)}s" data-source-image="${escapeHtml(material.image)}" data-video-url="${escapeHtml(material.videoUrl || "")}" data-audio-muted="${material.sourceAudioMuted === true ? "true" : "mix-guard"}">
        <span class="clip-image"><img src="${material.image}" alt="${escapeHtml(material.name)}"><span class="clip-audio-badge">静音</span><span class="clip-play-cue" aria-hidden="true">▶</span>${isLowReuse ? "<i>低复用</i>" : isBlocked ? "<i>字幕阻断</i>" : needsReview ? "<i>待复核</i>" : ""}<b>${Number(material.duration).toFixed(2)}s</b></span>
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
    } else window.clearClipEditorSelection?.();
    const counts = {
      all: materials.length,
      issue: materials.filter((item) => item.eligibleForMix === false || item.captionStatus === "residual_blocked" || item.captionStatus === "treated_needs_review" || item.classificationNeedsReview).length,
      outfit: materials.filter((item) => item.type === "outfit").length,
      overall: materials.filter((item) => item.type === "overall").length,
      detail: materials.filter((item) => item.type === "detail").length,
      review: materials.filter((item) => item.type === "review").length,
      action: materials.filter((item) => item.type === "action").length,
      speech: materials.filter((item) => item.type === "speech").length,
      upper_related: materials.filter((item) => item.type === "upper_related").length,
      other: materials.filter((item) => item.type === "other").length
    };
    Object.entries(counts).forEach(([type, count]) => {
      const badge = document.querySelector(`[data-filter="${type}"] span`);
      if (badge) badge.textContent = String(count);
    });
    setClipFilter("all");
  }

  function normalizeNativeMaterial(material, manifest) {
    return {
      ...material,
      duration: Number(material.duration),
      image: material.image || "assets/video1-detail.jpg",
      uses: Number(material.uses || 0),
      manifestPath: material.manifestPath || manifest.manifestPath,
      batchDir: material.batchDir || manifest.batchDir,
      libraryDir: material.libraryDir || manifest.libraryDir || manifest.batchDir
    };
  }

  function collectManifestMaterials(manifests) {
    const materialIndex = new Map();
    for (const manifest of manifests || []) {
      for (const material of manifest.materials || []) {
        const normalized = normalizeNativeMaterial(material, manifest);
        const key = String(normalized.filePath || `${normalized.manifestPath}:${normalized.id}`).toLowerCase();
        materialIndex.set(key, normalized);
      }
    }
    return [...materialIndex.values()];
  }

  function applyManifest(manifest) {
    nativeState.activeManifest = manifest;
    const realMaterials = (manifest.materials || []).map((material) => normalizeNativeMaterial(material, manifest));
    const reusableMaterials = realMaterials.filter((material) => !material.lowReuse);
    const lowReuseCount = Number(manifest.summary?.lowReuseCount ?? realMaterials.filter((material) => material.lowReuse).length);
    appState.materials = realMaterials;
    appState.editingMaterialIds = realMaterials.slice(0, Math.min(8, realMaterials.length)).map((material) => material.id);
    libraryFolder = "all";
    document.querySelectorAll("[data-folder]").forEach((item) => item.classList.toggle("is-active", item.dataset.folder === "all"));
    currentBatchLabel.textContent = manifest.sku;
    document.querySelector("#editingProjectTitle").textContent = `${manifest.sku} 混剪`;
    renderLibrary();
    renderEditing();
    applyManifestToClipEditor(manifest);
    document.querySelector("#summaryIssueCount").textContent = "0";
    document.querySelector("#summaryIssueText").textContent = "全部片段 ≥ 2 秒";
    document.querySelector(".batch-summary > div:first-child strong").textContent = String(manifest.summary?.materialCount ?? reusableMaterials.length);
    const stageLabels = document.querySelectorAll(".production-line .line-stage small");
    if (stageLabels[0]) stageLabels[0].textContent = `${manifest.sources?.length || 0} 个文件`;
    if (stageLabels[1]) stageLabels[1].textContent = `${reusableMaterials.length} 个可复用 · ${lowReuseCount} 个低复用`;
    const blockedCount = realMaterials.filter((item) => item.lowReuse || item.captionStatus === "residual_blocked").length;
    const issueCount = realMaterials.filter((item) => item.eligibleForMix === false || item.captionStatus === "residual_blocked" || item.captionStatus === "treated_needs_review" || item.classificationNeedsReview).length;
    document.querySelector("#summaryIssueCount").textContent = String(issueCount);
    document.querySelector("#summaryIssueText").textContent = lowReuseCount ? `${lowReuseCount} 个复杂图文或字幕风险片段已分流` : blockedCount ? `${blockedCount} 个片段因字幕风险不可混剪` : issueCount ? "商品身份或分类需要复核" : "全部检查通过";
    document.querySelector("#navIssueCount").textContent = String(issueCount);
    document.querySelector("#lineIssueLabel").textContent = `${issueCount} 个待复核`;
    document.querySelector("#filterIssueCount").textContent = String(issueCount);
    document.querySelector("#batch-panel-title").textContent = `${manifest.sku} · ${manifest.batchName || "本次导入"}`;
    const unusableBadge = document.querySelector('[data-folder="unusable"] b');
    if (unusableBadge) unusableBadge.textContent = String(manifest.summary?.unusableCount || 0);
    const fixedFolderButtons = [...document.querySelectorAll("[data-folder]")].filter((button) => !["all", "unusable"].includes(button.dataset.folder));
    if (fixedFolderButtons[0]) {
      fixedFolderButtons[0].dataset.folder = manifest.sku;
      const strong = fixedFolderButtons[0].querySelector("strong");
      const small = fixedFolderButtons[0].querySelector("small");
      const badge = fixedFolderButtons[0].querySelector("b");
      if (strong) strong.textContent = manifest.sku;
      if (small) {
        const categories = Object.entries(manifest.summary?.categories || {}).filter(([, count]) => Number(count) > 0).slice(0, 2);
        small.textContent = categories.map(([label, count]) => `${label} ${count}`).join(" · ") || "按内容分类";
      }
      if (badge) badge.textContent = String(reusableMaterials.length);
    }
    if (fixedFolderButtons[1]) fixedFolderButtons[1].hidden = true;
    document.querySelector("#nextActionTitle").textContent = `${reusableMaterials.length} 个可复用片段，${lowReuseCount} 个低复用待复核`;
    document.querySelector("#nextActionText").textContent = `已按内容分类到 ${manifestLibraryDir(manifest)}`;
    const simpleTitle = document.querySelector("#simple-result-title");
    const simplePath = document.querySelector("#simpleResultPath");
    const simpleStatus = document.querySelector("#simpleResultStatus");
    if (simpleTitle) simpleTitle.textContent = `${manifest.sku} · 分类完成`;
    if (simplePath) simplePath.textContent = `已保存到 ${manifestLibraryDir(manifest)}`;
    if (simpleStatus) {
      simpleStatus.className = `status-pill ${blockedCount ? "danger" : issueCount ? "processing" : "success"}`;
      simpleStatus.textContent = lowReuseCount ? "已完成安全分流" : blockedCount ? "字幕阻断" : issueCount ? "需要复核" : "处理完成";
    }
    document.querySelector("#simpleMaterialCount").textContent = String(reusableMaterials.length);
    document.querySelector("#simpleReviewCount").textContent = String(lowReuseCount || blockedCount);
    const shortest = reusableMaterials.length ? Math.min(...reusableMaterials.map((item) => Number(item.duration || 0))) : 2;
    document.querySelector("#simpleMinimumDuration").textContent = `${Math.max(2, shortest).toFixed(1)} 秒`;
    const aiCount = realMaterials.filter((material) => ["qwen_vision", "ollama_vision"].includes(material.classificationMode)).length;
    setRuntimeStatus(aiCount === realMaterials.length && realMaterials.length ? "AI 分类结果已连接" : "历史素材已连接", aiCount === realMaterials.length && realMaterials.length ? `${manifest.sku} · ${realMaterials.length} 个视觉模型分类片段 · 全部 ≥ 2 秒` : `${manifest.sku} · ${realMaterials.length} 个合格片段 · 历史分类未记录模型，建议重新上传分析`);
  }

  function mapNativeOutput(output) {
    const report = output.report || {};
    const status = ["ready_100", "repair_required", "blocked", "manual_review"].includes(report.status) ? report.status : "manual_review";
    const issues = [...(report.hardBlockers || []).map((item) => item.message), ...(report.reviewItems || []).map((item) => item.message)];
    const checks = Object.values(report.scoreBreakdown || {}).map((dimension) => ({
      name: `${dimension.label} · ${dimension.score}分`,
      passed: dimension.status === "pass" && Number(dimension.score) === 100,
      detail: dimension.reasons?.join("；") || "已通过硬门槛",
      status: dimension.status
    }));
    return {
      ...output,
      status,
      duration: formatDuration(output.duration),
      score: Number(report.totalScore ?? output.score ?? 0),
      issue: issues.length ? issues.slice(0, 3).join("；") : "画面、文案、音轨与输出规格检查通过，可进入发布前人工终审。",
      checks,
      repairActions: report.repairActions || []
    };
  }

  async function chooseVideos() {
    const paths = await desktop.selectVideos();
    await addSourcePaths(paths);
  }

  async function startNativeProcessing() {
    if (!skuInput.value.trim()) {
      showToast("请先在弹窗中选择款号", true);
      return;
    }
    if (!nativeState.selectedSources.length) {
      showToast("请先选择至少一个原视频", true);
      return;
    }
    const ai = nativeState.settings.aiClassification || {};
    const routing = nativeState.settings.aiRouting || {};
    if (routing.mode === "cloud_accuracy" && !ai.hasApiKey) {
      openModelSettings();
      setAiConnectionStatus("请先填写并测试千问 API Key", "error");
      showToast("云端高精度模式需要先配置千问 API Key", true);
      return;
    }
    nativeState.pendingKind = "process";
    showNativeProgress("正在检测、修复并按服装语义分类", routing.mode === "local_private" ? "本地 Qwen 正在看画面；普通字幕由本机修复，复杂图文自动分流…" : "千问判断画面；普通字幕由 GPU 修复，复杂图文进入低复用待复核…");
    try {
      const manifest = await desktop.processBatch({
        sku: skuInput.value.trim(),
        batchName: batchNameInput.value.trim() || "本次导入",
        rootDir: nativeState.settings.materialRoot,
        sourcePaths: nativeState.selectedSources,
        keepOriginals: document.querySelector("#keepOriginals").checked,
        minimumClipSeconds: 2,
        maximumClipSeconds: 6,
        sceneThreshold: 0.32,
        captionMode: nativeState.settings.captionMode || "smart_mask"
      });
      closeNativeProgress();
      applyManifest(manifest);
      const allManifests = await desktop.listBatches(nativeState.settings.materialRoot);
      appState.materials = collectManifestMaterials([...allManifests, manifest]);
      appState.editingMaterialIds = (manifest.materials || []).slice(0, Math.min(8, manifest.materials?.length || 0)).map((material) => material.id);
      renderLibrary();
      renderEditing();
      nativeState.selectedSources = [];
      nativeState.sourceInfo = [];
      renderSelectedSources();
      setUploadStep(1);
      await refreshTaskBoard({ silent: true });
      navigate("cleanup");
      showToast(`分析完成：${manifest.summary?.materialCount ?? manifest.materials.length} 个可复用，${manifest.summary?.lowReuseCount || 0} 个低复用待复核`);
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
      const report = await desktop.checkScript(script);
      status.className = `status-pill ${report.status === "pass" ? "success" : "processing"}`;
      status.textContent = report.status === "pass" ? "✓ 可生成候选" : `! ${report.issues.length} 项生成后处理`;
      showNativeReport(
        report.status === "pass" ? "文案预检通过" : "已记录生成后待修改项",
        `离线规则库 ${report.ruleVersion} · 得分 ${report.score}。预检结果不阻止候选生成，只影响投放状态。`,
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
    const routing = nativeState.settings?.aiRouting || {};
    const sku = String(nativeState.activeManifest?.sku || materials[0]?.sku || "").trim();
    const manifestPaths = [...new Set(appState.materials.filter((item) => !sku || item.sku === sku).map((item) => item.manifestPath).filter(Boolean))];
    const routeLabel = routing.mode === "local_private" ? `本地 ${routing.localModel || "Qwen3.5"}` : `${routing.editorModel || "Qwen3.7-Plus"} 主力`;
    showNativeProgress("剪辑智能体正在安排", `${routeLabel}正在读取 ${script.blocks.length} 个脚本段落、人工分类清单与 ${materials.length} 个本次勾选素材…`);
    try {
      const plan = await desktop.createEditingPlan({
        projectName: document.querySelector("#editingProjectTitle").textContent,
        script,
        materials,
        selectedMaterialIds: materials.map((item) => item.id),
        category: findProductProfile(sku)?.category || "服装带货",
        catalogRequest: { sku, manifestPaths, humanConfirmed: true }
      });
      closeNativeProgress();
      appState.editingPlan = { ...plan, confirmed: false };
      renderEditing();
      scheduleProjectSave();
      const missingCount = plan.decisions.filter((decision) => decision.evidenceStatus === "missing").length;
      const providerLabel = plan.provider === "qwen" ? "云端千问" : "本地 Qwen";
      setRuntimeStatus(`${providerLabel}剪辑师已完成安排`, missingCount ? `${missingCount} 个段落缺少直接画面证据，请检查改词建议` : `${plan.decisions.length} 个段落均已生成可执行时间线`);
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
    if (!appState.editingPlan || appState.editingPlan.confirmed !== true || window.caikuEditingPlanIsStale?.()) {
      showToast("请先确认当前剪辑方案", true);
      return;
    }
    let complianceReport = null;
    try {
      complianceReport = await desktop.checkScript(script);
      const status = document.querySelector("#scriptPrecheckStatus");
      if (status) {
        status.className = `status-pill ${complianceReport.status === "pass" ? "success" : "processing"}`;
        status.textContent = complianceReport.status === "pass" ? "✓ 可生成候选" : `! ${complianceReport.issues.length} 项生成后处理`;
      }
      if (complianceReport.status === "blocked") {
        setRuntimeStatus("将先生成候选成片", `已记录 ${complianceReport.issues.length} 项文案风险，生成后按报告修改。`);
        showToast(`已记录 ${complianceReport.issues.length} 项文案风险，仍会先生成候选`);
      }
    } catch (error) {
      showNativeError("文案检查失败", error);
      return;
    }
    const musicOnly = script.voiceMode === "music_only";
    const musicFile = appState.music.find((item) => item?.filePath);
    if (!musicOnly && !appState.voices.length && appState.voicePreviewApproved !== true) {
      showToast("尚未试听 AI 配音，将先生成候选并在结果中标为待听感复核");
    }
    if (musicOnly && !musicFile) {
      showToast("尚未添加音乐，将先生成静音候选，结果标为待补音乐");
    }
    nativeState.pendingKind = "mix";
    showNativeProgress("正在生成候选成片并逐条检查", `先生成 ${appState.outputCount} 条 1080×1920 候选成片，风险项将写入质检报告…`);
    try {
      const result = await desktop.mixBatch({
        batchDir: nativeState.activeManifest.batchDir,
        projectName: document.querySelector("#editingProjectTitle").textContent,
        materials,
        script,
        voicePath: musicOnly ? null : appState.voices[0]?.filePath || null,
        aiVoicePreset: appState.selectedAiVoice || "真人短种草",
        voicePreviewApproved: musicOnly || appState.voices.length ? false : appState.voicePreviewApproved === true,
        musicPath: musicFile?.filePath || null,
        voiceMode: script.voiceMode || "full_voice",
        useOfflineVoice: !musicOnly && !appState.voices.length,
        outputCount: appState.outputCount,
        allowComplianceOverride: true,
        qualityMode: true,
        requireEditingPlan: true,
        editingPlan: appState.editingPlan
      });
      closeNativeProgress();
      appState.outputs = result.outputs.map(mapNativeOutput);
      appState.mixOutputDir = result.outputDir;
      appState.productionStep = 5;
      renderEditing();
      const readyCount = appState.outputs.filter((item) => item.status === "ready_100").length;
      const revisionCount = appState.outputs.length - readyCount;
      setRuntimeStatus("候选成片任务已完成", `生成 ${appState.outputs.length} 条 · 可投放 ${readyCount} 条 · 待修改 ${revisionCount} 条`);
      showToast(`已生成 ${appState.outputs.length} 条候选成片；${readyCount} 条可投放，${revisionCount} 条待修改`);
      window.showMixCompleteDialog?.(result.outputDir, readyCount, appState.outputs.length - readyCount);
      scheduleProjectSave();
    } catch (error) {
      showNativeError("候选成片生成失败", error);
    }
  }

  async function previewNativeVoice(button) {
    const script = appState.scripts.find((item) => item.id === appState.editingScriptId);
    const text = (script?.blocks || [])
      .filter((block) => script?.voiceMode === "full_voice" || block.voiceEnabled !== false)
      .map((block) => block.voiceText || block.text || "")
      .filter(Boolean)
      .join("。")
      .slice(0, 180);
    appState.selectedAiVoice = button.dataset.aiVoice;
    appState.voicePreviewApproved = false;
    document.querySelectorAll("[data-ai-voice]").forEach((item) => item.classList.toggle("is-selected", item === button));
    renderEditing();
    button.disabled = true;
    button.classList.add("is-loading");
    try {
      const preview = await desktop.previewVoice({ presetName: button.dataset.aiVoice, text, duration: Number(script?.duration || 0) });
      const audio = new Audio(preview.fileUrl);
      await audio.play();
      appState.voicePreviewApproved = true;
      renderEditing();
      showToast(`正在试听 ${button.dataset.aiVoice}；本次试听已记录`);
    } catch (error) {
      appState.voicePreviewApproved = false;
      showNativeError("自然配音试听失败", error);
    } finally {
      button.disabled = false;
      button.classList.remove("is-loading");
    }
  }

  async function openCurrentBatch() {
    const libraryDir = manifestLibraryDir();
    if (!libraryDir) {
      showToast("当前还没有已连接的款号素材", true);
      return;
    }
    await desktop.openPath(libraryDir);
  }

  function deleteCurrentBatch() {
    const manifest = nativeState.activeManifest;
    if (!manifest?.manifestPath) {
      showToast("当前还没有可删除的导入记录", true);
      return;
    }
    askConfirm(
      `删除本次导入“${manifest.sku} · ${manifest.batchName || "本次导入"}”？`,
      "只会精确移除本次生成的分类片段、归档副本和任务记录；不会删除同款号的其他素材，也不会删除原上传文件。",
      async () => {
        try {
          const removedIds = new Set((manifest.materials || []).map((material) => material.id));
          await desktop.trashBatch(manifest.manifestPath);
          appState.materials = appState.materials.filter((material) => !removedIds.has(material.id));
          appState.editingMaterialIds = appState.editingMaterialIds.filter((id) => !removedIds.has(id));
          const remaining = await desktop.listBatches(nativeState.settings.materialRoot);
          if (remaining[0]?.manifestPath) {
            const nextManifest = await desktop.loadManifest(remaining[0].manifestPath);
            nextManifest.manifestPath = remaining[0].manifestPath;
            applyManifest(nextManifest);
            appState.materials = collectManifestMaterials(remaining);
            renderLibrary();
            renderEditing();
          } else {
            nativeState.activeManifest = null;
            appState.materials = [];
            appState.editingMaterialIds = [];
            applyManifestToClipEditor({ materials: [] });
            renderLibrary();
            renderEditing();
            resetSimpleResult();
            navigate("import");
          }
          currentBatchLabel.textContent = nativeState.activeManifest?.sku || "请选择款号";
          setRuntimeStatus("本次导入已移入回收站", "同款号的其他内容分类素材保持不变");
          showToast("本次导入的文件和任务记录已移入系统回收站");
          scheduleProjectSave();
        } catch (error) {
          showNativeError("删除本次导入失败", error);
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
    importPathPreview.textContent = `${nativeState.settings.materialRoot}\\${skuInput.value || "未填写款号"}`;
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
      const savedRouting = nativeState.settings.aiRouting || {};
      setAiConnectionStatus(savedRouting.mode === "local_private" ? "本地隐私模式已启用" : nativeState.settings.aiClassification?.hasApiKey ? "密钥已安全保存" : "智能混合将使用本地模型");
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
      nativeState.productProfiles = Array.isArray(bootstrap.productProfiles) ? bootstrap.productProfiles : [];
      renderProductProfileForm(nativeState.productProfiles[0] || emptyProductProfile());
      document.querySelector("#desktopVersionLabel").textContent = `v${bootstrap.app.version} · 本地素材工作台`;
      window.renderUpdateStatus?.({ ...(bootstrap.update || {}), currentVersion: bootstrap.app.version });
      applyWindowState(bootstrap.window || {});
      window.renderTaskBoard?.(bootstrap.taskBoard || {});
      document.querySelector("#materialRootInput").value = bootstrap.settings.materialRoot;
      document.querySelector("#captionModeSelect").value = bootstrap.settings.captionMode || "smart_mask";
      document.querySelector("#keepOriginals").checked = bootstrap.settings.keepOriginals !== false;
      const ai = bootstrap.settings.aiClassification || {};
      const routing = bootstrap.settings.aiRouting || {};
      document.querySelector("#qwenRegionSelect").value = ai.region || "china";
      document.querySelector("#aiExecutionModeSelect").value = routing.mode || "smart";
      document.querySelector("#qwenModelSelect").value = routing.classificationModel || ai.model || "qwen3.7-flash-2026-07-15";
      document.querySelector("#qwenEditorModelSelect").value = routing.editorModel || "qwen3.7-plus-2026-05-26";
      document.querySelector("#qwenReviewerModelSelect").value = routing.reviewerModel || "qwen3.8-max";
      document.querySelector("#localEditorModelInput").value = routing.localModel || "qwen3.5:latest";
      document.querySelector("#allowLocalModelFallback").checked = routing.allowLocalFallback !== false;
      document.querySelector("#allowPremiumEscalation").checked = routing.allowPremiumEscalation !== false;
      renderAiRouteSummary(routing);
      document.querySelector("#aiFramesSelect").value = String(ai.framesPerClip || 4);
      document.querySelector("#aiConfidenceSelect").value = String(ai.confidenceThreshold || 0.85);
      document.querySelector("#allowOfflineFallback").checked = ai.allowOfflineFallback === true;
      setAiConnectionStatus(routing.mode === "local_private" ? "本地隐私模式 · 可测试 Ollama" : ai.hasApiKey ? "已安全保存密钥，可测试连接" : "未配置千问 API Key · 智能混合将使用本地模型", routing.mode === "local_private" || ai.hasApiKey ? "success" : "");
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
            materialIndex.set(material.id, { ...material, duration: Number(material.duration), image: material.image || "assets/video1-detail.jpg", uses: Number(material.uses || 0), manifestPath: material.manifestPath || diskBatch.manifestPath, batchDir: material.batchDir || diskBatch.batchDir, libraryDir: material.libraryDir || diskBatch.libraryDir || diskBatch.batchDir });
          }
        }
        for (const material of batch.materials || []) {
          materialIndex.set(material.id, { ...material, duration: Number(material.duration), image: material.image || "assets/video1-detail.jpg", uses: Number(material.uses || 0), manifestPath: material.manifestPath || batch.manifestPath, batchDir: material.batchDir || batch.batchDir, libraryDir: material.libraryDir || batch.libraryDir || batch.batchDir });
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
      const action = event.target.closest("#dropZone, #simpleUploadButton, #simpleEmptyUpload, #startAnalysisButton, #simpleStartAnalysis, #confirmSkuAnalysis, #refreshTaskBoard, #runScriptPrecheck, #planWithAiEditor, #replanWithAiEditor, #startConnectedMix, #addVoiceAsset, #addMusicAsset, #chooseMaterialRoot, #saveSettingsButton, #openLibraryFolder, #openCurrentBatch, #simpleOpenBatch, #deleteCurrentBatch, #simpleDeleteBatch, #addLibraryButton, #emptyAddMaterial, #testAiConnection, #clearAiKey, #toggleQwenKey, #newProductProfile, #addProductReferences, #addAllowedClaim, #addVerificationClaim, #saveProductProfile, #deleteProductProfile, #editSkuProductProfile, [data-ai-voice], [data-product-profile-sku], [data-remove-product-reference], [data-remove-allowed-claim], [data-remove-verification-claim], [data-open-model-settings], [data-open-task-dir], [data-remove-native-source], [data-remove-simple-source]");
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
      else if (action.matches("[data-ai-voice]")) previewNativeVoice(action);
      else if (action.matches("#addVoiceAsset")) chooseAudio("voice");
      else if (action.matches("#addMusicAsset")) chooseAudio("music");
      else if (action.matches("#chooseMaterialRoot")) chooseMaterialRoot();
      else if (action.matches("#saveSettingsButton")) saveNativeSettings();
      else if (action.matches("#testAiConnection")) testNativeAiConnection();
      else if (action.matches("#clearAiKey")) clearNativeAiKey();
      else if (action.matches("#newProductProfile")) renderProductProfileForm(emptyProductProfile());
      else if (action.matches("#editSkuProductProfile")) openProductProfileSettings(currentSkuChoice());
      else if (action.matches("[data-product-profile-sku]")) renderProductProfileForm(findProductProfile(action.dataset.productProfileSku));
      else if (action.matches("#addProductReferences")) addProductReferenceImages().catch((error) => showNativeError("添加商品参考图失败", error));
      else if (action.matches("#addAllowedClaim")) addUniqueProductClaim("allowed");
      else if (action.matches("#addVerificationClaim")) addUniqueProductClaim("verification");
      else if (action.matches("#saveProductProfile")) saveProductProfileFromForm().catch((error) => showNativeError("保存商品资料卡失败", error));
      else if (action.matches("#deleteProductProfile")) deleteActiveProductProfile();
      else if (action.matches("[data-remove-product-reference]")) {
        nativeState.productProfileDraft.referenceImages.splice(Number(action.dataset.removeProductReference), 1);
        renderProductProfileCollections();
      } else if (action.matches("[data-remove-allowed-claim]")) {
        nativeState.productProfileDraft.allowedClaims.splice(Number(action.dataset.removeAllowedClaim), 1);
        renderProductProfileCollections();
      } else if (action.matches("[data-remove-verification-claim]")) {
        nativeState.productProfileDraft.verificationRequired.splice(Number(action.dataset.removeVerificationClaim), 1);
        renderProductProfileCollections();
      }
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

    document.addEventListener("change", (event) => {
      if (event.target.matches("#aiExecutionModeSelect, #qwenEditorModelSelect, #localEditorModelInput, #allowLocalModelFallback, #allowPremiumEscalation")) {
        renderAiRouteSummary();
        updateBatchModelStatus();
      }
    });

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
    document.querySelector("#productProfileSearch")?.addEventListener("input", (event) => renderProductProfileList(event.target.value));
    document.querySelector("#allowedClaimInput")?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); addUniqueProductClaim("allowed"); }
    });
    document.querySelector("#verificationClaimInput")?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); addUniqueProductClaim("verification"); }
    });
    document.addEventListener("change", scheduleProjectSave);
    document.addEventListener("input", scheduleProjectSave);
    document.addEventListener("click", scheduleProjectSave);
  }

  initializeDesktop();
})();
