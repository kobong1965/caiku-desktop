const routeMeta = {
  source: ["", "素材分类"],
  tasks: ["", "任务"],
  import: ["素材分类", "上传并分析"],
  cleanup: ["素材分类", "分析分类结果"],
  subtitle: ["素材分类", "分类与字幕复核"],
  library: ["", "素材管理"],
  scripts: ["", "脚本管理"],
  editing: ["", "素材混剪"],
  mix: ["", "素材混剪"],
  export: ["素材混剪", "混剪成片导出"],
  settings: ["本地软件设置", "设置"]
};

const routeGroup = {
  source: "source", import: "source", cleanup: "source", subtitle: "source",
  tasks: "tasks",
  library: "library",
  editing: "editing", mix: "editing", export: "editing",
  scripts: "scripts",
  settings: "settings"
};

const pageTitle = document.querySelector("#pageTitle");
const pageEyebrow = document.querySelector("#pageEyebrow");
const mainContent = document.querySelector("#mainContent");
const batchMenu = document.querySelector("#batchMenu");
const batchSwitcher = document.querySelector("#batchSwitcher");
const currentBatchLabel = document.querySelector("#currentBatchLabel");
const toast = document.querySelector("#toast");
const contextAddButton = document.querySelector("#contextAddButton");
const contextAddLabel = document.querySelector("#contextAddLabel");
let toastTimer;
let activeClip = document.querySelector("[data-clip].is-selected");
let issueCount = 2;
let pendingConfirmAction = null;
let currentRoute = "source";

function applyWindowState({ isMaximized = false } = {}) {
  document.body.classList.toggle("is-window-maximized", isMaximized);
  const button = document.querySelector("#maximizeWindowButton");
  if (!button) return;
  button.textContent = isMaximized ? "❐" : "□";
  button.setAttribute("aria-label", isMaximized ? "还原窗口" : "最大化窗口");
}

document.querySelectorAll("[data-window-action]").forEach((button) => {
  button.addEventListener("click", async () => {
    if (!window.caiku) return;
    if (button.dataset.windowAction === "minimize") await window.caiku.minimizeWindow();
    if (button.dataset.windowAction === "maximize") applyWindowState({ isMaximized: await window.caiku.toggleMaximizeWindow() });
    if (button.dataset.windowAction === "close") await window.caiku.closeWindow();
  });
});
document.querySelector("#windowTitlebar")?.addEventListener("dblclick", async (event) => {
  if (!window.caiku || event.target.closest(".window-controls")) return;
  applyWindowState({ isMaximized: await window.caiku.toggleMaximizeWindow() });
});
window.caiku?.onWindowState?.(applyWindowState);

function showToast(message, isError = false) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.toggle("is-error", isError);
  toast.classList.add("is-visible");
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2600);
}

function showMixCompleteDialog(outputDir, successCount, failedCount = 0) {
  appState.mixOutputDir = outputDir || appState.mixOutputDir || "";
  document.querySelector("#mixCompleteTitle").textContent = failedCount ? "混剪已完成，部分任务需要检查" : "成片与质检报告已经保存";
  document.querySelector("#mixCompleteSummary").textContent = `成功 ${successCount} 条${failedCount ? `，失败 ${failedCount} 条` : ""}；可以打开文件夹或先查看逐条质检结果。`;
  document.querySelector("#mixCompleteFolder").value = appState.mixOutputDir || "输出目录等待桌面任务返回";
  const dialog = document.querySelector("#mixCompleteDialog");
  if (!dialog.open) dialog.showModal();
}
window.showMixCompleteDialog = showMixCompleteDialog;

function navigate(route) {
  if (route === "mix") route = "editing";
  const target = document.querySelector(`[data-screen="${route}"]`);
  if (!target) return;
  document.querySelectorAll(".screen").forEach((screen) => screen.classList.toggle("is-active", screen === target));
  const group = routeGroup[route];
  document.querySelectorAll(".nav-step").forEach((button) => {
    const isCurrent = button.dataset.navGroup === group;
    button.classList.toggle("is-active", isCurrent);
    if (isCurrent) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  document.querySelectorAll(".module-tabs [data-route]").forEach((button) => button.classList.toggle("is-active", button.dataset.route === route));
  const [eyebrow, title] = routeMeta[route];
  pageEyebrow.textContent = eyebrow;
  pageTitle.textContent = title;
  currentRoute = route;
  const addLabels = { source: "添加视频", tasks: "上传新批次", library: "添加外部素材", scripts: "新建脚本", editing: "从素材库选材", settings: "返回素材分类" };
  contextAddLabel.textContent = addLabels[group] || "添加";
  batchMenu.hidden = true;
  batchSwitcher.setAttribute("aria-expanded", "false");
  window.scrollTo({ top: 0, behavior: "smooth" });
  mainContent.focus({ preventScroll: true });
}

contextAddButton.addEventListener("click", () => {
  const group = routeGroup[currentRoute];
  if (group === "source") document.querySelector("#simpleUploadButton")?.click();
  else if (group === "library") document.querySelector("#libraryFileInput").click();
  else if (group === "editing") openMaterialPicker();
  else if (group === "scripts") document.querySelector("#newScriptDialog").showModal();
  else navigate("source");
});

document.querySelectorAll("[data-route]").forEach((button) => {
  button.addEventListener("click", () => {
    navigate(button.dataset.route);
    if (button.dataset.filterTarget) setClipFilter(button.dataset.filterTarget);
  });
});

document.querySelectorAll("[data-toast]").forEach((button) => {
  button.addEventListener("click", () => showToast(button.dataset.toast));
});

batchSwitcher.addEventListener("click", () => {
  batchMenu.hidden = !batchMenu.hidden;
  batchSwitcher.setAttribute("aria-expanded", String(!batchMenu.hidden));
});

document.querySelectorAll("[data-batch]").forEach((button) => {
  button.addEventListener("click", () => {
    currentBatchLabel.textContent = button.dataset.batch;
    batchMenu.hidden = true;
    batchSwitcher.setAttribute("aria-expanded", "false");
    showToast(`已切换到 ${button.dataset.batch}`);
  });
});

document.addEventListener("click", (event) => {
  if (!event.target.closest(".batch-switcher-wrap")) {
    batchMenu.hidden = true;
    batchSwitcher.setAttribute("aria-expanded", "false");
  }
});

document.querySelectorAll("[data-source]").forEach((button) => {
  button.addEventListener("click", () => {
    const card = button.closest(".source-card");
    document.querySelectorAll(".source-card").forEach((item) => item.classList.remove("is-selected"));
    card.classList.add("is-selected");
    showToast(`已选择${card.querySelector("strong").textContent}`);
  });
});

document.querySelectorAll("[data-delete-source]").forEach((button) => {
  button.addEventListener("click", () => {
    const card = button.closest(".source-card");
    const name = card.querySelector("strong").textContent;
    askConfirm(`删除${name}？`, "只会从当前批次移除，磁盘中的原视频不会被删除。", () => {
      card.remove();
      showToast(`${name}已从批次移除`);
    });
  });
});

document.querySelectorAll("[data-batch-row]").forEach((row) => {
  row.addEventListener("click", () => {
    document.querySelectorAll("[data-batch-row]").forEach((item) => item.classList.remove("is-selected"));
    row.classList.add("is-selected");
    currentBatchLabel.textContent = row.dataset.batchRow;
    showToast(`已打开 ${row.dataset.batchRow}`);
  });
});

function updateIssueCount(nextCount) {
  issueCount = Math.max(0, nextCount);
  document.querySelectorAll("#navIssueCount, #filterIssueCount, #summaryIssueCount").forEach((node) => node.textContent = issueCount);
  document.querySelector("#navIssueCount").hidden = issueCount === 0;
  document.querySelector("#summaryIssueText").textContent = issueCount ? "可自动合并" : "全部符合规则";
  document.querySelector("#lineIssueLabel").textContent = issueCount ? `${issueCount} 个待处理` : "已通过";
}

document.querySelector("#autoFixButton").addEventListener("click", (event) => {
  if (issueCount === 0) {
    navigate("cleanup");
    return;
  }
  document.querySelectorAll("[data-clip]").forEach((clip) => {
    clip.dataset.category = clip.dataset.category.replace("issue", "").trim();
    const issueBadge = clip.querySelector(".clip-image i");
    if (issueBadge) issueBadge.remove();
  });
  updateIssueCount(0);
  const nextAction = document.querySelector("#nextAction");
  nextAction.classList.add("is-resolved");
  nextAction.querySelector(".status-icon").textContent = "✓";
  document.querySelector("#nextActionTitle").textContent = "所有片段已经通过 2 秒检查";
  document.querySelector("#nextActionText").textContent = "下一步可以检查分类，然后开始清除原字幕。";
  event.currentTarget.textContent = "进入分类校对";
  showToast("已合并 2 个短片段，没有低于 2 秒的素材");
});

// Import interactions
const skuInput = document.querySelector("#skuInput");
const batchNameInput = document.querySelector("#batchNameInput");
const importPathPreview = document.querySelector("#importPathPreview");
const dropZone = document.querySelector("#dropZone");
const fileInput = document.querySelector("#fileInput");
const fileList = document.querySelector("#fileList");

function updateImportPath() {
  importPathPreview.textContent = `D:\\抖音素材库\\${skuInput.value || "未填写款号"}\\${batchNameInput.value || "未填写批次"}`;
}
skuInput.addEventListener("input", updateImportPath);
batchNameInput.addEventListener("input", updateImportPath);
dropZone.addEventListener("click", () => fileInput.click());
dropZone.addEventListener("dragover", (event) => { event.preventDefault(); dropZone.classList.add("is-dragging"); });
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("is-dragging"));
dropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropZone.classList.remove("is-dragging");
  addFiles([...event.dataTransfer.files]);
});
fileInput.addEventListener("change", () => addFiles([...fileInput.files]));

function addFiles(files) {
  const videoFiles = files.filter((file) => file.type.startsWith("video/") || /\.(mp4|mov|mkv)$/i.test(file.name));
  if (!videoFiles.length) {
    showToast("请选择 MP4、MOV 或 MKV 视频文件", true);
    return;
  }
  videoFiles.forEach((file) => {
    const row = document.createElement("div");
    row.className = "file-item";
    row.innerHTML = `<span class="file-preview"><span class="generated-thumb">视频</span></span><span><strong></strong><small></small></span><button aria-label="移除视频">×</button>`;
    row.querySelector("strong").textContent = file.name;
    row.querySelector("small").textContent = `${(file.size / 1024 / 1024).toFixed(1)} MB · 等待读取信息`;
    row.querySelector("button").addEventListener("click", () => row.remove());
    fileList.append(row);
  });
  showToast(`已添加 ${videoFiles.length} 个视频`);
}

function wireRemoveButtons() {
  document.querySelectorAll("[data-remove-file]").forEach((button) => {
    button.addEventListener("click", () => {
      button.closest(".file-item").remove();
      showToast("已从本批次移除视频");
    });
  });
}
wireRemoveButtons();

function runProgress(title, text, onDone) {
  const dialog = document.querySelector("#progressDialog");
  const progressBar = document.querySelector("#dialogProgressBar");
  const progressValue = document.querySelector("#dialogProgressValue");
  document.querySelector("#progressTitle").textContent = title;
  document.querySelector("#progressText").textContent = text;
  progressBar.style.width = "0%";
  progressValue.textContent = "0%";
  dialog.showModal();
  let value = 0;
  const timer = setInterval(() => {
    value = Math.min(100, value + 8 + Math.round(Math.random() * 13));
    progressBar.style.width = `${value}%`;
    progressValue.textContent = `${value}%`;
    if (value >= 100) {
      clearInterval(timer);
      setTimeout(() => {
        dialog.close();
        onDone?.();
      }, 300);
    }
  }, 150);
}

document.querySelector("#startAnalysisButton").addEventListener("click", () => {
  if (!skuInput.value.trim() || !batchNameInput.value.trim()) {
    showToast("请先填写款号和批次名称", true);
    (!skuInput.value.trim() ? skuInput : batchNameInput).focus();
    return;
  }
  if (!fileList.querySelector(".file-item")) {
    showToast("至少需要添加一个原视频", true);
    dropZone.focus();
    return;
  }
  runProgress("正在建立素材批次", "读取视频信息并创建本地目录…", () => {
    currentBatchLabel.textContent = `${skuInput.value} · ${batchNameInput.value}`;
    addProcessedBatchToLibrary?.();
    navigate("source");
    showToast("批次已建立，视频分析已加入队列");
  });
});

// Clip filtering and editing
function setClipFilter(filter) {
  document.querySelectorAll("[data-filter]").forEach((button) => button.classList.toggle("is-active", button.dataset.filter === filter));
  document.querySelectorAll("[data-clip]").forEach((clip) => {
    clip.hidden = filter !== "all" && !clip.dataset.category.split(" ").includes(filter);
  });
}
document.querySelectorAll("[data-filter]").forEach((button) => button.addEventListener("click", () => setClipFilter(button.dataset.filter)));

function setMutedPreview(video, image, videoUrl, poster, play = false) {
  video.pause();
  video.muted = true;
  video.volume = 0;
  if (!videoUrl) {
    video.removeAttribute("src");
    video.load();
    video.hidden = true;
    image.hidden = false;
    image.src = poster;
    return;
  }
  image.hidden = true;
  video.hidden = false;
  video.poster = poster || "";
  if (video.src !== videoUrl) {
    video.src = videoUrl;
    video.load();
  }
  if (play) video.play().catch(() => {});
}

function selectClip(clip, options = {}) {
  document.querySelectorAll("[data-clip]").forEach((item) => item.classList.remove("is-selected"));
  clip.classList.add("is-selected");
  activeClip = clip;
  document.querySelector("#clipInspectorTitle").textContent = clip.dataset.name;
  document.querySelector("#clipNameInput").value = clip.dataset.name;
  document.querySelector("#clipTime").textContent = clip.dataset.time;
  document.querySelector("#durationValue").textContent = `${Number(clip.dataset.duration).toFixed(2)} 秒`;
  const preview = document.querySelector("#inspectorPreview");
  const videoUrl = clip.dataset.videoUrl || "";
  preview.classList.toggle("has-video", Boolean(videoUrl));
  setMutedPreview(document.querySelector("#inspectorVideo"), document.querySelector("#inspectorPreviewImage"), videoUrl, clip.dataset.sourceImage, options.play === true);
  document.querySelector("#clipAudioState").textContent = clip.dataset.audioMuted === "true"
    ? "分类素材已静音 · 混剪仅使用配音与音乐"
    : "预览已静音 · 混剪会强制关闭素材原声";
  const categoryMap = { outfit: "人物穿搭", overall: "整体展示", detail: "细节讲解", review: "测评对比", action: "动作展示", speech: "口播", other: "其他" };
  const type = clip.dataset.category.split(" ").find((name) => categoryMap[name]);
  document.querySelector("#categorySelect").value = categoryMap[type] || "其他";
  const isValid = Number(clip.dataset.duration) >= 2;
  const state = document.querySelector("#durationState");
  state.textContent = isValid ? "✓ 符合规则" : "! 不能短于 2 秒";
  state.classList.toggle("invalid", !isValid);
}
document.querySelectorAll("[data-clip]").forEach((clip) => clip.addEventListener("click", () => selectClip(clip, { play: true })));

document.querySelector("#selectIssuesButton").addEventListener("click", () => {
  setClipFilter("issue");
  const firstIssue = [...document.querySelectorAll("[data-clip]")].find((clip) => !clip.hidden);
  if (firstIssue) selectClip(firstIssue);
  else showToast("当前没有待处理片段");
});
document.querySelector("#saveClassificationButton").addEventListener("click", () => showToast("分类结果已保存到批次清单"));

document.querySelector("#saveClipButton").addEventListener("click", () => {
  if (!activeClip) return;
  const newName = document.querySelector("#clipNameInput").value.trim();
  if (!newName) {
    showToast("片段名称不能为空", true);
    return;
  }
  const categoryValue = document.querySelector("#categorySelect").value;
  const categoryType = { 人物穿搭: "outfit", 整体展示: "overall", 细节讲解: "detail", 测评对比: "review", 动作展示: "action", 口播: "speech", 其他: "other" }[categoryValue] || "other";
  const needsReview = activeClip.dataset.category.split(" ").includes("issue");
  activeClip.dataset.name = newName;
  activeClip.dataset.category = `${categoryType}${needsReview ? " issue" : ""}`;
  activeClip.querySelector("strong").textContent = newName;
  activeClip.querySelector("small").textContent = `${categoryValue} · 已人工确认`;
  showToast("当前片段已保存");
});

document.querySelector("#splitClipButton").addEventListener("click", () => {
  const half = Number(activeClip.dataset.duration) / 2;
  if (half < 2) {
    showToast(`拆分后每段约 ${half.toFixed(2)} 秒，不符合 2 秒下限`, true);
  } else {
    showToast(`已在播放点拆分，两个片段均为 ${half.toFixed(2)} 秒`);
  }
});

document.querySelector("#mergeClipButton").addEventListener("click", () => {
  const cards = [...document.querySelectorAll("[data-clip]")];
  const index = cards.indexOf(activeClip);
  const next = cards[index + 1];
  if (!next) {
    showToast("当前片段后面没有可合并片段", true);
    return;
  }
  const mergedDuration = Number(activeClip.dataset.duration) + Number(next.dataset.duration);
  activeClip.dataset.duration = mergedDuration.toFixed(2);
  activeClip.dataset.name = `${activeClip.dataset.name} + ${next.dataset.name}`;
  activeClip.querySelector("strong").textContent = activeClip.dataset.name;
  activeClip.querySelector(".clip-image b").textContent = `${mergedDuration.toFixed(2)}s`;
  next.hidden = true;
  if (activeClip.dataset.category.includes("issue")) {
    activeClip.dataset.category = activeClip.dataset.category.replace("issue", "").trim();
    activeClip.querySelector(".clip-image i")?.remove();
    updateIssueCount(issueCount - 1);
  }
  selectClip(activeClip);
  showToast("已与下一片段合并，可撤销操作将在正式版本提供");
});

function askConfirm(title, text, action) {
  document.querySelector("#confirmTitle").textContent = title;
  document.querySelector("#confirmText").textContent = text;
  pendingConfirmAction = action;
  document.querySelector("#confirmDialog").showModal();
}
document.querySelector("#discardClipButton").addEventListener("click", () => {
  askConfirm("将片段标为不可用？", "片段不会进入正式素材库，但仍能从原视频重新选取。", () => {
    activeClip.hidden = true;
    if (activeClip.dataset.category.includes("issue")) updateIssueCount(issueCount - 1);
    const nextVisible = [...document.querySelectorAll("[data-clip]")].find((clip) => !clip.hidden);
    if (nextVisible) selectClip(nextVisible);
    showToast("片段已移入不可用列表");
  });
});
document.querySelector("#confirmActionButton").addEventListener("click", () => {
  document.querySelector("#confirmDialog").close();
  pendingConfirmAction?.();
  pendingConfirmAction = null;
});

// Dialog helpers
document.querySelectorAll("[data-open-dialog]").forEach((button) => {
  button.addEventListener("click", () => document.querySelector(`#${button.dataset.openDialog}`)?.showModal());
});
document.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
document.querySelectorAll("dialog").forEach((dialog) => {
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog && dialog.id !== "progressDialog") dialog.close();
  });
});

document.querySelector("#openPreviewButton").addEventListener("click", () => {
  const videoUrl = activeClip.dataset.videoUrl || "";
  const dialogVideo = document.querySelector("#dialogPreviewVideo");
  const dialogImage = document.querySelector("#dialogPreviewImage");
  setMutedPreview(dialogVideo, dialogImage, videoUrl, activeClip.dataset.sourceImage);
  document.querySelector("#dialogPreviewFallback").hidden = Boolean(videoUrl);
  document.querySelector("#dialogPreviewTitle").textContent = activeClip.dataset.name;
  document.querySelector("#dialogPreviewMeta").textContent = `${activeClip.dataset.time} · ${Number(activeClip.dataset.duration).toFixed(2)} 秒`;
  document.querySelector("#previewDialog").showModal();
  if (videoUrl) dialogVideo.play().catch(() => {});
});
document.querySelector("#previewDialog").addEventListener("close", () => document.querySelector("#dialogPreviewVideo").pause());

// Subtitle interactions
const compareStage = document.querySelector("#compareStage");
const compareButton = document.querySelector("#toggleCompareButton");
function showOriginal(show) {
  compareStage.classList.toggle("show-original", show);
  compareButton.textContent = show ? "松开查看修复后" : "按住查看原画";
}
compareButton.addEventListener("pointerdown", () => showOriginal(true));
compareButton.addEventListener("pointerup", () => showOriginal(false));
compareButton.addEventListener("pointerleave", () => showOriginal(false));
compareButton.addEventListener("keydown", (event) => { if (event.code === "Space" || event.code === "Enter") showOriginal(true); });
compareButton.addEventListener("keyup", () => showOriginal(false));

const strategyCopy = {
  repair: ["智能补全字幕覆盖区域", "适合字幕没有大面积遮挡服装主体的镜头。"],
  crop: ["裁掉底部字幕安全区", "画面会自动重新居中，适合人物主体位置较高的镜头。"],
  blur: ["柔化字幕区域", "速度最快，但会保留一条弱化区域，适合低优先级素材。"]
};
document.querySelectorAll("[data-strategy]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-strategy]").forEach((item) => item.classList.remove("is-active"));
    button.classList.add("is-active");
    const [title, text] = strategyCopy[button.dataset.strategy];
    document.querySelector("#strategyTitle").textContent = title;
    document.querySelector("#strategyText").textContent = text;
    showToast(`已切换为${button.textContent}`);
  });
});
document.querySelector("#maskRange").addEventListener("input", (event) => document.querySelector("#maskRangeValue").textContent = `${event.target.value} px`);
document.querySelector("#showMaskToggle").addEventListener("change", (event) => compareStage.classList.toggle("show-mask", event.target.checked));

let subtitleIndex = 1;
const subtitleImages = ["assets/video1-look.jpg", "assets/video1-detail.jpg", "assets/video2-front.jpg", "assets/video2-side.jpg"];
function moveSubtitle(direction) {
  subtitleIndex = Math.min(14, Math.max(1, subtitleIndex + direction));
  document.querySelector("#subtitleCurrent").textContent = subtitleIndex;
  document.querySelector("#subtitlePreviewImage").src = subtitleImages[(subtitleIndex - 1) % subtitleImages.length];
  showToast(`正在检查第 ${subtitleIndex} 个片段`);
}
document.querySelector("#previousSubtitleClip").addEventListener("click", () => moveSubtitle(-1));
document.querySelector("#nextSubtitleClip").addEventListener("click", () => moveSubtitle(1));
document.querySelector("#subtitlePlayButton").addEventListener("click", (event) => {
  event.currentTarget.textContent = event.currentTarget.textContent === "▶" ? "Ⅱ" : "▶";
  showToast(event.currentTarget.textContent === "Ⅱ" ? "开始播放修复预览" : "预览已暂停");
});
document.querySelector("#applyAllSubtitlesButton").addEventListener("click", () => showToast("已将当前策略应用到 8 个同位置字幕片段"));
document.querySelector("#finishSubtitleButton").addEventListener("click", () => {
  showToast("14 个片段的字幕处理已确认");
  navigate("editing");
});

// Mix choices and generation
document.querySelectorAll("[data-choice-group]").forEach((group) => {
  group.querySelectorAll("[data-choice]").forEach((choice) => {
    choice.addEventListener("click", () => {
      group.querySelectorAll("[data-choice]").forEach((item) => item.classList.remove("is-selected"));
      choice.classList.add("is-selected");
      const summaryTarget = { script: "#selectedScript", voice: "#selectedVoice", music: "#selectedMusic" }[group.dataset.choiceGroup];
      document.querySelector(summaryTarget).textContent = choice.dataset.choice;
      if (group.dataset.choiceGroup !== "script") showToast(`正在试听：${choice.dataset.choice}`);
    });
  });
});
document.querySelector("#generateMixButton").addEventListener("click", () => {
  runProgress("正在生成第一版混剪", "匹配脚本槽位、配音和音乐…", () => {
    navigate("export");
    showToast("第一版混剪已完成并加入导出列表");
  });
});

// Export task controls
document.querySelector("#pauseExportButton")?.addEventListener("click", (event) => {
  const paused = event.currentTarget.textContent === "继续";
  event.currentTarget.textContent = paused ? "暂停" : "继续";
  document.querySelector("#processingText").textContent = paused ? "正在合成字幕 · 68%" : "任务已暂停 · 68%";
  showToast(paused ? "导出任务已继续" : "导出任务已暂停");
});
document.querySelector("#cancelExportButton")?.addEventListener("click", () => {
  askConfirm("取消这个导出任务？", "已生成的临时文件会移入缓存回收区。", () => {
    document.querySelector("#processingJob").remove();
    showToast("导出任务已取消");
  });
});
document.querySelector(".retry-button")?.addEventListener("click", () => {
  const job = document.querySelector("#failedJob");
  job.querySelector(".status-pill").className = "status-pill processing";
  job.querySelector(".status-pill").textContent = "重新处理中";
  job.querySelector("p").textContent = "已重新选择音乐，正在建立导出任务…";
  showToast("已重新选择音乐并开始重试");
});

// Four connected business modules
const appState = {
  materials: [
    { id: "m1", name: "黑 T 通勤正侧面", type: "outfit", typeLabel: "人物穿搭", sku: "S2026-08", batch: "神裤测评 01", duration: 4.00, image: "assets/video1-look.jpg", uses: 1 },
    { id: "m2", name: "手持裤装与版型", type: "detail", typeLabel: "细节讲解", sku: "S2026-08", batch: "神裤测评 01", duration: 2.60, image: "assets/video1-detail.jpg", uses: 1 },
    { id: "m3", name: "显高显瘦与体型适配", type: "review", typeLabel: "测评讲解", sku: "S2026-08", batch: "神裤测评 01", duration: 4.40, image: "assets/video1-look.jpg", uses: 1 },
    { id: "m4", name: "针织短袖搭配", type: "outfit", typeLabel: "人物穿搭", sku: "S2026-08", batch: "神裤测评 01", duration: 4.90, image: "assets/video1-look.jpg", uses: 0 },
    { id: "m5", name: "面料与实用性", type: "detail", typeLabel: "细节讲解", sku: "S2026-08", batch: "神裤测评 01", duration: 2.58, image: "assets/video1-detail.jpg", uses: 0 },
    { id: "m6", name: "正面全身展示", type: "outfit", typeLabel: "人物穿搭", sku: "K172-07", batch: "褶皱西裤 02", duration: 5.90, image: "assets/video2-front.jpg", uses: 1 },
    { id: "m7", name: "背面回转侧面展示", type: "outfit", typeLabel: "人物穿搭", sku: "K172-07", batch: "褶皱西裤 02", duration: 3.37, image: "assets/video2-side.jpg", uses: 0 }
  ],
  editingMaterialIds: ["m1", "m2", "m3", "m6"],
  voices: [],
  music: [{ id: "a1", name: "轻快通勤.mp3", meta: "02:12 · -18 dB" }],
  scripts: [
    { id: "s1", name: "神裤测评", duration: 45, blocks: [
      { id: "b1", name: "痛点开场", text: "久坐时裤型容易塌，这条是我的实际穿着体验。", category: "测评讲解", duration: 5 },
      { id: "b2", name: "正侧面上身", text: "先看正面和侧面的整体版型。", category: "人物穿搭", duration: 10 },
      { id: "b3", name: "面料和版型", text: "面料垂顺，腰头和褶皱细节可以近看。", category: "细节讲解", duration: 15 },
      { id: "b4", name: "多套搭配", text: "搭配短上衣和通勤上装都比较利落。", category: "人物穿搭", duration: 10 },
      { id: "b5", name: "结论与行动", text: "尺码和颜色以商品页面实时信息为准。", category: "测评讲解", duration: 5 }
    ] },
    { id: "s2", name: "通勤穿搭", duration: 30, blocks: [
      { id: "b6", name: "整体亮相", text: "先看这一套通勤穿搭的整体效果。", category: "人物穿搭", duration: 6 },
      { id: "b7", name: "三套搭配", text: "用不同上装展示三种日常搭配思路。", category: "人物穿搭", duration: 18 },
      { id: "b8", name: "结尾引导", text: "具体尺码请结合商品页尺码表选择。", category: "测评讲解", duration: 6 }
    ] },
    { id: "s3", name: "面料细节快剪", duration: 30, blocks: [
      { id: "b9", name: "面料近景", text: "近距离看面料纹理和走线。", category: "细节讲解", duration: 12 },
      { id: "b10", name: "版型说明", text: "这一段说明腰头、裤腿和褶皱版型。", category: "测评讲解", duration: 10 },
      { id: "b11", name: "上身验证", text: "回到全身画面看实际穿着效果。", category: "人物穿搭", duration: 8 }
    ] }
  ],
  editingScriptId: "s1",
  activeManagedScriptId: "s1",
  selectedAiVoice: "自然女声",
  outputCount: 3,
  productionStep: 1,
  outputs: [],
  currentReportOutputId: null,
  competitorAnalyses: [],
  mixOutputDir: "",
  editingPlan: null
};

function normalizeScript(script) {
  script.voiceMode = ["full_voice", "partial_voice", "music_only"].includes(script.voiceMode) ? script.voiceMode : "full_voice";
  let cursor = 0;
  script.blocks.forEach((block) => {
    block.start = Number.isFinite(Number(block.start)) ? Number(block.start) : cursor;
    block.duration = Math.max(2, Number(block.duration || 2));
    block.visualInstruction = block.visualInstruction || block.name || "匹配对应内容分类";
    block.subtitleText = block.subtitleText ?? block.text ?? "";
    block.voiceText = block.voiceText ?? block.text ?? "";
    block.voiceEnabled = script.voiceMode === "music_only" ? false : block.voiceEnabled !== false;
    block.transitionNote = block.transitionNote || "按节奏自然切换";
    cursor = block.start + block.duration;
  });
  return script;
}

appState.scripts.forEach(normalizeScript);

let libraryFilter = "all";
let libraryFolder = "S2026-08";
let selectedMaterialIds = new Set();
let materialPickerSelection = new Set();
let materialPickerQuery = "";
let materialPickerCategory = "all";
let scriptPickerSelection = "s1";

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function formatTaskTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

function renderTaskBoard(board = {}) {
  const tasks = Array.isArray(board.tasks) ? board.tasks : [];
  const dateLabel = board.date ? `${board.date} · 按本机日期统计` : "按本机日期统计今天的上传与分类结果。";
  document.querySelector("#taskBoardDate").textContent = dateLabel;
  document.querySelector("#todayBatchCount").textContent = Number(board.batchCount || 0);
  document.querySelector("#todaySourceCount").textContent = Number(board.sourceCount || 0);
  document.querySelector("#todayMaterialCount").textContent = Number(board.materialCount || 0);
  document.querySelector("#todayReviewCount").textContent = Number(board.reviewCount || 0);
  document.querySelector("#todayFailedCount").textContent = Number(board.failedCount || 0);
  document.querySelector("#todayCompletedLabel").textContent = board.completedCount ? `已完成 ${board.completedCount} 个` : board.processingCount ? `处理中 ${board.processingCount} 个` : "尚无完成任务";
  document.querySelector("#navTodayTaskCount").textContent = Number(board.materialCount || 0);

  const statusMeta = {
    processing: ["处理中", "正在分析素材"],
    completed: ["已完成", "素材已归入款号盘"],
    failed: ["失败", "可检查原因后重新上传"],
    interrupted: ["已中断", "软件关闭前任务尚未结束"]
  };
  const list = document.querySelector("#todayTaskList");
  list.innerHTML = tasks.length ? tasks.map((task) => {
    const [statusLabel, fallbackMessage] = statusMeta[task.status] || statusMeta.interrupted;
    const canOpen = Boolean(task.batchDir);
    return `<article class="today-task-row is-${escapeHtml(task.status)}">
      <span class="task-status-mark" aria-hidden="true"></span>
      <span class="task-main"><strong>${escapeHtml(task.sku)} · ${escapeHtml(task.batchName)}</strong><small>${escapeHtml(task.message || fallbackMessage)}${task.errorMessage ? ` · ${escapeHtml(task.errorMessage)}` : ""}</small></span>
      <span class="task-count"><strong>${Number(task.materialCount || 0)}</strong><small>分类素材</small></span>
      <span class="task-count"><strong>${Number(task.reviewCount || 0)}</strong><small>待复核</small></span>
      <span class="task-meta"><i>${escapeHtml(statusLabel)}</i><small>${escapeHtml(formatTaskTime(task.completedAt || task.updatedAt || task.createdAt))}</small></span>
      ${canOpen ? `<button class="text-button" type="button" data-open-task-dir="${escapeHtml(task.batchDir)}">打开目录</button>` : "<span></span>"}
    </article>`;
  }).join("") : '<div class="task-empty"><strong>今天还没有分类任务</strong><p>上传一批视频并选择款号后，处理记录会显示在这里。</p><button class="button primary" type="button" data-route="source">上传第一批素材</button></div>';
  list.querySelectorAll("[data-route]").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.route)));

  const categories = Object.entries(board.categories || {}).filter(([, count]) => Number(count) > 0).sort((a, b) => Number(b[1]) - Number(a[1]));
  const maxCount = Math.max(1, ...categories.map(([, count]) => Number(count)));
  document.querySelector("#todayCategoryBreakdown").innerHTML = categories.length ? categories.map(([label, count]) => `<div class="task-category-row"><span><strong>${escapeHtml(label)}</strong><small>${Number(count)} 个</small></span><progress max="${maxCount}" value="${Number(count)}" aria-label="${escapeHtml(label)} ${Number(count)} 个"></progress></div>`).join("") : '<div class="task-category-empty">完成分类后显示各类素材数量。</div>';
}
window.renderTaskBoard = renderTaskBoard;

function currentScriptSnapshot(script) {
  if (!script) return [];
  const categoryTypes = { "人物穿搭": "outfit", "整体展示": "overall", "细节讲解": "detail", "测评讲解": "review", "测评对比": "review", "动作展示": "action", "口播": "speech", "其他": "other" };
  return (script.blocks || []).map((block, index) => ({
    id: String(block.id || `block-${index + 1}`),
    name: String(block.name || `段落 ${index + 1}`).slice(0, 100),
    duration: Number(Math.max(0.5, Number(block.duration || 2)).toFixed(3)),
    type: ["outfit", "overall", "detail", "review", "action", "speech", "other"].includes(String(block.type || "").toLowerCase()) ? String(block.type).toLowerCase() : categoryTypes[String(block.category || "").trim()] || "other",
    visualInstruction: String(block.visualInstruction || block.name || "匹配画面内容").slice(0, 500),
    subtitleText: String(block.subtitleText ?? block.text ?? "").slice(0, 1000),
    voiceText: String(block.voiceText ?? block.text ?? "").slice(0, 1000),
    voiceEnabled: script.voiceMode === "music_only" ? false : block.voiceEnabled !== false,
    transitionNote: String(block.transitionNote || "按节奏自然切换").slice(0, 300)
  }));
}

function isEditingPlanStale(plan = appState.editingPlan) {
  if (!plan) return false;
  const script = appState.scripts.find((item) => item.id === appState.editingScriptId);
  if (!script || String(plan.scriptId || "") !== String(script.id || "")) return true;
  const currentMaterialIds = [...appState.editingMaterialIds].map(String).sort();
  const plannedMaterialIds = Array.isArray(plan.inputMaterialIds) ? [...plan.inputMaterialIds].map(String).sort() : [];
  if (JSON.stringify(currentMaterialIds) !== JSON.stringify(plannedMaterialIds)) return true;
  if (Array.isArray(plan.scriptSnapshot) && JSON.stringify(currentScriptSnapshot(script)) !== JSON.stringify(plan.scriptSnapshot)) return true;
  return false;
}

function renderAiEditorPlan() {
  const planner = document.querySelector(".ai-editor-planner");
  const preview = document.querySelector("#aiEditorPlanPreview");
  const status = document.querySelector("#aiEditorPlanStatus");
  const confirm = document.querySelector("#confirmAiEditorPlan");
  const replan = document.querySelector("#replanWithAiEditor");
  const planButton = document.querySelector("#planWithAiEditor");
  const hint = document.querySelector("#aiEditorPlanHint");
  const startButton = document.querySelector("#startConnectedMix");
  const readinessPlan = document.querySelector("#readinessPlan");
  if (!planner || !preview || !status || !confirm || !replan || !planButton || !hint || !startButton) return;
  const script = appState.scripts.find((item) => item.id === appState.editingScriptId);
  const hasInputs = Boolean(script && appState.editingMaterialIds.length);
  const plan = appState.editingPlan;
  const stale = isEditingPlanStale(plan);
  if (stale && plan?.confirmed) plan.confirmed = false;
  planner.classList.remove("is-ready", "is-review", "is-blocked", "is-stale");
  planButton.disabled = !hasInputs;
  replan.hidden = !plan;

  if (!plan) {
    status.className = "status-pill";
    status.textContent = "等待安排";
    preview.innerHTML = `<div class="ai-editor-empty"><strong>${hasInputs ? "还没有剪辑方案" : "请先选择素材和脚本"}</strong><small>${hasInputs ? "点击“让 AI 剪辑师安排”，本地 Qwen 会逐段选镜。" : "AI 只会读取本次勾选的素材能力卡。"}</small></div>`;
    confirm.disabled = true;
    confirm.textContent = "确认采用这份安排";
    hint.textContent = "生成前必须查看并确认剪辑决策单。";
    startButton.disabled = true;
    if (readinessPlan) readinessPlan.textContent = "等待逐段安排并确认";
    return;
  }

  const statusLabels = { ready: "可确认", review: "需要复核", blocked: "存在阻断" };
  const evidenceLabels = { direct: "直接证据", indirect: "间接匹配", missing: "证据缺失" };
  if (stale) {
    planner.classList.add("is-stale");
    status.className = "status-pill danger";
    status.textContent = "输入已变化";
  } else {
    planner.classList.add(`is-${plan.status}`);
    status.className = `status-pill ${plan.status === "ready" ? "success" : plan.status === "blocked" ? "danger" : "processing"}`;
    status.textContent = plan.confirmed ? "已确认" : statusLabels[plan.status] || "需要复核";
  }
  const materialMap = new Map(appState.materials.map((material) => [String(material.id), material]));
  const decisions = Array.isArray(plan.decisions) ? plan.decisions : [];
  const decisionHtml = decisions.map((decision, index) => {
    const materialNames = (decision.selectedMaterialIds || []).map((id) => materialMap.get(String(id))?.name || id);
    const timelineSeconds = (decision.timeline || []).reduce((total, item) => total + Number(item.duration || 0), 0);
    const warnings = (decision.unsupportedClaims || []).map((claim) => `<span>${escapeHtml(claim)}</span>`).join("");
    const rewrite = decision.rewriteRequired
      ? `<div class="ai-editor-rewrite"><strong>需要改词：</strong>${escapeHtml(decision.suggestedVoiceText || "建议删除无画面证据的卖点，人工确认口播后再生成。")}</div>`
      : "";
    return `<article class="ai-editor-decision is-${escapeHtml(decision.evidenceStatus || "indirect")}">
      <div class="ai-editor-decision-index"><span>段落 ${index + 1}</span><small>${Number(timelineSeconds).toFixed(1)} 秒</small></div>
      <div class="ai-editor-decision-copy"><strong>${escapeHtml(decision.blockName || decision.blockId)}</strong><small>${escapeHtml(evidenceLabels[decision.evidenceStatus] || "需要复核")} · ${escapeHtml(decision.reason || "等待选镜理由")}</small>
      <div class="ai-editor-materials">${materialNames.length ? materialNames.map((name) => `<span>${escapeHtml(name)}</span>`).join("") : "<span>没有可执行素材</span>"}</div>
      ${warnings ? `<div class="ai-editor-warnings">${warnings}</div>` : ""}${rewrite}</div>
    </article>`;
  }).join("");
  preview.innerHTML = `<div class="ai-editor-empty"><strong>${escapeHtml(plan.summary || "AI 剪辑师已完成安排")}</strong><small>${decisions.length} 个脚本段落 · ${escapeHtml(plan.model || "qwen3.5:latest")} · 只使用本次勾选素材</small></div>${decisionHtml || '<div class="ai-editor-empty"><strong>计划没有可执行段落</strong><small>请重新安排。</small></div>'}`;
  const canConfirm = !stale && plan.status !== "blocked" && decisions.length > 0;
  confirm.disabled = !canConfirm || plan.confirmed === true;
  confirm.textContent = plan.confirmed ? "已确认采用" : "确认采用这份安排";
  hint.textContent = stale ? "素材或脚本已变化，必须重新安排。" : plan.status === "blocked" ? "计划存在阻断项，请补充素材后重新安排。" : plan.status === "review" ? "包含证据缺口或改词建议，请逐段检查后确认。" : "镜头与素材证据匹配，可以确认后生成。";
  startButton.disabled = !(plan.confirmed === true && canConfirm);
  if (readinessPlan) readinessPlan.textContent = stale ? "输入已变化，需重新安排" : plan.confirmed ? `${decisions.length} 个段落已确认` : plan.status === "blocked" ? "计划被阻断" : "等待人工确认";
}

window.caikuRenderAiEditorPlan = renderAiEditorPlan;
window.caikuEditingPlanIsStale = isEditingPlanStale;

function updateModuleCounts() {
  const materialCount = appState.materials.length;
  const scriptCount = appState.scripts.length;
  document.querySelector("#navLibraryCount").textContent = materialCount;
  document.querySelector("#libraryAllCount").textContent = materialCount;
  document.querySelector("#editingLibraryCount").textContent = materialCount;
  document.querySelector("#navScriptCount").textContent = scriptCount;
  document.querySelector("#editingScriptCount").textContent = scriptCount;
  const basketCount = document.querySelector("#selectionBasketCount");
  if (basketCount) basketCount.textContent = appState.editingMaterialIds.length;
}

function renderSkuFolders() {
  const tree = document.querySelector(".folder-tree");
  const skuGroups = [...appState.materials.reduce((groups, material) => {
    const sku = material.sku || "未分款";
    const entry = groups.get(sku) || { sku, batchNames: new Set(), count: 0 };
    entry.count += 1;
    if (material.batch) entry.batchNames.add(material.batch);
    groups.set(sku, entry);
    return groups;
  }, new Map()).values()].sort((a, b) => a.sku.localeCompare(b.sku, "zh-CN"));
  const validFolders = new Set(["all", "unusable", ...skuGroups.map((item) => item.sku)]);
  if (!validFolders.has(libraryFolder)) libraryFolder = "all";
  tree.innerHTML = `${skuGroups.map((group) => `<button class="${libraryFolder === group.sku ? "is-active" : ""}" data-folder="${escapeHtml(group.sku)}"><span>▣</span><span><strong>${escapeHtml(group.sku)}</strong><small>${escapeHtml([...group.batchNames].slice(0, 2).join("、") || "素材盘款号")}</small></span><b>${group.count}</b></button>`).join("")}
    <button class="${libraryFolder === "all" ? "is-active" : ""}" data-folder="all"><span>◫</span><span><strong>全部款号</strong><small>跨批次查看</small></span><b>${appState.materials.length}</b></button>
    <button class="${libraryFolder === "unusable" ? "is-active" : ""}" data-folder="unusable"><span>!</span><span><strong>不可用</strong><small>不会参与混剪</small></span><b>0</b></button>`;
  tree.querySelectorAll("[data-folder]").forEach((button) => button.addEventListener("click", () => {
    libraryFolder = button.dataset.folder;
    renderLibrary();
  }));
  const select = document.querySelector("#mixSkuSelect");
  if (select) {
    const previous = select.value;
    select.innerHTML = `${skuGroups.map((group) => `<option value="${escapeHtml(group.sku)}">${escapeHtml(group.sku)} · ${group.count} 个素材</option>`).join("")}<option value="all">全部款号</option>`;
    select.value = [...select.options].some((option) => option.value === previous) ? previous : skuGroups[0]?.sku || "all";
  }
}

function getVisibleMaterials() {
  const query = document.querySelector("#librarySearch").value.trim().toLowerCase();
  return appState.materials.filter((material) => {
    const matchesType = libraryFilter === "all" || material.type === libraryFilter;
    const matchesFolder = libraryFolder === "all" || (libraryFolder === "unusable" ? false : material.sku === libraryFolder);
    const haystack = `${material.name} ${material.sku} ${material.batch} ${material.typeLabel}`.toLowerCase();
    return matchesType && matchesFolder && (!query || haystack.includes(query));
  });
}

function materialAiLabel(material) {
  if (material.classificationMode === "qwen_vision") return `Qwen ${Math.round(Number(material.classificationConfidence || 0) * 100)}%`;
  if (material.classificationMode === "offline_fallback") return "离线兜底 · 待复核";
  return "历史批次 · 待重分析";
}

function renderLibrary() {
  renderSkuFolders();
  selectedMaterialIds = new Set([...selectedMaterialIds].filter((id) => appState.materials.some((item) => item.id === id)));
  const visible = getVisibleMaterials();
  const list = document.querySelector("#materialList");
  list.innerHTML = visible.map((material) => `
    <article class="material-row ${selectedMaterialIds.has(material.id) ? "is-selected" : ""}" data-material-row="${material.id}">
      <input type="checkbox" data-select-material="${material.id}" aria-label="选择${escapeHtml(material.name)}" ${selectedMaterialIds.has(material.id) ? "checked" : ""}>
      <span class="material-thumb"><img src="${material.image}" alt=""></span>
      <span class="material-name"><strong>${escapeHtml(material.name)}</strong><small>${escapeHtml(material.batch)} · ${material.captionStatus === "treated_needs_review" ? "字幕区待复核" : "已完成字幕处理"} · ${escapeHtml(materialAiLabel(material))}</small></span>
      <span class="material-meta"><i class="material-type ${material.type}">${escapeHtml(material.typeLabel)}</i><small>${escapeHtml(material.sku)}</small></span>
      <span class="material-duration">${material.duration.toFixed(2)}s</span>
      <span class="material-use">${material.uses ? `${material.uses} 个工程` : "未使用"}</span>
      <span class="material-actions"><button data-preview-material="${material.id}">预览</button><button class="delete-material" data-delete-material="${material.id}" aria-label="删除${escapeHtml(material.name)}">删除</button></span>
    </article>`).join("");
  document.querySelector("#libraryEmpty").hidden = visible.length > 0;
  const selectedCount = selectedMaterialIds.size;
  document.querySelector("#bulkMaterialBar").hidden = selectedCount === 0;
  document.querySelector("#selectedMaterialCount").textContent = selectedCount;
  document.querySelector("#selectAllMaterials").checked = visible.length > 0 && visible.every((item) => selectedMaterialIds.has(item.id));

  list.querySelectorAll("[data-select-material]").forEach((checkbox) => checkbox.addEventListener("change", () => {
    checkbox.checked ? selectedMaterialIds.add(checkbox.dataset.selectMaterial) : selectedMaterialIds.delete(checkbox.dataset.selectMaterial);
    renderLibrary();
  }));
  list.querySelectorAll("[data-preview-material]").forEach((button) => button.addEventListener("click", () => {
    const material = appState.materials.find((item) => item.id === button.dataset.previewMaterial);
    document.querySelector("#dialogPreviewImage").src = material.image;
    document.querySelector("#dialogPreviewTitle").textContent = material.name;
    document.querySelector("#dialogPreviewMeta").textContent = `${material.typeLabel} · ${material.duration.toFixed(2)} 秒 · ${material.sku}`;
    document.querySelector("#previewDialog").showModal();
  }));
  list.querySelectorAll("[data-delete-material]").forEach((button) => button.addEventListener("click", () => requestMaterialDelete(button.dataset.deleteMaterial)));
  updateModuleCounts();
}

function requestMaterialDelete(id, afterDelete) {
  const material = appState.materials.find((item) => item.id === id);
  if (!material) return;
  const inEditing = appState.editingMaterialIds.includes(id);
  askConfirm(`删除素材“${material.name}”？`, inEditing ? "它正在未导出的成片工程中使用。删除后会同步从时间线移除，原视频仍保留。" : "素材文件会移入软件回收区，原视频仍保留。", () => {
    if (window.caiku?.trashMaterial) window.caiku.trashMaterial(material).catch((error) => showToast(error.message || "素材文件删除失败", true));
    appState.materials = appState.materials.filter((item) => item.id !== id);
    appState.editingMaterialIds = appState.editingMaterialIds.filter((materialId) => materialId !== id);
    selectedMaterialIds.delete(id);
    renderLibrary();
    renderEditing();
    afterDelete?.();
    showToast(inEditing ? "素材已删除，并从成片时间线同步移除" : "素材已移入软件回收区");
  });
}

document.querySelector("#deleteActiveClip").addEventListener("click", () => {
  if (!activeClip) return;
  const materialId = activeClip.dataset.materialId;
  if (materialId && appState.materials.some((item) => item.id === materialId)) {
    requestMaterialDelete(materialId, () => {
      const removedClip = activeClip;
      const next = [...document.querySelectorAll("[data-clip]")].find((clip) => clip !== removedClip && !clip.hidden);
      removedClip.remove();
      activeClip = next || null;
      if (activeClip) selectClip(activeClip);
    });
    return;
  }
  const clipName = activeClip.dataset.name || "当前片段";
  askConfirm(`删除片段“${clipName}”？`, "该演示片段会从当前批次移除，原视频仍保留。", () => {
    const removedClip = activeClip;
    const next = [...document.querySelectorAll("[data-clip]")].find((clip) => clip !== removedClip && !clip.hidden);
    removedClip.remove();
    activeClip = next || null;
    if (activeClip) selectClip(activeClip);
    showToast("片段已删除，原视频仍保留");
  });
});

document.querySelectorAll("[data-library-filter]").forEach((button) => button.addEventListener("click", () => {
  libraryFilter = button.dataset.libraryFilter;
  document.querySelectorAll("[data-library-filter]").forEach((item) => item.classList.toggle("is-active", item === button));
  renderLibrary();
}));
document.querySelector("#librarySearch").addEventListener("input", renderLibrary);
document.querySelector("#selectAllMaterials").addEventListener("change", (event) => {
  getVisibleMaterials().forEach((material) => event.target.checked ? selectedMaterialIds.add(material.id) : selectedMaterialIds.delete(material.id));
  renderLibrary();
});
document.querySelector("#openLibraryFolder").addEventListener("click", () => showToast("将在资源管理器中打开 D:\\抖音素材库"));
document.querySelector("#addLibraryButton").addEventListener("click", () => document.querySelector("#libraryFileInput").click());
document.querySelector("#emptyAddMaterial").addEventListener("click", () => document.querySelector("#libraryFileInput").click());

function addExternalMaterials(files) {
  [...files].forEach((file, index) => {
    appState.materials.push({
      id: `ext-${Date.now()}-${index}`,
      name: file.name,
      type: "external",
      typeLabel: "外部素材",
      sku: currentBatchLabel.textContent.split(" · ")[0],
      batch: "手动添加",
      duration: file.type.startsWith("audio/") ? 0 : 6,
      image: "assets/video1-detail.jpg",
      uses: 0
    });
  });
  libraryFilter = "all";
  libraryFolder = "all";
  document.querySelectorAll("[data-folder]").forEach((item) => item.classList.toggle("is-active", item.dataset.folder === "all"));
  document.querySelectorAll("[data-library-filter]").forEach((item) => item.classList.toggle("is-active", item.dataset.libraryFilter === "all"));
  renderLibrary();
  showToast(`已添加 ${files.length} 个外部素材，每个素材均可单独删除`);
}
document.querySelector("#libraryFileInput").addEventListener("change", (event) => addExternalMaterials(event.target.files));

document.querySelector("#deleteSelectedMaterials").addEventListener("click", () => {
  const count = selectedMaterialIds.size;
  askConfirm(`删除所选 ${count} 个素材？`, "素材文件与缩略图会移入系统回收站；正在使用的引用也会从本次混剪移除，原视频仍保留。", async () => {
    const removed = appState.materials.filter((item) => selectedMaterialIds.has(item.id));
    if (window.caiku?.trashMaterial) {
      for (const item of removed) await window.caiku.trashMaterial(item).catch(() => false);
    }
    appState.materials = appState.materials.filter((item) => !selectedMaterialIds.has(item.id));
    appState.editingMaterialIds = appState.editingMaterialIds.filter((id) => !selectedMaterialIds.has(id));
    selectedMaterialIds.clear();
    renderLibrary();
    renderEditing();
    showToast(`已将 ${count} 个素材移入系统回收站`);
  });
});
document.querySelector("#addSelectedToEditing").addEventListener("click", () => {
  selectedMaterialIds.forEach((id) => { if (!appState.editingMaterialIds.includes(id)) appState.editingMaterialIds.push(id); });
  renderEditing();
  showToast(`已将 ${selectedMaterialIds.size} 个素材加入本次混剪选材篮`);
  navigate("editing");
});
document.querySelector("#openSelectionBasket").addEventListener("click", () => {
  navigate("editing");
  setProductionStep(1);
});
document.querySelector("#loadSkuMaterials").addEventListener("click", () => {
  const sku = document.querySelector("#mixSkuSelect").value;
  const matches = appState.materials.filter((item) => sku === "all" || item.sku === sku).filter((item) => Number(item.duration) >= 2);
  matches.forEach((item) => { if (!appState.editingMaterialIds.includes(item.id)) appState.editingMaterialIds.push(item.id); });
  renderEditing();
  showToast(`已从素材盘加载 ${matches.length} 个${sku === "all" ? "" : ` ${sku}`}素材`);
});
document.querySelector("#clearMixMaterials").addEventListener("click", () => {
  if (!appState.editingMaterialIds.length) return;
  askConfirm("清空本次混剪选材篮？", "只解除当前混剪项目中的引用，不会删除素材盘文件。", () => {
    appState.editingMaterialIds = [];
    renderEditing();
    renderLibrary();
    showToast("本次混剪选材篮已清空，素材盘文件仍保留");
  });
});

function addProcessedBatchToLibrary() {
  if (appState.materials.some((item) => item.id === "processed-latest")) return;
  appState.materials.push({ id: "processed-latest", name: "新处理的合格片段", type: "outfit", typeLabel: "人物穿搭", sku: skuInput.value, batch: batchNameInput.value, duration: 3.20, image: "assets/video1-look.jpg", uses: 0 });
  renderLibrary();
}

function renderEditing() {
  appState.editingMaterialIds = appState.editingMaterialIds.filter((id) => appState.materials.some((item) => item.id === id));
  const timeline = document.querySelector("#editingTimeline");
  const timelineMaterials = appState.editingMaterialIds.map((id) => appState.materials.find((item) => item.id === id)).filter(Boolean);
  timeline.innerHTML = timelineMaterials.length ? timelineMaterials.map((material) => `
    <article class="timeline-clip"><img src="${material.image}" alt=""><button class="asset-delete" data-remove-editing-material="${material.id}" aria-label="从时间线删除${escapeHtml(material.name)}">删除</button><strong>${escapeHtml(material.name)}</strong><small>${material.duration.toFixed(2)}s · ${escapeHtml(material.typeLabel)}</small></article>`).join("") : '<div class="timeline-empty">时间线还没有画面素材，请从素材管理中添加。</div>';
  timeline.querySelectorAll("[data-remove-editing-material]").forEach((button) => button.addEventListener("click", () => {
    appState.editingMaterialIds = appState.editingMaterialIds.filter((id) => id !== button.dataset.removeEditingMaterial);
    renderEditing();
    showToast("素材已从时间线删除，素材库文件仍保留");
  }));

  renderAudioTrack("voices", "#voiceTrackList");
  renderAudioTrack("music", "#musicTrackList");
  const script = appState.scripts.find((item) => item.id === appState.editingScriptId);
  document.querySelector("#editingScriptName").textContent = script ? `${script.name} · ${script.duration} 秒` : "尚未选择脚本";
  document.querySelector("#readinessScript").textContent = script ? `${script.name} · ${script.duration} 秒` : "请从脚本管理选择";
  document.querySelector("#readinessMaterial").textContent = timelineMaterials.length ? `${timelineMaterials.length} 个片段，均 ≥ 2 秒` : "请添加画面素材";
  const hasVoice = Boolean(appState.selectedAiVoice || appState.voices.length);
  const needsVoice = Boolean(script && script.voiceMode !== "music_only" && script.blocks.some((block) => block.voiceEnabled !== false));
  const voiceReady = !needsVoice || hasVoice;
  const voiceLabel = appState.voices.length ? `自定义配音 · ${appState.voices.length} 个文件` : appState.selectedAiVoice;
  document.querySelector("#readinessAudio").textContent = voiceReady && appState.music.length ? `${needsVoice ? voiceLabel : "纯音乐无口播"} · 音乐已添加` : needsVoice && !hasVoice ? "当前脚本需要口播，请选择声音" : "请至少添加一首音乐";
  const modeStatus = document.querySelector("#mixVoiceModeStatus");
  if (modeStatus) {
    const modeLabels = { full_voice: "全程口播", partial_voice: "部分段落口播", music_only: "纯音乐无口播" };
    modeStatus.querySelector("strong").textContent = script ? modeLabels[script.voiceMode] : "尚未选择脚本";
    modeStatus.querySelector("small").textContent = script?.voiceMode === "music_only" ? "本次混剪不会生成或要求口播音轨。" : script?.voiceMode === "partial_voice" ? "只为脚本中开启口播的段落生成声音。" : "脚本中的全部段落都需要口播声音。";
  }
  document.querySelector("#readinessOutputCount").textContent = `${appState.outputCount} 条视频`;
  document.querySelector("#materialCoverageCount").textContent = timelineMaterials.length;
  document.querySelector("#outputCountInput").value = appState.outputCount;
  document.querySelector("#outputEstimate").textContent = `支持 1–20 条，本次预计约 ${Math.max(2, appState.outputCount * 2)} 分钟。`;
  const readiness = document.querySelectorAll(".readiness-list li");
  readiness[0].classList.toggle("is-missing", !script);
  readiness[0].querySelector(":scope > span").textContent = script ? "✓" : "!";
  readiness[1].classList.toggle("is-missing", !timelineMaterials.length);
  readiness[1].querySelector(":scope > span").textContent = timelineMaterials.length ? "✓" : "!";
  readiness[2].classList.toggle("is-missing", !voiceReady || !appState.music.length);
  readiness[2].querySelector(":scope > span").textContent = voiceReady && appState.music.length ? "✓" : "!";
  readiness[3].classList.toggle("is-missing", appState.outputCount < 1);
  readiness[3].querySelector(":scope > span").textContent = appState.outputCount >= 1 ? "✓" : "!";
  const planReady = Boolean(appState.editingPlan?.confirmed && !isEditingPlanStale() && appState.editingPlan.status !== "blocked");
  readiness[4].classList.toggle("is-missing", !planReady);
  readiness[4].querySelector(":scope > span").textContent = planReady ? "✓" : "!";
  readiness[5].classList.remove("is-missing");
  readiness[5].querySelector(":scope > span").textContent = "✓";
  renderAiEditorPlan();
  renderProductionStep();
  renderBatchOutputs();
  updateModuleCounts();
}

function renderAudioTrack(kind, selector) {
  const items = appState[kind];
  const target = document.querySelector(selector);
  target.innerHTML = items.length ? items.map((item) => `<div class="track-asset"><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.meta)}</small></span><button class="asset-delete" data-delete-audio="${kind}:${item.id}" aria-label="删除${escapeHtml(item.name)}">删除</button></div>`).join("") : '<small>尚未添加</small>';
  target.querySelectorAll("[data-delete-audio]").forEach((button) => button.addEventListener("click", () => {
    const [assetKind, id] = button.dataset.deleteAudio.split(":");
    appState[assetKind] = appState[assetKind].filter((item) => item.id !== id);
    renderEditing();
    showToast(`${assetKind === "voices" ? "配音" : "音乐"}已从工程删除`);
  }));
}

function setProductionStep(step) {
  appState.productionStep = Math.min(5, Math.max(1, Number(step) || 1));
  renderProductionStep();
  document.querySelector("#screen-editing").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderProductionStep() {
  document.querySelectorAll("[data-production-step]").forEach((button) => {
    const step = Number(button.dataset.productionStep);
    button.classList.toggle("is-active", step === appState.productionStep);
    button.classList.toggle("is-complete", step < appState.productionStep);
    if (step === appState.productionStep) button.setAttribute("aria-current", "step");
    else button.removeAttribute("aria-current");
  });
  document.querySelectorAll("[data-production-panel]").forEach((panel) => {
    const isActive = Number(panel.dataset.productionPanel) === appState.productionStep;
    panel.hidden = !isActive;
    panel.classList.toggle("is-active", isActive);
  });
}

function createQualityOutput(index) {
  const number = String(index + 1).padStart(2, "0");
  const variants = [
    { status: "pass", score: 96, issue: "四项检查通过，可以导出。" },
    { status: "risk", score: 72, issue: "口播出现疑似极限表达“全网最低价”，需要替换后复核。" },
    { status: "risk", score: 79, issue: "文案描述“灰色裤装”，当前镜头识别为黑色，画文不一致。" }
  ];
  const variant = variants[index % variants.length];
  const checks = [
    { name: "画面与文案一致", passed: index % variants.length !== 2, detail: index % variants.length === 2 ? "颜色描述与画面识别结果不一致" : "商品、颜色、动作和卖点匹配" },
    { name: "口播模式与音轨", passed: true, detail: "已检查脚本声音模式与输出音轨；逐字核对需接入语音转写" },
    { name: "极限词与违禁词", passed: index % variants.length !== 1, detail: index % variants.length === 1 ? "发现疑似极限表达，需要人工确认" : "未发现需拦截的风险表达" },
    { name: "抖音投放适配", passed: variant.status === "pass", detail: variant.status === "pass" ? "满足当前发布前检查规则" : "修复风险项后重新检查" }
  ];
  return {
    id: `output-${Date.now()}-${index}`,
    name: `S2026-08_神裤测评_千川版${number}.mp4`,
    status: variant.status,
    score: variant.score,
    issue: variant.issue,
    duration: "00:45",
    image: index % 2 ? "assets/video2-front.jpg" : "assets/video1-look.jpg",
    checks
  };
}

function renderBatchOutputs() {
  const list = document.querySelector("#batchOutputList");
  const passed = appState.outputs.filter((item) => item.status === "pass").length;
  const risk = appState.outputs.filter((item) => item.status === "risk").length;
  const repairButton = document.querySelector("#repairAllOutputs");
  const exportButton = document.querySelector("#exportPassedOutputs");
  repairButton.disabled = risk === 0;
  exportButton.disabled = !appState.outputs.length || risk > 0;
  repairButton.title = risk ? `修复 ${risk} 条风险成片` : "当前没有需要修复的风险项";
  exportButton.title = !appState.outputs.length ? "生成并通过质检后才可导出" : risk ? `还有 ${risk} 条成片未通过质检` : "导出全部通过成片";
  document.querySelector("#pendingOutputCount").textContent = "0";
  document.querySelector("#passedOutputCount").textContent = passed;
  document.querySelector("#riskOutputCount").textContent = risk;
  if (!appState.outputs.length) {
    list.innerHTML = '<div class="quality-empty"><span>AI</span><h3>还没有生成结果</h3><p>返回生成设置，选择数量后开始混剪。</p><button class="button secondary" data-go-production-step="4">返回生成设置</button></div>';
    list.querySelector("[data-go-production-step]").addEventListener("click", () => setProductionStep(4));
    return;
  }
  list.innerHTML = appState.outputs.map((output, index) => `
    <article class="batch-output-card is-${output.status}">
      <div class="batch-output-thumb"><img src="${output.image}" alt=""><span>${output.duration}</span></div>
      <div class="batch-output-copy"><span class="status-pill ${output.status === "pass" ? "success" : "danger"}">${output.status === "pass" ? "✓ AI 质检通过" : "! 需要修复"}</span><strong>${escapeHtml(output.name)}</strong><small>${escapeHtml(output.issue)}</small></div>
      <div class="batch-output-actions"><button data-open-quality-report="${output.id}">${output.status === "pass" ? "查看报告" : "定位问题"}</button><button class="asset-delete" data-delete-output="${output.id}" aria-label="删除${escapeHtml(output.name)}">删除</button></div>
    </article>`).join("");
  list.querySelectorAll("[data-open-quality-report]").forEach((button) => button.addEventListener("click", () => openQualityReport(button.dataset.openQualityReport)));
  list.querySelectorAll("[data-delete-output]").forEach((button) => button.addEventListener("click", () => {
    const output = appState.outputs.find((item) => item.id === button.dataset.deleteOutput);
    askConfirm(`删除成片“${output?.name || ""}”？`, "仅删除这个生成结果和质检报告，不影响素材库、脚本及其他成片。", () => {
      if (output?.filePath && window.caiku) window.caiku.trashPath(output.filePath).catch(() => {});
      if (output?.reportPath && window.caiku) window.caiku.trashPath(output.reportPath).catch(() => {});
      if (output?.thumbnailPath && window.caiku) window.caiku.trashPath(output.thumbnailPath).catch(() => {});
      appState.outputs = appState.outputs.filter((item) => item.id !== button.dataset.deleteOutput);
      renderBatchOutputs();
      showToast("成片已从当前任务删除");
    });
  }));
}

function openQualityReport(id) {
  const output = appState.outputs.find((item) => item.id === id);
  if (!output) return;
  appState.currentReportOutputId = id;
  document.querySelector("#aiReportTitle").textContent = `${output.name} · ${output.status === "pass" ? "AI 质检通过" : "需要修复"}`;
  document.querySelector("#aiReportMeta").textContent = `1080×1920 · 9:16 · ${output.duration}`;
  document.querySelector("#aiReportScore").textContent = output.score;
  document.querySelector("#aiReportChecks").innerHTML = output.checks.map((check) => `<div class="report-check-row ${check.passed ? "" : "is-risk"}"><span>${check.passed ? "✓" : "!"}</span><span><strong>${escapeHtml(check.name)}</strong><small>${escapeHtml(check.detail)}</small></span><b>${check.passed ? "通过" : "复核"}</b></div>`).join("");
  document.querySelector("#fixCurrentOutput").hidden = output.status === "pass";
  document.querySelector("#aiReportDialog").showModal();
}

function repairOutput(output) {
  output.status = "pass";
  output.score = 95;
  output.issue = "风险表达或画面匹配问题已修复并重新检查通过。";
  output.checks = output.checks.map((check) => ({ ...check, passed: true, detail: check.passed ? check.detail : "已修复并重新检查通过" }));
}

function renderExportJobs() {
  const list = document.querySelector("#exportJobList");
  if (!appState.outputs.length) {
    list.innerHTML = '<div class="quality-empty"><span>AI</span><h3>还没有可导出的成片</h3><p>先完成混剪与 AI 质检，通过后才会出现在这里。</p><button class="button primary" data-route="editing">返回成片生产台</button></div>';
    list.querySelector("[data-route]").addEventListener("click", () => navigate("editing"));
    return;
  }
  list.innerHTML = appState.outputs.map((output) => `
    <article class="export-job is-done">
      <div class="export-thumb"><img src="${output.image}" alt="${escapeHtml(output.name)}封面"><span>${output.duration}</span></div>
      <div class="export-copy"><span class="status-pill success">✓ AI 质检通过</span><h3>${escapeHtml(output.name)}</h3><p>1080×1920 · 9:16 · H.264 · 刚刚</p><div class="quality-mini-tags"><span>千问画文检查</span><span>音轨存在</span><span>风险词通过</span><span>平台规格通过</span></div><div class="job-actions"><button data-toast="将在资源管理器中定位成片文件">打开文件位置</button><button data-export-report="${output.id}">查看质检报告</button><button data-open-dialog="previewDialog">播放成片</button><button class="asset-delete" data-delete-export-output="${output.id}">删除</button></div></div>
    </article>`).join("");
  list.querySelectorAll("[data-toast]").forEach((button) => button.addEventListener("click", () => showToast(button.dataset.toast)));
  list.querySelectorAll("[data-export-report]").forEach((button) => button.addEventListener("click", () => openQualityReport(button.dataset.exportReport)));
  list.querySelectorAll('[data-open-dialog="previewDialog"]').forEach((button) => button.addEventListener("click", () => document.querySelector("#previewDialog").showModal()));
  list.querySelectorAll("[data-delete-export-output]").forEach((button) => button.addEventListener("click", () => {
    askConfirm("删除已导出成片记录？", "本地成片文件会移入回收区，质检报告同时删除。", () => {
      const output = appState.outputs.find((item) => item.id === button.dataset.deleteExportOutput);
      if (output?.filePath && window.caiku) window.caiku.trashPath(output.filePath).catch(() => {});
      if (output?.reportPath && window.caiku) window.caiku.trashPath(output.reportPath).catch(() => {});
      if (output?.thumbnailPath && window.caiku) window.caiku.trashPath(output.thumbnailPath).catch(() => {});
      appState.outputs = appState.outputs.filter((item) => item.id !== button.dataset.deleteExportOutput);
      renderExportJobs();
      renderBatchOutputs();
      showToast("成片和质检报告已移入回收区");
    });
  }));
}

document.querySelectorAll("[data-production-step]").forEach((button) => button.addEventListener("click", () => setProductionStep(button.dataset.productionStep)));
document.querySelectorAll("[data-go-production-step]").forEach((button) => button.addEventListener("click", () => setProductionStep(button.dataset.goProductionStep)));
document.querySelectorAll("[data-ai-voice]").forEach((button) => button.addEventListener("click", () => {
  appState.selectedAiVoice = button.dataset.aiVoice;
  document.querySelectorAll("[data-ai-voice]").forEach((item) => item.classList.toggle("is-selected", item === button));
  renderEditing();
  showToast(`正在试听：${appState.selectedAiVoice}`);
}));
document.querySelector("#runScriptPrecheck").addEventListener("click", () => {
  const status = document.querySelector("#scriptPrecheckStatus");
  status.className = "status-pill processing";
  status.textContent = "检查中";
  runProgress("正在执行文案预检", "检查商品描述、风险表达和平台适配…", () => {
    status.className = "status-pill success";
    status.textContent = "✓ 可进入生成";
    showToast("文案预检完成，未发现需要阻断的问题");
  });
});
function setOutputCount(nextValue) {
  appState.outputCount = Math.min(20, Math.max(1, Number(nextValue) || 1));
  renderEditing();
}
document.querySelector("#decreaseOutputCount").addEventListener("click", () => setOutputCount(appState.outputCount - 1));
document.querySelector("#increaseOutputCount").addEventListener("click", () => setOutputCount(appState.outputCount + 1));
document.querySelector("#outputCountInput").addEventListener("change", (event) => setOutputCount(event.target.value));
document.querySelector("#repairAllOutputs").addEventListener("click", () => {
  const risky = appState.outputs.filter((output) => output.status === "risk");
  if (!risky.length) { showToast(appState.outputs.length ? "当前没有需要修复的风险项" : "还没有生成成片", !appState.outputs.length); return; }
  runProgress("正在修复并重新检查", "替换风险表达、重选匹配画面并重新执行四项检查…", () => {
    risky.forEach(repairOutput);
    renderBatchOutputs();
    showToast(`${risky.length} 条成片已修复并通过 AI 质检`);
  });
});
document.querySelector("#fixCurrentOutput").addEventListener("click", () => {
  const output = appState.outputs.find((item) => item.id === appState.currentReportOutputId);
  if (!output) return;
  document.querySelector("#aiReportDialog").close();
  runProgress("正在修复当前成片", "定位风险时间点并重新匹配画面与口播…", () => {
    repairOutput(output);
    renderBatchOutputs();
    showToast("当前成片已修复并重新检查通过");
  });
});
document.querySelector("#exportPassedOutputs").addEventListener("click", () => {
  if (!appState.outputs.length) { showToast("请先生成并完成 AI 质检", true); return; }
  const riskCount = appState.outputs.filter((output) => output.status !== "pass").length;
  if (riskCount) { showToast(`还有 ${riskCount} 条成片未通过，不能导出`, true); return; }
  renderExportJobs();
  navigate("export");
  showToast(`已导出 ${appState.outputs.length} 条 1080×1920 千川成片`);
});

function getAvailablePickerMaterials() {
  const query = materialPickerQuery.trim().toLowerCase();
  return appState.materials.filter((item) => {
    if (appState.editingMaterialIds.includes(item.id)) return false;
    if (materialPickerCategory !== "all" && item.typeLabel !== materialPickerCategory) return false;
    if (!query) return true;
    return [item.name, item.sku, item.typeLabel].some((value) => String(value || "").toLowerCase().includes(query));
  });
}

function updateMaterialPickerActions() {
  const confirmMaterialPicker = document.querySelector("#confirmMaterialPicker");
  confirmMaterialPicker.disabled = materialPickerSelection.size === 0;
  document.querySelector("#materialPickerSelectedCount").textContent = materialPickerSelection.size;
}

function renderMaterialPicker() {
  const available = getAvailablePickerMaterials();
  const list = document.querySelector("#materialPickerList");
  document.querySelector("#materialPickerVisibleCount").textContent = available.length;
  list.innerHTML = available.length ? available.map((material) => `<label class="picker-item"><input type="checkbox" value="${material.id}" ${materialPickerSelection.has(material.id) ? "checked" : ""}><img src="${material.image}" alt=""><span><strong>${escapeHtml(material.name)}</strong><small>${escapeHtml(material.typeLabel)} · ${material.duration.toFixed(2)}s</small></span><span>${escapeHtml(material.sku)}</span></label>`).join("") : '<div class="empty-state"><p>当前条件下没有可添加的素材，请清空筛选后重试。</p></div>';
  list.querySelectorAll("input").forEach((input) => input.addEventListener("change", () => {
    if (input.checked) materialPickerSelection.add(input.value);
    else materialPickerSelection.delete(input.value);
    updateMaterialPickerActions();
  }));
  updateMaterialPickerActions();
}

function openMaterialPicker() {
  materialPickerSelection = new Set();
  materialPickerQuery = "";
  materialPickerCategory = "all";
  document.querySelector("#materialPickerSearch").value = "";
  document.querySelector("#materialPickerCategory").value = "all";
  renderMaterialPicker();
  document.querySelector("#materialPickerDialog").showModal();
}
document.querySelector("#openMaterialPicker").addEventListener("click", openMaterialPicker);
document.querySelector("#materialPickerSearch").addEventListener("input", (event) => {
  materialPickerQuery = event.target.value;
  renderMaterialPicker();
});
document.querySelector("#materialPickerCategory").addEventListener("change", (event) => {
  materialPickerCategory = event.target.value;
  renderMaterialPicker();
});
document.querySelector("#selectAllPickerMaterials").addEventListener("click", () => {
  getAvailablePickerMaterials().forEach((material) => materialPickerSelection.add(material.id));
  renderMaterialPicker();
});
document.querySelector("#clearPickerMaterials").addEventListener("click", () => {
  materialPickerSelection.clear();
  renderMaterialPicker();
});
document.querySelector("#confirmMaterialPicker").addEventListener("click", () => {
  if (!materialPickerSelection.size) { showToast("请先选择至少一个素材", true); return; }
  materialPickerSelection.forEach((id) => appState.editingMaterialIds.push(id));
  document.querySelector("#materialPickerDialog").close();
  renderEditing();
  showToast(`已向时间线添加 ${materialPickerSelection.size} 个素材`);
});

function attachAudioFileInput(inputSelector, kind, defaultMeta) {
  const input = document.querySelector(inputSelector);
  input.addEventListener("change", () => {
    [...input.files].forEach((file, index) => appState[kind].push({ id: `${kind}-${Date.now()}-${index}`, name: file.name, meta: defaultMeta }));
    renderEditing();
    showToast(`已添加 ${input.files.length} 个${kind === "voices" ? "配音" : "音乐"}文件`);
  });
}
document.querySelector("#addVoiceAsset").addEventListener("click", () => document.querySelector("#voiceFileInput").click());
document.querySelector("#addMusicAsset").addEventListener("click", () => document.querySelector("#musicFileInput").click());
attachAudioFileInput("#voiceFileInput", "voices", "手动添加 · 待分析");
attachAudioFileInput("#musicFileInput", "music", "手动添加 · -18 dB");

function renderScriptPicker() {
  scriptPickerSelection = appState.editingScriptId || appState.scripts[0]?.id || "";
  const list = document.querySelector("#scriptPickerList");
  list.innerHTML = appState.scripts.length ? appState.scripts.map((script) => `<label class="picker-item"><input type="radio" name="script-picker" value="${script.id}" ${script.id === scriptPickerSelection ? "checked" : ""}><span class="link-number">${script.blocks.length}</span><span><strong>${escapeHtml(script.name)}</strong><small>${script.duration} 秒 · ${script.blocks.length} 个段落</small></span><span>可用</span></label>`).join("") : '<div class="empty-state"><p>还没有脚本，请先到脚本管理新建。</p></div>';
  list.querySelectorAll("input").forEach((input) => input.addEventListener("change", () => { scriptPickerSelection = input.value; }));
}
document.querySelector("#chooseEditingScript").addEventListener("click", () => { renderScriptPicker(); document.querySelector("#scriptPickerDialog").showModal(); });
document.querySelector("#confirmScriptPicker").addEventListener("click", () => {
  if (!scriptPickerSelection) { showToast("没有可用脚本", true); return; }
  appState.editingScriptId = scriptPickerSelection;
  document.querySelector("#scriptPickerDialog").close();
  renderEditing();
  showToast("剪辑工程已连接新脚本");
});
document.querySelector("#clearEditingScript").addEventListener("click", () => {
  appState.editingScriptId = null;
  renderEditing();
  showToast("脚本引用已从当前工程删除，脚本库内容仍保留");
});

document.querySelector("#renameEditingProject").addEventListener("click", () => document.querySelector("#renameProjectDialog").showModal());
document.querySelector("#confirmRenameProject").addEventListener("click", () => {
  const name = document.querySelector("#editingProjectNameInput").value.trim();
  if (!name) { showToast("工程名称不能为空", true); return; }
  document.querySelector("#editingProjectTitle").textContent = name;
  document.querySelector("#renameProjectDialog").close();
  showToast("成片工程名称已保存");
});
document.querySelector("#playEditingPreview").addEventListener("click", (event) => {
  event.currentTarget.textContent = event.currentTarget.textContent === "▶" ? "Ⅱ" : "▶";
  showToast(event.currentTarget.textContent === "Ⅱ" ? "开始播放成片预览" : "预览已暂停");
});
document.querySelector("#startConnectedMix").addEventListener("click", () => {
  if (window.caiku) return;
  const script = appState.scripts.find((item) => item.id === appState.editingScriptId);
  const needsVoice = Boolean(script && script.voiceMode !== "music_only" && script.blocks.some((block) => block.voiceEnabled !== false));
  if (!script || !appState.editingMaterialIds.length || !appState.editingPlan?.confirmed || isEditingPlanStale() || (needsVoice && !appState.selectedAiVoice && !appState.voices.length) || !appState.music.length) {
    showToast(needsVoice ? "请补齐并确认素材、脚本、AI 剪辑方案、口播声音和音乐" : "请补齐并确认素材、脚本、AI 剪辑方案和音乐", true);
    return;
  }
  runProgress("正在混剪并逐条 AI 质检", `生成 ${appState.outputCount} 条差异化成片，并检查画文、音轨模式、风险词和平台规格…`, () => {
    appState.outputs = Array.from({ length: appState.outputCount }, (_, index) => createQualityOutput(index));
    appState.productionStep = 5;
    renderEditing();
    showMixCompleteDialog(`D:\\抖音素材库\\${currentBatchLabel.textContent.split(" · ")[0]}\\成片`, appState.outputs.length, 0);
    showToast(`${appState.outputCount} 条成片已生成，AI 质检发现 ${appState.outputs.filter((item) => item.status === "risk").length} 条需要修复`);
  });
});

document.querySelectorAll("#planWithAiEditor, #replanWithAiEditor").forEach((button) => button.addEventListener("click", () => {
  if (window.caiku) return;
  const script = appState.scripts.find((item) => item.id === appState.editingScriptId);
  const materials = appState.editingMaterialIds.map((id) => appState.materials.find((item) => item.id === id)).filter(Boolean);
  if (!script || !materials.length) { showToast("请先选择素材和脚本", true); return; }
  appState.editingPlan = {
    id: `preview-plan-${Date.now()}`,
    status: "review",
    scriptId: script.id,
    scriptSnapshot: currentScriptSnapshot(script),
    inputMaterialIds: materials.map((item) => String(item.id)).sort(),
    model: "qwen3.5:latest",
    summary: "浏览器预览方案：桌面版会调用本机 Qwen 根据真实素材能力重新安排",
    confirmed: false,
    decisions: script.blocks.map((block, index) => {
      const material = materials[index % materials.length];
      return { blockId: block.id, blockName: block.name, evidenceStatus: "indirect", selectedMaterialIds: [material.id], unsupportedClaims: [], rewriteRequired: false, reason: "浏览器交互预览", timeline: [{ materialId: material.id, sourceStart: 0, duration: Math.min(Number(block.duration || 2), Number(material.duration || 2)) }] };
    })
  };
  renderAiEditorPlan();
  showToast("已生成交互预览方案；桌面版将使用本机 Qwen");
}));

document.querySelector("#confirmAiEditorPlan").addEventListener("click", () => {
  if (!appState.editingPlan || appState.editingPlan.status === "blocked" || isEditingPlanStale()) {
    showToast("当前计划不能确认，请重新安排", true);
    return;
  }
  appState.editingPlan.confirmed = true;
  appState.editingPlan.confirmedAt = new Date().toISOString();
  renderEditing();
  window.caikuScheduleProjectSave?.();
  showToast("已确认 AI 剪辑方案，可以开始生成");
});

document.querySelector("#viewMixReports").addEventListener("click", () => {
  document.querySelector("#mixCompleteDialog").close();
  navigate("editing");
  setProductionStep(5);
});
document.querySelector("#openMixFolder").addEventListener("click", () => {
  if (!appState.mixOutputDir) { showToast("还没有可打开的混剪输出目录", true); return; }
  if (window.caiku) window.caiku.openPath(appState.mixOutputDir).catch((error) => showToast(error.message || "打开混剪文件夹失败", true));
  else showToast(`将打开 ${appState.mixOutputDir}`);
});

function getActiveScript() {
  return appState.scripts.find((script) => script.id === appState.activeManagedScriptId);
}

function renderCompetitorAnalyses() {
  const list = document.querySelector("#competitorAnalysisList");
  if (!appState.competitorAnalyses.length) {
    list.innerHTML = '<div class="competitor-empty"><strong>还没有竞品视频</strong><small>添加后再开始视觉结构分析；未配置千问时会明确阻止，不生成假结果。</small></div>';
    return;
  }
  list.innerHTML = appState.competitorAnalyses.map((item) => `<article class="competitor-task is-${item.status}">
    <span class="competitor-file-icon">竞</span><span><strong>${escapeHtml(item.name)}</strong><small>${item.status === "ready" ? "等待开始分析" : item.status === "processing" ? "正在识别镜头、可见文字与节奏" : item.status === "done" ? `已生成脚本草稿 · ${escapeHtml(item.scriptName || "未命名")}` : escapeHtml(item.error || "分析失败")}</small></span>
    ${item.status === "ready" || item.status === "failed" ? `<button class="button secondary" data-analyze-competitor="${item.id}">${item.status === "failed" ? "重试" : "开始分析"}</button>` : item.status === "processing" ? '<span class="status-pill processing">分析中</span>' : `<button class="button secondary" data-open-competitor-script="${item.scriptId}">编辑脚本</button>`}
    <button class="asset-delete" data-delete-competitor="${item.id}" aria-label="删除竞品分析记录${escapeHtml(item.name)}">删除记录</button>
  </article>`).join("");
  list.querySelectorAll("[data-analyze-competitor]").forEach((button) => button.addEventListener("click", () => analyzeCompetitor(button.dataset.analyzeCompetitor)));
  list.querySelectorAll("[data-open-competitor-script]").forEach((button) => button.addEventListener("click", () => {
    appState.activeManagedScriptId = button.dataset.openCompetitorScript;
    renderManagedScripts();
    renderScriptEditor();
  }));
  list.querySelectorAll("[data-delete-competitor]").forEach((button) => button.addEventListener("click", () => {
    const item = appState.competitorAnalyses.find((record) => record.id === button.dataset.deleteCompetitor);
    askConfirm(`删除竞品分析记录“${item?.name || "未命名"}”？`, "只移除分析记录和源视频引用，不删除你磁盘上的竞品原文件；已生成脚本仍单独保留。", () => {
      appState.competitorAnalyses = appState.competitorAnalyses.filter((record) => record.id !== button.dataset.deleteCompetitor);
      renderCompetitorAnalyses();
      window.caikuScheduleProjectSave?.();
      showToast("竞品分析记录已删除，原视频文件仍保留");
    });
  }));
}

async function addCompetitorPaths(paths) {
  const videoPaths = [...new Set(paths || [])].filter((filePath) => /\.(mp4|mov|mkv|m4v|webm)$/i.test(filePath || ""));
  let addedCount = 0;
  videoPaths.forEach((filePath) => {
    if (appState.competitorAnalyses.some((item) => item.filePath === filePath)) return;
    appState.competitorAnalyses.push({ id: `competitor-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name: filePath.split(/[\\/]/).pop(), filePath, status: "ready" });
    addedCount += 1;
  });
  renderCompetitorAnalyses();
  window.caikuScheduleProjectSave?.();
  if (addedCount) showToast(`已添加 ${addedCount} 个竞品视频，可开始 AI 分析`);
  else if ((paths || []).length) showToast(videoPaths.length ? "这些竞品视频已经添加" : "请拖入 MP4、MOV、MKV、M4V 或 WebM 视频", true);
  return addedCount;
}

function competitorPathsFromFiles(files) {
  return [...files].map((file) => {
    if (window.caiku?.getPathForFile) return window.caiku.getPathForFile(file);
    return file.path || file.name;
  }).filter(Boolean);
}

async function chooseCompetitorVideo() {
  if (window.caiku) {
    const paths = await window.caiku.selectVideos();
    await addCompetitorPaths(paths);
  } else {
    document.querySelector("#competitorFileInput").click();
  }
}

async function analyzeCompetitor(id) {
  const record = appState.competitorAnalyses.find((item) => item.id === id);
  if (!record) return;
  if (!window.caiku?.analyzeCompetitor) { showToast("竞品 AI 分析只在裁库桌面版中可用", true); return; }
  record.status = "processing";
  record.error = "";
  renderCompetitorAnalyses();
  try {
    const result = await window.caiku.analyzeCompetitor(record.filePath);
    const scriptId = `s-competitor-${Date.now()}`;
    const script = normalizeScript({
      id: scriptId,
      name: result.title || `${record.name} · 竞品结构`,
      duration: Math.max(2, Math.round(Number(result.duration || 30))),
      voiceMode: result.voiceMode || "partial_voice",
      sourceType: "competitor_analysis",
      sourceAnalysisId: record.id,
      editingRecipe: {
        sourceAnalysisId: record.id,
        sourceFileName: record.name,
        sourceDuration: Number(result.duration || 0),
        summary: result.summary || "",
        patterns: result.editingPattern || [],
        visibleTexts: result.visibleTexts || []
      },
      blocks: result.blocks || []
    });
    appState.scripts.push(script);
    appState.activeManagedScriptId = scriptId;
    record.status = "done";
    record.scriptId = scriptId;
    record.scriptName = script.name;
    record.summary = result.summary || "";
    renderCompetitorAnalyses();
    renderManagedScripts();
    renderScriptEditor();
    renderEditing();
    window.caikuScheduleProjectSave?.();
    showToast("竞品视觉结构已生成可编辑脚本草稿");
  } catch (error) {
    record.status = "failed";
    record.error = error.message || "竞品分析失败";
    renderCompetitorAnalyses();
    window.caikuScheduleProjectSave?.();
    showToast(record.error, true);
  }
}

document.querySelector("#addCompetitorButton").addEventListener("click", () => {
  const panel = document.querySelector("#competitorAnalysisPanel");
  panel.hidden = !panel.hidden;
  if (!panel.hidden) renderCompetitorAnalyses();
});
document.querySelector("#chooseCompetitorVideo").addEventListener("click", () => chooseCompetitorVideo().catch((error) => showToast(error.message || "选择竞品视频失败", true)));
const competitorDropZone = document.querySelector("#competitorDropZone");
let competitorDragDepth = 0;
competitorDropZone.addEventListener("click", () => chooseCompetitorVideo().catch((error) => showToast(error.message || "选择竞品视频失败", true)));
competitorDropZone.addEventListener("dragenter", (event) => {
  event.preventDefault();
  competitorDragDepth += 1;
  competitorDropZone.classList.add("is-dragging");
});
competitorDropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
});
competitorDropZone.addEventListener("dragleave", () => {
  competitorDragDepth = Math.max(0, competitorDragDepth - 1);
  if (!competitorDragDepth) competitorDropZone.classList.remove("is-dragging");
});
competitorDropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  competitorDragDepth = 0;
  competitorDropZone.classList.remove("is-dragging");
  addCompetitorPaths(competitorPathsFromFiles(event.dataTransfer?.files || []));
});
document.querySelector("#competitorFileInput").addEventListener("change", (event) => {
  addCompetitorPaths(competitorPathsFromFiles(event.target.files));
  event.target.value = "";
});

function renderManagedScripts() {
  return renderManagedScriptsV12();
  const query = document.querySelector("#scriptSearch").value.trim().toLowerCase();
  const list = document.querySelector("#managedScriptList");
  const visible = appState.scripts.filter((script) => script.name.toLowerCase().includes(query));
  list.innerHTML = visible.length ? visible.map((script) => `<article class="managed-script-card ${script.id === appState.activeManagedScriptId ? "is-selected" : ""}"><button data-select-script="${script.id}"><strong>${escapeHtml(script.name)}</strong><small>${script.duration} 秒 · ${script.blocks.length} 个段落</small></button><button class="asset-delete" data-delete-script="${script.id}" aria-label="删除脚本${escapeHtml(script.name)}">删除</button></article>`).join("") : '<div class="empty-state"><p>没有符合条件的脚本。</p></div>';
  list.querySelectorAll("[data-select-script]").forEach((button) => button.addEventListener("click", () => { appState.activeManagedScriptId = button.dataset.selectScript; renderManagedScripts(); renderScriptEditor(); }));
  list.querySelectorAll("[data-delete-script]").forEach((button) => button.addEventListener("click", () => requestScriptDelete(button.dataset.deleteScript)));
  updateModuleCounts();
}

function renderScriptEditor() {
  return renderScriptEditorV12();
  const script = getActiveScript();
  const panel = document.querySelector(".script-editor-panel");
  panel.hidden = !script;
  if (!script) return;
  document.querySelector("#managedScriptName").value = script.name;
  document.querySelector("#managedScriptDuration").value = `${script.duration} 秒`;
  const list = document.querySelector("#managedBlockList");
  const categories = ["人物穿搭", "细节讲解", "测评讲解", "动作展示", "口播", "其他"];
  list.innerHTML = script.blocks.map((block, index) => `<div class="script-block-row"><span>${index + 1}</span><input data-block-name="${block.id}" value="${escapeHtml(block.name)}" aria-label="段落名称"><select data-block-category="${block.id}" aria-label="素材分类">${categories.map((category) => `<option ${category === block.category ? "selected" : ""}>${category}</option>`).join("")}</select><input type="number" min="2" step="1" data-block-duration="${block.id}" value="${block.duration}" aria-label="段落时长"><textarea data-block-text="${block.id}" aria-label="口播文案" placeholder="填写这一段的口播文案">${escapeHtml(block.text || "")}</textarea><button class="asset-delete" data-delete-block="${block.id}" aria-label="删除段落${escapeHtml(block.name)}">删除</button></div>`).join("");
  list.querySelectorAll("[data-block-name]").forEach((input) => input.addEventListener("input", () => script.blocks.find((block) => block.id === input.dataset.blockName).name = input.value));
  list.querySelectorAll("[data-block-category]").forEach((select) => select.addEventListener("change", () => script.blocks.find((block) => block.id === select.dataset.blockCategory).category = select.value));
  list.querySelectorAll("[data-block-text]").forEach((textarea) => textarea.addEventListener("input", () => script.blocks.find((block) => block.id === textarea.dataset.blockText).text = textarea.value));
  list.querySelectorAll("[data-block-duration]").forEach((input) => input.addEventListener("change", () => {
    const value = Number(input.value);
    if (value < 2) { input.value = 2; showToast("脚本段落不能短于 2 秒", true); }
    script.blocks.find((block) => block.id === input.dataset.blockDuration).duration = Math.max(2, value);
  }));
  list.querySelectorAll("[data-delete-block]").forEach((button) => button.addEventListener("click", () => {
    script.blocks = script.blocks.filter((block) => block.id !== button.dataset.deleteBlock);
    renderScriptEditor();
    renderManagedScripts();
    showToast("脚本段落已删除");
  }));
}

function renderManagedScriptsV12() {
  const query = document.querySelector("#scriptSearch").value.trim().toLowerCase();
  const list = document.querySelector("#managedScriptList");
  const visible = appState.scripts.filter((script) => script.name.toLowerCase().includes(query));
  const modeLabels = { full_voice: "全程口播", partial_voice: "部分口播", music_only: "纯音乐" };
  list.innerHTML = visible.length ? visible.map((script) => `<article class="managed-script-card ${script.id === appState.activeManagedScriptId ? "is-selected" : ""}"><button data-select-script="${script.id}"><strong>${escapeHtml(script.name)}</strong><small>${script.duration} 秒 · ${script.blocks.length} 个时间段 · ${modeLabels[script.voiceMode] || "全程口播"}</small></button><button class="asset-delete" data-delete-script="${script.id}" aria-label="删除脚本${escapeHtml(script.name)}">删除</button></article>`).join("") : '<div class="empty-state"><p>没有符合条件的脚本。</p></div>';
  list.querySelectorAll("[data-select-script]").forEach((button) => button.addEventListener("click", () => {
    appState.activeManagedScriptId = button.dataset.selectScript;
    renderManagedScripts();
    renderScriptEditor();
  }));
  list.querySelectorAll("[data-delete-script]").forEach((button) => button.addEventListener("click", () => requestScriptDelete(button.dataset.deleteScript)));
  updateModuleCounts();
}

function renderScriptEditorV12() {
  const script = getActiveScript();
  const panel = document.querySelector(".script-editor-panel");
  panel.hidden = !script;
  if (!script) return;
  normalizeScript(script);
  document.querySelector("#managedScriptName").value = script.name;
  document.querySelector("#managedScriptDuration").value = `${script.duration} 秒`;
  document.querySelector("#managedVoiceMode").value = script.voiceMode;
  const recipeSummary = document.querySelector("#editingRecipeSummary");
  if (script.editingRecipe) {
    const patterns = Array.isArray(script.editingRecipe.patterns) ? script.editingRecipe.patterns.slice(0, 4) : [];
    recipeSummary.hidden = false;
    recipeSummary.innerHTML = `<span>对标思路</span><div><strong>${escapeHtml(script.editingRecipe.sourceFileName || "竞品视频分析")}</strong><small>${escapeHtml(script.editingRecipe.summary || "已保存镜头角色、节奏与转场思路")}</small>${patterns.length ? `<div>${patterns.map((item) => `<i>${escapeHtml(item)}</i>`).join("")}</div>` : ""}</div>`;
  } else {
    recipeSummary.hidden = true;
    recipeSummary.innerHTML = "";
  }
  const categories = ["人物穿搭", "整体展示", "细节讲解", "测评对比", "动作展示", "口播", "其他"];
  let cursor = 0;
  script.blocks.forEach((block) => { block.start = cursor; cursor += Number(block.duration || 0); });
  const list = document.querySelector("#managedBlockList");
  list.innerHTML = script.blocks.map((block, index) => `<article class="script-block-row">
    <div class="block-header">
      <span class="block-order">${index + 1}</span>
      <div class="block-time"><strong>${formatScriptTime(block.start)} 开始</strong><label>时长 <input type="number" min="2" step="1" data-block-duration-v12="${block.id}" value="${block.duration}" aria-label="${escapeHtml(block.name)}时长"> 秒</label></div>
      <button class="asset-delete" data-delete-block-v12="${block.id}" aria-label="删除段落${escapeHtml(block.name)}">删除段落</button>
    </div>
    <div class="block-fields block-fields-meta">
      <label>段落名称 <input data-block-name-v12="${block.id}" value="${escapeHtml(block.name)}"></label>
      <label>目标素材 <select data-block-category-v12="${block.id}">${categories.map((category) => `<option ${category === block.category ? "selected" : ""}>${category}</option>`).join("")}</select></label>
    </div>
    <div class="block-fields block-fields-copy">
      <label>画面要求 <textarea data-block-visual="${block.id}" placeholder="例如：展示腰头褶皱与侧面垂感">${escapeHtml(block.visualInstruction)}</textarea></label>
      <label>屏幕字幕 <textarea data-block-subtitle="${block.id}" placeholder="允许留空；与口播不是同一个字段">${escapeHtml(block.subtitleText)}</textarea></label>
    </div>
    <label class="block-voice-toggle"><input type="checkbox" data-block-voice-enabled="${block.id}" ${block.voiceEnabled ? "checked" : ""} ${script.voiceMode === "music_only" ? "disabled" : ""}> 本段需要口播</label>
    <div class="block-fields block-fields-copy">
      <label>口播文字 <textarea data-block-voice="${block.id}" placeholder="纯音乐或不口播的段落可以留空" ${block.voiceEnabled && script.voiceMode !== "music_only" ? "" : "disabled"}>${escapeHtml(block.voiceText)}</textarea></label>
      <label>转场与节奏 <textarea data-block-transition="${block.id}" placeholder="例如：按节奏自然切换">${escapeHtml(block.transitionNote)}</textarea></label>
    </div>
  </article>`).join("");
  list.querySelectorAll("[data-block-name-v12]").forEach((input) => input.addEventListener("input", () => script.blocks.find((block) => block.id === input.dataset.blockNameV12).name = input.value));
  list.querySelectorAll("[data-block-category-v12]").forEach((select) => select.addEventListener("change", () => script.blocks.find((block) => block.id === select.dataset.blockCategoryV12).category = select.value));
  list.querySelectorAll("[data-block-visual]").forEach((textarea) => textarea.addEventListener("input", () => script.blocks.find((block) => block.id === textarea.dataset.blockVisual).visualInstruction = textarea.value));
  list.querySelectorAll("[data-block-subtitle]").forEach((textarea) => textarea.addEventListener("input", () => script.blocks.find((block) => block.id === textarea.dataset.blockSubtitle).subtitleText = textarea.value));
  list.querySelectorAll("[data-block-voice]").forEach((textarea) => textarea.addEventListener("input", () => {
    const block = script.blocks.find((item) => item.id === textarea.dataset.blockVoice);
    block.voiceText = textarea.value;
    block.text = textarea.value;
  }));
  list.querySelectorAll("[data-block-transition]").forEach((input) => input.addEventListener("input", () => script.blocks.find((block) => block.id === input.dataset.blockTransition).transitionNote = input.value));
  list.querySelectorAll("[data-block-voice-enabled]").forEach((checkbox) => checkbox.addEventListener("change", () => {
    script.blocks.find((block) => block.id === checkbox.dataset.blockVoiceEnabled).voiceEnabled = checkbox.checked;
    renderScriptEditor();
  }));
  list.querySelectorAll("[data-block-duration-v12]").forEach((input) => input.addEventListener("change", () => {
    const value = Math.max(2, Number(input.value || 2));
    script.blocks.find((block) => block.id === input.dataset.blockDurationV12).duration = value;
    if (Number(input.value) < 2) showToast("脚本段落不能短于 2 秒", true);
    renderScriptEditor();
  }));
  list.querySelectorAll("[data-delete-block-v12]").forEach((button) => button.addEventListener("click", () => {
    const block = script.blocks.find((item) => item.id === button.dataset.deleteBlockV12);
    askConfirm(`删除脚本段落“${block?.name || "未命名段落"}”？`, "只删除当前脚本中的这个时间段，不会删除素材盘文件。", () => {
      script.blocks = script.blocks.filter((item) => item.id !== button.dataset.deleteBlockV12);
      renderScriptEditor();
      renderManagedScripts();
      showToast("脚本段落已删除");
    });
  }));
}

function formatScriptTime(value) {
  const seconds = Math.max(0, Math.round(Number(value || 0)));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function requestScriptDelete(id) {
  const script = appState.scripts.find((item) => item.id === id);
  if (!script) return;
  const isLinked = appState.editingScriptId === id;
  askConfirm(`删除脚本“${script.name}”？`, isLinked ? "该脚本正被成片工程引用，删除后工程会变为“未选择脚本”。" : "脚本会移入软件回收区。", () => {
    appState.scripts = appState.scripts.filter((item) => item.id !== id);
    if (isLinked) appState.editingScriptId = null;
    if (appState.activeManagedScriptId === id) appState.activeManagedScriptId = appState.scripts[0]?.id || null;
    renderManagedScripts();
    renderScriptEditor();
    renderEditing();
    showToast(isLinked ? "脚本已删除，成片工程的脚本引用已清除" : "脚本已删除");
  });
}

document.querySelector("#scriptSearch").addEventListener("input", renderManagedScripts);
document.querySelector("#createScriptButton").addEventListener("click", () => document.querySelector("#newScriptDialog").showModal());
document.querySelector("#confirmNewScript").addEventListener("click", () => {
  const name = document.querySelector("#newScriptName").value.trim();
  if (!name) { showToast("请填写脚本名称", true); return; }
  const duration = Number(document.querySelector("#newScriptDuration").value.replace(" 秒", ""));
  const id = `s-${Date.now()}`;
  appState.scripts.push({ id, name, duration, blocks: [{ id: `b-${Date.now()}`, name: "开场", text: "", category: "人物穿搭", duration: Math.max(2, Math.min(5, duration)) }] });
  appState.activeManagedScriptId = id;
  const createdScript = appState.scripts.find((item) => item.id === id);
  createdScript.voiceMode = document.querySelector("#newScriptVoiceMode").value;
  normalizeScript(createdScript);
  document.querySelector("#newScriptDialog").close();
  document.querySelector("#newScriptName").value = "";
  renderManagedScripts();
  renderScriptEditor();
  renderEditing();
  showToast("新脚本已创建，并同步到剪辑成片");
});
document.querySelector("#addScriptBlock").addEventListener("click", () => {
  const script = getActiveScript();
  if (!script) return;
  script.blocks.push({ id: `b-${Date.now()}`, name: "新段落", text: "", category: "人物穿搭", duration: 5 });
  normalizeScript(script);
  renderScriptEditor();
  renderManagedScripts();
  showToast("已添加脚本段落，每个段落都可删除");
});
document.querySelector("#saveManagedScript").addEventListener("click", () => {
  const script = getActiveScript();
  if (!script) return;
  const name = document.querySelector("#managedScriptName").value.trim();
  if (!name) { showToast("脚本名称不能为空", true); return; }
  script.name = name;
  script.duration = Number(document.querySelector("#managedScriptDuration").value.replace(" 秒", ""));
  script.voiceMode = document.querySelector("#managedVoiceMode").value;
  if (script.voiceMode === "music_only") script.blocks.forEach((block) => { block.voiceEnabled = false; block.voiceText = ""; block.text = ""; });
  const blockDuration = script.blocks.reduce((total, block) => total + Number(block.duration || 0), 0);
  if (blockDuration !== script.duration) showToast(`提示：分段共 ${blockDuration} 秒，目标时长为 ${script.duration} 秒，请继续调整`, true);
  normalizeScript(script);
  renderManagedScripts();
  renderEditing();
  document.querySelector("#scriptSyncState").textContent = "已同步到剪辑成片";
  showToast("脚本已保存并同步到剪辑成片");
});
document.querySelector("#managedVoiceMode").addEventListener("change", (event) => {
  const script = getActiveScript();
  if (!script) return;
  script.voiceMode = event.target.value;
  if (script.voiceMode === "music_only") script.blocks.forEach((block) => { block.voiceEnabled = false; });
  if (script.voiceMode === "full_voice") script.blocks.forEach((block) => { block.voiceEnabled = true; });
  renderScriptEditor();
  renderManagedScripts();
  renderEditing();
});

renderLibrary();
renderEditing();
renderManagedScripts();
renderScriptEditor();
renderCompetitorAnalyses();

// Settings
let updateUiState = {
  phase: "idle",
  currentVersion: "",
  latestVersion: null,
  progress: { percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 },
  message: "点击按钮后检查最新正式版本。",
  isPackaged: Boolean(window.caiku)
};

function formatUpdateBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${Math.round(value)} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function renderUpdateStatus(nextState = {}) {
  updateUiState = { ...updateUiState, ...nextState, progress: { ...updateUiState.progress, ...(nextState.progress || {}) } };
  const phase = updateUiState.phase || "idle";
  const phaseTitles = {
    idle: "准备检查更新",
    checking: "正在检查更新",
    available: "发现新版本",
    latest: "当前已是最新版本",
    downloading: "正在下载更新",
    downloaded: "更新包已准备好",
    error: "更新检查未完成"
  };
  const phaseIcons = { idle: "↑", checking: "…", available: "↓", latest: "✓", downloading: "↓", downloaded: "✓", error: "!" };
  const progress = updateUiState.progress || {};
  const percent = Math.max(0, Math.min(100, Number(progress.percent || 0)));
  document.querySelector("#updateCard").dataset.phase = phase;
  document.querySelector("#currentUpdateVersion").textContent = updateUiState.currentVersion ? `v${updateUiState.currentVersion}` : "读取中";
  document.querySelector("#latestUpdateVersion").textContent = updateUiState.latestVersion ? `v${updateUiState.latestVersion}` : "尚未检查";
  document.querySelector("#updateStatusTitle").textContent = phaseTitles[phase] || "软件更新";
  document.querySelector("#updateStatusIcon").textContent = phaseIcons[phase] || "↑";
  document.querySelector("#updateStatusMessage").textContent = updateUiState.message || "";
  document.querySelector("#updateProgressWrap").hidden = !["downloading", "downloaded"].includes(phase);
  document.querySelector("#updateProgress").value = percent;
  document.querySelector("#updateProgress").textContent = `${Math.round(percent)}%`;
  document.querySelector("#updateProgressLabel").textContent = `${Math.round(percent)}%`;
  document.querySelector("#updateProgressDetail").textContent = progress.total
    ? `${formatUpdateBytes(progress.transferred)} / ${formatUpdateBytes(progress.total)} · ${formatUpdateBytes(progress.bytesPerSecond)}/秒`
    : phase === "downloaded" ? "文件完整性校验已完成" : "正在准备下载…";
  document.querySelector("#checkForUpdatesButton").disabled = ["checking", "downloading"].includes(phase);
  document.querySelector("#checkForUpdatesButton").textContent = phase === "checking" ? "检查中…" : phase === "error" ? "重新检查" : "检查更新";
  document.querySelector("#downloadUpdateButton").disabled = phase !== "available";
  document.querySelector("#downloadUpdateButton").textContent = phase === "downloading" ? "下载中…" : "下载更新";
  document.querySelector("#installUpdateButton").disabled = phase !== "downloaded";
}

window.renderUpdateStatus = renderUpdateStatus;
window.caiku?.onUpdateStatus?.(renderUpdateStatus);

document.querySelector("#checkForUpdatesButton").addEventListener("click", async () => {
  try {
    renderUpdateStatus(await window.caiku.checkForUpdates());
  } catch (error) {
    renderUpdateStatus({ phase: "error", message: error.message, errorCode: error.code || "UPDATE_ERROR" });
  }
});
document.querySelector("#downloadUpdateButton").addEventListener("click", async () => {
  try {
    renderUpdateStatus(await window.caiku.downloadUpdate());
  } catch (error) {
    renderUpdateStatus({ phase: "error", message: error.message, errorCode: error.code || "UPDATE_ERROR" });
  }
});
document.querySelector("#installUpdateButton").addEventListener("click", async () => {
  try {
    await window.caiku.installUpdate();
  } catch (error) {
    renderUpdateStatus({ phase: "error", message: error.message, errorCode: error.code || "UPDATE_ERROR" });
  }
});

document.querySelectorAll("[data-settings-tab]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-settings-tab]").forEach((item) => item.classList.toggle("is-active", item === button));
    document.querySelectorAll("[data-settings-pane]").forEach((pane) => pane.classList.toggle("is-active", pane.dataset.settingsPane === button.dataset.settingsTab));
    const settingsFooter = document.querySelector("#settingsFooter");
    settingsFooter.hidden = ["ai-review", "performance", "export", "updates"].includes(button.dataset.settingsTab);
  });
});
document.querySelector("#saveSettingsButton").addEventListener("click", () => {
  showToast("设置已保存，将用于后续新批次");
  navigate("source");
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    batchMenu.hidden = true;
    batchSwitcher.setAttribute("aria-expanded", "false");
  }
});

updateImportPath();
selectClip(activeClip);

// 允许设计评审或自动化验收直接打开指定模块、步骤与质检演示状态。
const reviewParams = new URLSearchParams(window.location.search);
const requestedModule = reviewParams.get("module");
const requestedStep = Number(reviewParams.get("step"));
const requestedDemo = reviewParams.get("demo");
if (requestedDemo === "review" || requestedDemo === "pass") {
  appState.outputs = Array.from({ length: 4 }, (_, index) => createQualityOutput(index));
  if (requestedDemo === "pass") appState.outputs.forEach(repairOutput);
  renderEditing();
  if (requestedModule === "export") renderExportJobs();
}
if (["source", "library", "editing", "export", "scripts"].includes(requestedModule)) navigate(requestedModule);
if (requestedModule === "editing" && requestedStep >= 1 && requestedStep <= 5) setProductionStep(requestedStep);
