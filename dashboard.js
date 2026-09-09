import { AuthError, TronClassApi } from "./lib/api.js";
import { announcementContent, announcementFingerprint } from "./lib/announcement.js";
import { battleRecordKey, deriveBattleReport, groupReportRecords, reportRecordDescription } from "./lib/battle-report.js";
import { createBattleReportPng } from "./lib/report-image.js";
import { BATTLE_REPORT_CACHE_KEY, DASHBOARD_CACHE_KEY, createBattleReportCache, createDashboardCache, readBattleReportCache, readDashboardCache } from "./lib/cache.js";
import { compareVersions, displayVersion } from "./lib/version.js";
import {
  STATUS_LABELS,
  TYPE_LABELS,
  formatBytes,
  formatDateTime,
  formatRemainingTime,
  remainingTimeUrgency,
  safePathSegment,
  splitCoursesByPlatformTerm
} from "./lib/normalizers.js";

const api = new TronClassApi();
const UI_PREFERENCES_KEY = "uiPreferences";
const PROJECT_URL = "https://github.com/billylicn/cityu-tronplugin";
const LATEST_RELEASE_API = "https://api.github.com/repos/billylicn/cityu-tronplugin/releases/latest";
const STARTUP_ANNOUNCEMENT = Object.freeze({
  label: "功能说明",
  title: "欢迎使用 CityU TronClass Plugin",
  publishedAt: "",
  paragraphs: Object.freeze([
    "CityU TronClass Plugin 会使用你当前的 TronClass 登录状态，在统一界面中整理课程学习信息。"
  ]),
  items: Object.freeze([
    "学习总览：集中查看出勤、待提交作业、其他学习活动和课程文件。",
    "课程直达：可从任务、出勤和文件项目直接打开对应的 TronClass 页面。",
    "刷新与缓存：可以关闭自动刷新并使用上次保存在本机的匿名学习缓存。",
    "城大战绩：由你主动生成全部课程统计，并支持手动排除不参与统计的记录。",
    "结果仅供辅助，请自行以 TronClass 原页面、课程通知及教师要求为准。"
  ]),
  actionLabel: "查看开源项目与使用说明",
  actionUrl: PROJECT_URL
});
const USAGE_ACKNOWLEDGEMENT = "我已知本软件可能出现漏报、错报、重复、延迟或无法读取等情况。我会自行以 TronClass 原页面、课程通知及教师要求为准，并自行承担使用本插件造成的所有后果。";
const DEFAULT_SECTION_ORDER = Object.freeze(["attendance", "tasks", "materials"]);
const DEFAULT_COLLAPSED = Object.freeze({ overview: false, attendance: false, tasks: false, materials: false });
const SECTION_LABELS = Object.freeze({
  overview: "统计面板",
  attendance: "出勤情况",
  tasks: "作业与学习活动",
  materials: "课程文件"
});

const state = {
  student: null,
  courses: [],
  ongoing: [],
  history: [],
  scope: "ongoing",
  historyCourseId: null,
  loadedCourses: [],
  activities: [],
  attendance: [],
  files: [],
  errors: [],
  refreshedAt: null,
  refreshing: false,
  authenticationRequired: false,
  page: "overview",
  battleReport: null,
  rawBattleReport: null,
  hiddenAttendanceKeys: new Set(),
  hiddenHomeworkKeys: new Set(),
  ignoredActivityKeys: new Set(),
  battleReportLoading: false,
  hasDashboardCache: false,
  filters: { taskCourse: "all", taskStatus: "attention", taskType: "all", materialCourse: "all" },
  ui: {
    sectionOrder: [...DEFAULT_SECTION_ORDER],
    defaultCollapsed: { ...DEFAULT_COLLAPSED },
    autoRefresh: true,
    suppressUsageNotice: false,
    ignoredAnnouncementFingerprint: "",
    settingsDraft: null
  }
};

const dom = Object.fromEntries([
  "studentIdentity", "studentName", "studentNumber", "refreshMeta", "refreshButton", "authBanner", "authBannerMessage", "authLoginButton", "authRefreshButton",
  "loginPanel", "loginTitle", "loginMessage", "loginButton", "loginRefreshButton", "loadingPanel",
  "loadingTitle", "loadingDetail", "dashboardContent", "scopeDescription", "historyCourseSelect",
  "courseSummary", "statsGrid", "attendanceGrid", "taskCourseFilter", "taskStatusFilter",
  "taskTypeFilter", "taskList", "hiddenTasksMenu", "hiddenTaskCount", "hiddenTaskList", "restoreAllHiddenTasks", "materialCourseFilter", "materialsList", "errorsSection",
  "errorsList", "toastRegion", "settingsButton", "settingsDialog", "settingsCloseButton",
  "settingsResetButton", "settingsApplyButton", "sectionSettingsList", "autoRefreshToggle", "clearCacheButton", "overviewPage", "battlePage",
  "battleResultActions", "battleRestoreButton", "battleRegenerateButton", "battleShareButton", "battleEmpty", "battleGenerateButton",
  "battleLoading", "battleProgressTitle", "battleProgressDetail", "battleProgressBar", "battleProgressPercent",
  "battleError", "battleErrorMessage", "battleRetryButton", "battleResult", "battleGradeBadge", "battleGrade",
  "battleTitle", "battleIncompleteBadge", "battleRiskRing", "battleRiskValue", "battleStats",
  "battleAttendanceRate", "battleAttendanceMeter", "battleAttendanceHelp", "battleHomeworkRate",
  "battleHomeworkMeter", "battleHomeworkHelp", "battleWarning", "battleFailedCourses", "battleCoverage",
  "battleAbsenceCount", "battleMissingCount", "battleAbsenceRecords", "battleMissingRecords", "usageNoticeDialog",
  "usageNoticeDontShow", "usageNoticeCopyButton", "usageNoticeAcknowledgement", "usageNoticeMatchStatus",
  "usageNoticeConfirmButton", "startupAnnouncementDialog", "startupAnnouncementLabel", "startupAnnouncementPublishedAt",
  "startupAnnouncementTitle", "startupAnnouncementContent", "startupAnnouncementParagraphs", "startupAnnouncementItems",
  "startupAnnouncementProjectButton", "startupAnnouncementDontShow", "startupAnnouncementCloseButton",
  "settingsShowUsageNotice", "settingsResetAnnouncementButton", "currentVersion", "noticeCurrentVersion", "versionCheckStatus",
  "updateNotice", "latestVersion", "updateCurrentVersion"
].map((id) => [id, document.getElementById(id)]));

let usageNoticePromise = null;
let usageNoticeConfirmed = false;
let startupPromptsPromise = null;
let announcementPromise = null;
let activeAnnouncementFingerprint = "";

bindEvents();
void start();

async function start() {
  await loadUiPreferences();
  renderCurrentVersion();
  await showStartupPrompts();
  void checkForUpdates();
  await initialize();
}

function showUsageNotice() {
  const dialog = dom.usageNoticeDialog;
  if (state.ui.suppressUsageNotice || !dialog || typeof dialog.showModal !== "function") return Promise.resolve();
  if (usageNoticePromise) return usageNoticePromise;

  usageNoticeConfirmed = false;
  dom.usageNoticeDontShow.checked = false;
  dom.usageNoticeAcknowledgement.value = "";
  dom.usageNoticeAcknowledgement.disabled = false;
  dom.usageNoticeAcknowledgement.classList.remove("is-matched");
  dom.usageNoticeMatchStatus.textContent = "等待输入完整声明";
  dom.usageNoticeMatchStatus.classList.remove("is-matched");
  dom.usageNoticeConfirmButton.disabled = true;
  usageNoticePromise = new Promise((resolve) => {
    const handleClose = async () => {
      if (!usageNoticeConfirmed) {
        queueMicrotask(() => {
          if (!dialog.open) dialog.showModal();
        });
        return;
      }
      dialog.removeEventListener("close", handleClose);
      if (dom.usageNoticeDontShow.checked) {
        state.ui.suppressUsageNotice = true;
        try {
          await saveUiPreferences();
        } catch (error) {
          state.ui.suppressUsageNotice = false;
          toast(`声明设置保存失败：${error?.message || String(error)}`, true);
        }
      }
      usageNoticePromise = null;
      resolve();
    };
    dialog.addEventListener("close", handleClose);
    if (!dialog.open) dialog.showModal();
  });
  return usageNoticePromise;
}

function showStartupPrompts() {
  if (startupPromptsPromise) return startupPromptsPromise;
  startupPromptsPromise = (async () => {
    await showUsageNotice();
    await showStartupAnnouncement();
  })().finally(() => {
    startupPromptsPromise = null;
  });
  return startupPromptsPromise;
}

async function showStartupAnnouncement() {
  const announcement = announcementContent(STARTUP_ANNOUNCEMENT);
  const dialog = dom.startupAnnouncementDialog;
  if (!announcement || !dialog || typeof dialog.showModal !== "function") return;
  if (announcementPromise) return announcementPromise;

  let fingerprint;
  try {
    fingerprint = await announcementFingerprint(announcement);
  } catch (error) {
    console.warn("无法校验启动通知内容", error);
    return;
  }
  if (!fingerprint || fingerprint === state.ui.ignoredAnnouncementFingerprint) return;

  activeAnnouncementFingerprint = fingerprint;
  renderStartupAnnouncement(announcement);
  dom.startupAnnouncementDontShow.checked = false;

  announcementPromise = new Promise((resolve) => {
    const handleClose = async () => {
      dialog.removeEventListener("close", handleClose);
      const fingerprintToRemember = activeAnnouncementFingerprint;
      const shouldRemember = dom.startupAnnouncementDontShow.checked;
      dom.startupAnnouncementDontShow.checked = false;

      if (shouldRemember && fingerprintToRemember) {
        const previous = state.ui.ignoredAnnouncementFingerprint;
        state.ui.ignoredAnnouncementFingerprint = fingerprintToRemember;
        try {
          await saveUiPreferences();
        } catch (error) {
          state.ui.ignoredAnnouncementFingerprint = previous;
          toast(`通知忽略设置保存失败：${error?.message || String(error)}`, true);
        }
      }

      announcementPromise = null;
      activeAnnouncementFingerprint = "";
      resolve();
    };
    dialog.addEventListener("close", handleClose);
    if (!dialog.open) dialog.showModal();
  });
  return announcementPromise;
}

function renderStartupAnnouncement(announcement) {
  dom.startupAnnouncementLabel.textContent = announcement.label;
  dom.startupAnnouncementLabel.classList.toggle("is-hidden", !announcement.label);

  dom.startupAnnouncementPublishedAt.textContent = announcement.publishedAt;
  dom.startupAnnouncementPublishedAt.classList.toggle("is-hidden", !announcement.publishedAt);
  if (announcement.publishedAt) dom.startupAnnouncementPublishedAt.setAttribute("datetime", announcement.publishedAt);
  else dom.startupAnnouncementPublishedAt.removeAttribute("datetime");

  dom.startupAnnouncementTitle.textContent = announcement.title;
  dom.startupAnnouncementParagraphs.replaceChildren(...announcement.paragraphs.map((content) => {
    const paragraph = document.createElement("p");
    paragraph.textContent = content;
    return paragraph;
  }));
  dom.startupAnnouncementParagraphs.classList.toggle("is-hidden", !announcement.paragraphs.length);

  dom.startupAnnouncementItems.replaceChildren(...announcement.items.map((content) => {
    const item = document.createElement("li");
    item.textContent = content;
    return item;
  }));
  dom.startupAnnouncementItems.classList.toggle("is-hidden", !announcement.items.length);

  dom.startupAnnouncementProjectButton.textContent = announcement.actionLabel;
  dom.startupAnnouncementProjectButton.classList.toggle("is-hidden", !announcement.actionLabel || !announcement.actionUrl);
}

async function restoreStartupAnnouncement() {
  const previous = state.ui.ignoredAnnouncementFingerprint;
  state.ui.ignoredAnnouncementFingerprint = "";
  try {
    await saveUiPreferences();
    dom.settingsResetAnnouncementButton.disabled = true;
    dom.settingsDialog.close();
    await showStartupAnnouncement();
  } catch (error) {
    state.ui.ignoredAnnouncementFingerprint = previous;
    toast(`无法恢复启动通知：${error?.message || String(error)}`, true);
  }
}

async function copyUsageAcknowledgement() {
  try {
    await navigator.clipboard.writeText(USAGE_ACKNOWLEDGEMENT);
    toast("声明已复制，请粘贴到输入框");
  } catch {
    const copyTarget = document.createElement("textarea");
    copyTarget.value = USAGE_ACKNOWLEDGEMENT;
    copyTarget.setAttribute("readonly", "");
    copyTarget.style.position = "fixed";
    copyTarget.style.opacity = "0";
    document.body.append(copyTarget);
    copyTarget.select();
    const copied = document.execCommand?.("copy");
    copyTarget.remove();
    if (copied) toast("声明已复制，请粘贴到输入框");
    else toast("无法自动复制，请手动抄写声明", true);
  }
  dom.usageNoticeAcknowledgement.focus();
}

function handleUsageAcknowledgementInput() {
  const input = dom.usageNoticeAcknowledgement;
  const matched = input.value.trim() === USAGE_ACKNOWLEDGEMENT;
  input.classList.toggle("is-matched", matched);
  dom.usageNoticeMatchStatus.classList.toggle("is-matched", matched);
  dom.usageNoticeMatchStatus.textContent = matched ? "内容一致，请点击确认" : "内容尚未完全一致";
  dom.usageNoticeConfirmButton.disabled = !matched;
}

function confirmUsageNotice() {
  const matched = dom.usageNoticeAcknowledgement.value.trim() === USAGE_ACKNOWLEDGEMENT;
  if (!matched || !dom.usageNoticeDialog.open) {
    handleUsageAcknowledgementInput();
    return;
  }
  usageNoticeConfirmed = true;
  dom.usageNoticeDialog.close();
}

function renderCurrentVersion() {
  const current = displayVersion(globalThis.chrome?.runtime?.getManifest?.().version);
  dom.currentVersion.textContent = current;
  dom.noticeCurrentVersion.textContent = current;
  dom.updateCurrentVersion.textContent = current;
}

async function checkForUpdates() {
  const current = globalThis.chrome?.runtime?.getManifest?.().version;
  if (!current) {
    dom.versionCheckStatus.textContent = "无法读取当前版本";
    return;
  }

  dom.versionCheckStatus.textContent = "正在检查更新…";
  dom.versionCheckStatus.classList.remove("has-update", "is-current");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch(LATEST_RELEASE_API, {
      credentials: "omit",
      cache: "no-store",
      headers: { Accept: "application/vnd.github+json" },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`GitHub 返回 ${response.status}`);
    const release = await response.json();
    const latest = release?.tag_name;
    const comparison = compareVersions(latest, current);
    if (comparison === null) throw new Error("版本号格式无法识别");

    if (comparison > 0) {
      const label = displayVersion(latest);
      dom.latestVersion.textContent = label;
      dom.versionCheckStatus.textContent = `可更新至 ${label}`;
      dom.versionCheckStatus.classList.add("has-update");
      dom.updateNotice.classList.remove("is-hidden");
    } else {
      dom.versionCheckStatus.textContent = "已是最新版";
      dom.versionCheckStatus.classList.add("is-current");
      dom.updateNotice.classList.add("is-hidden");
    }
  } catch (error) {
    dom.versionCheckStatus.textContent = "暂时无法检查更新";
    console.warn("无法检查 GitHub 最新版本", error);
  } finally {
    clearTimeout(timeout);
  }
}

async function initialize() {
  dom.autoRefreshToggle.checked = state.ui.autoRefresh;
  enableCollapsibleSections();
  const cacheLoaded = await loadCaches();
  if (state.ui.autoRefresh) {
    await refresh({ firstLoad: !cacheLoaded });
  } else {
    showCachedOrOfflineEmpty(cacheLoaded);
  }
}

async function loadUiPreferences() {
  const storage = globalThis.chrome?.storage?.local;
  if (!storage) return;
  try {
    const stored = await storage.get(UI_PREFERENCES_KEY);
    const preferences = stored?.[UI_PREFERENCES_KEY];
    if (!preferences || typeof preferences !== "object") return;

    const order = Array.isArray(preferences.sectionOrder)
      ? preferences.sectionOrder.filter((key, index, items) => DEFAULT_SECTION_ORDER.includes(key) && items.indexOf(key) === index)
      : [];
    if (order.length === DEFAULT_SECTION_ORDER.length) state.ui.sectionOrder = order;

    if (typeof preferences.autoRefresh === "boolean") state.ui.autoRefresh = preferences.autoRefresh;
    if (typeof preferences.suppressUsageNotice === "boolean") state.ui.suppressUsageNotice = preferences.suppressUsageNotice;
    if (typeof preferences.ignoredAnnouncementFingerprint === "string" && /^[a-f0-9]{64}$/i.test(preferences.ignoredAnnouncementFingerprint)) {
      state.ui.ignoredAnnouncementFingerprint = preferences.ignoredAnnouncementFingerprint.toLowerCase();
    }

    if (Array.isArray(preferences.ignoredActivityKeys)) {
      state.ignoredActivityKeys = new Set(preferences.ignoredActivityKeys
        .filter((key) => typeof key === "string" && key.length > 0 && key.length <= 160)
        .slice(0, 5000));
    }

    if (preferences.defaultCollapsed && typeof preferences.defaultCollapsed === "object") {
      for (const key of Object.keys(DEFAULT_COLLAPSED)) {
        if (typeof preferences.defaultCollapsed[key] === "boolean") {
          state.ui.defaultCollapsed[key] = preferences.defaultCollapsed[key];
        }
      }
    }
  } catch (error) {
    console.warn("无法读取页面布局设置", error);
  }
}

async function saveUiPreferences() {
  const storage = globalThis.chrome?.storage?.local;
  if (!storage) throw new Error("当前环境不支持保存页面设置");
  await storage.set({
    [UI_PREFERENCES_KEY]: {
      sectionOrder: [...state.ui.sectionOrder],
      defaultCollapsed: { ...state.ui.defaultCollapsed },
      autoRefresh: state.ui.autoRefresh,
      suppressUsageNotice: state.ui.suppressUsageNotice,
      ignoredAnnouncementFingerprint: state.ui.ignoredAnnouncementFingerprint,
      ignoredActivityKeys: [...state.ignoredActivityKeys]
    }
  });
}


async function loadCaches() {
  const storage = globalThis.chrome?.storage?.local;
  if (!storage) return false;
  try {
    const stored = await storage.get([DASHBOARD_CACHE_KEY, BATTLE_REPORT_CACHE_KEY]);
    const dashboardCache = readDashboardCache(stored?.[DASHBOARD_CACHE_KEY]);
    const battleCache = readBattleReportCache(stored?.[BATTLE_REPORT_CACHE_KEY]);
    if (dashboardCache) applyDashboardCache(dashboardCache);
    if (battleCache) {
      state.rawBattleReport = battleCache.rawReport;
      state.hiddenAttendanceKeys = new Set(battleCache.hiddenAttendanceKeys);
      state.hiddenHomeworkKeys = new Set(battleCache.hiddenHomeworkKeys);
      state.battleReport = deriveBattleReport(state.rawBattleReport, battleExclusions());
      dom.battleEmpty.classList.add("is-hidden");
      renderBattleReport(state.battleReport);
    }
    return Boolean(dashboardCache || battleCache);
  } catch (error) {
    console.warn("无法读取本地缓存", error);
    await clearInvalidCaches();
    return false;
  }
}

function applyDashboardCache(cache) {
  state.dashboardCache = cache;
  state.hasDashboardCache = true;
  state.student = null;
  renderStudentIdentity();
  state.scope = cache.scope;
  state.historyCourseId = cache.historyCourseId;
  state.courses = cache.courses;
  ({ ongoing: state.ongoing, history: state.history } = splitCoursesByPlatformTerm(state.courses));
  state.loadedCourses = cache.loadedCourses;
  state.activities = cache.activities;
  state.attendance = cache.attendance;
  state.files = cache.files;
  state.errors = cache.errors;
  state.refreshedAt = cache.refreshedAt ? new Date(cache.refreshedAt) : null;
  document.querySelectorAll(".scope-button").forEach((button) => button.classList.toggle("is-active", button.dataset.scope === state.scope));
  updateScopeControls();
  resetFiltersForCourses(state.loadedCourses);
  dom.loginPanel.classList.add("is-hidden");
  dom.loadingPanel.classList.add("is-hidden");
  dom.dashboardContent.classList.remove("is-hidden");
  renderAll();
  renderCacheTime(cache.savedAt || cache.refreshedAt);
}

function showCachedOrOfflineEmpty(cacheLoaded) {
  dom.loadingPanel.classList.add("is-hidden");
  if (state.hasDashboardCache) {
    dom.dashboardContent.classList.remove("is-hidden");
    return;
  }
  dom.dashboardContent.classList.add("is-hidden");
  dom.authBanner.classList.add("is-hidden");
  dom.loginPanel.classList.remove("is-hidden");
  dom.loginTitle.textContent = "暂无上次数据";
  dom.loginMessage.textContent = cacheLoaded
    ? "学习总览没有上次缓存。自动刷新已关闭，点击“刷新数据”后才会读取 TronClass。"
    : "自动刷新已关闭，且当前没有上次数据。点击“刷新数据”手动读取 TronClass。";
  dom.refreshMeta.textContent = "自动刷新已关闭";
}

function showOfflineScopeEmpty() {
  state.student = null;
  renderStudentIdentity();
  state.loadedCourses = [];
  state.activities = [];
  state.attendance = [];
  state.files = [];
  state.errors = [];
  dom.loadingPanel.classList.add("is-hidden");
  dom.dashboardContent.classList.remove("is-hidden");
  resetFiltersForCourses([]);
  renderAll();
  dom.refreshMeta.textContent = "该范围暂无缓存 · 点击刷新数据读取";
}

function renderCacheTime(value) {
  const date = value ? new Date(value) : null;
  dom.refreshMeta.textContent = date && !Number.isNaN(date.getTime())
    ? `本地缓存于 ${formatFullDateTime(date)}`
    : "正在使用本地缓存";
}

async function saveDashboardCache() {
  const storage = globalThis.chrome?.storage?.local;
  if (!storage) return;
  const cache = createDashboardCache(state);
  await storage.set({ [DASHBOARD_CACHE_KEY]: cache });
  state.dashboardCache = cache;
  state.hasDashboardCache = true;
}

async function saveBattleReportCache() {
  const storage = globalThis.chrome?.storage?.local;
  if (!storage || !state.rawBattleReport) return;
  await storage.set({
    [BATTLE_REPORT_CACHE_KEY]: createBattleReportCache(
      state.rawBattleReport,
      [...state.hiddenAttendanceKeys],
      [...state.hiddenHomeworkKeys]
    )
  });
}

async function clearInvalidCaches() {
  const storage = globalThis.chrome?.storage?.local;
  try { await storage?.remove?.([DASHBOARD_CACHE_KEY, BATTLE_REPORT_CACHE_KEY]); } catch { /* ignore */ }
}

function battleExclusions() {
  return {
    hiddenAttendanceKeys: [...state.hiddenAttendanceKeys],
    hiddenHomeworkKeys: [...state.hiddenHomeworkKeys]
  };
}

function enableCollapsibleSections() {
  document.querySelectorAll("#dashboardContent > section").forEach((section) => {
    const heading = section.querySelector(":scope > .section-heading");
    if (!heading || section.querySelector(":scope > .section-body")) return;

    const body = element("div", "section-body");
    while (heading.nextSibling) body.append(heading.nextSibling);
    section.append(body);

    const summary = element("span", "section-collapse-summary", "暂无数据");
    heading.append(summary);

    const toggle = button("收起", "button section-toggle button-small", () => {
      setSectionCollapsed(section, !section.classList.contains("is-collapsed"));
    });
    toggle.setAttribute("aria-expanded", "true");
    toggle.setAttribute("aria-label", `折叠或展开${heading.querySelector("h2")?.textContent || "此区域"}`);
    heading.append(toggle);

    const sectionKey = section.dataset.sectionKey;
    setSectionCollapsed(section, Boolean(state.ui.defaultCollapsed[sectionKey]));
  });
  applySectionOrder();
}

function setSectionCollapsed(section, collapsed) {
  const body = section.querySelector(":scope > .section-body");
  const toggle = section.querySelector(":scope > .section-heading .section-toggle");
  if (!body || !toggle) return;
  body.classList.toggle("is-collapsed", collapsed);
  section.classList.toggle("is-collapsed", collapsed);
  toggle.textContent = collapsed ? "展开" : "收起";
  toggle.setAttribute("aria-expanded", String(!collapsed));
}

function openSettings() {
  state.ui.settingsDraft = {
    sectionOrder: [...state.ui.sectionOrder],
    defaultCollapsed: { ...state.ui.defaultCollapsed },
    suppressUsageNotice: state.ui.suppressUsageNotice
  };
  dom.settingsShowUsageNotice.checked = !state.ui.settingsDraft.suppressUsageNotice;
  dom.settingsResetAnnouncementButton.disabled = !state.ui.ignoredAnnouncementFingerprint;
  renderSectionSettings();
  dom.settingsDialog.showModal();
}

function renderSectionSettings() {
  const draft = state.ui.settingsDraft;
  if (!draft) return;
  const orderedKeys = ["overview", ...draft.sectionOrder];
  dom.sectionSettingsList.replaceChildren(...orderedKeys.map((key) => {
    const row = element("div", "section-setting-row", undefined, { "data-section-key": key });
    const orderControls = element("div", "section-order-controls");
    if (key === "overview") {
      orderControls.append(element("span", "fixed-order-label", "固定在首位"));
    } else {
      const index = draft.sectionOrder.indexOf(key);
      const up = button("上移", "button button-secondary button-small", () => moveSettingsSection(key, -1));
      const down = button("下移", "button button-secondary button-small", () => moveSettingsSection(key, 1));
      up.disabled = index === 0;
      down.disabled = index === draft.sectionOrder.length - 1;
      orderControls.append(up, down);
    }

    const label = element("strong", "section-setting-name", SECTION_LABELS[key]);
    const foldLabel = element("label", "fold-setting");
    const checkbox = element("input", "", undefined, { type: "checkbox" });
    checkbox.checked = Boolean(draft.defaultCollapsed[key]);
    checkbox.addEventListener("change", () => { draft.defaultCollapsed[key] = checkbox.checked; });
    foldLabel.append(checkbox, document.createTextNode("默认折叠"));
    row.append(label, orderControls, foldLabel);
    return row;
  }));
}

function moveSettingsSection(key, offset) {
  const order = state.ui.settingsDraft?.sectionOrder;
  if (!order) return;
  const index = order.indexOf(key);
  const nextIndex = index + offset;
  if (index < 0 || nextIndex < 0 || nextIndex >= order.length) return;
  [order[index], order[nextIndex]] = [order[nextIndex], order[index]];
  renderSectionSettings();
}

function resetSettingsDraft() {
  state.ui.settingsDraft = {
    sectionOrder: [...DEFAULT_SECTION_ORDER],
    defaultCollapsed: { ...DEFAULT_COLLAPSED },
    suppressUsageNotice: false
  };
  dom.settingsShowUsageNotice.checked = true;
  renderSectionSettings();
}

async function applySettings() {
  const draft = state.ui.settingsDraft;
  if (!draft) return;
  state.ui.sectionOrder = [...draft.sectionOrder];
  state.ui.defaultCollapsed = { ...draft.defaultCollapsed };
  state.ui.suppressUsageNotice = !dom.settingsShowUsageNotice.checked;
  applySectionOrder();
  for (const [key, collapsed] of Object.entries(state.ui.defaultCollapsed)) {
    const section = document.querySelector(`#dashboardContent > section[data-section-key="${key}"]`);
    if (section) setSectionCollapsed(section, collapsed);
  }
  try {
    await saveUiPreferences();
    dom.settingsDialog.close();
    toast("页面设置已保存，将长期生效");
  } catch (error) {
    toast(`页面设置已应用，但保存失败：${error?.message || String(error)}`, true);
  }
}

async function clearStoredData() {
  const storage = globalThis.chrome?.storage?.local;
  try {
    await storage?.remove?.([DASHBOARD_CACHE_KEY, BATTLE_REPORT_CACHE_KEY]);
    state.dashboardCache = null;
    state.hasDashboardCache = false;
    state.hiddenAttendanceKeys.clear();
    state.hiddenHomeworkKeys.clear();
    state.ignoredActivityKeys.clear();
    await saveUiPreferences();
    renderOverview();
    renderTasks();
    renderSectionSummaries();
    if (state.rawBattleReport) {
      state.battleReport = deriveBattleReport(state.rawBattleReport, battleExclusions());
      renderBattleReport(state.battleReport);
    }
    toast("上次数据已清除；当前页面内容会保留到关闭或重新加载");
  } catch (error) {
    toast(`清除失败：${error?.message || String(error)}`, true);
  }
}

function applySectionOrder() {
  const container = dom.dashboardContent;
  const errors = container.querySelector(':scope > section[data-section-key="errors"]');
  for (const key of state.ui.sectionOrder) {
    const section = container.querySelector(`:scope > section[data-section-key="${key}"]`);
    if (section) container.insertBefore(section, errors || null);
  }
}

function bindEvents() {
  document.querySelectorAll(".side-nav-button").forEach((navButton) => {
    navButton.addEventListener("click", () => switchPage(navButton.dataset.page));
  });
  dom.battleGenerateButton.addEventListener("click", generateBattleReport);
  dom.battleRestoreButton.addEventListener("click", restoreFullBattleReport);
  dom.battleRegenerateButton.addEventListener("click", generateBattleReport);
  dom.battleRetryButton.addEventListener("click", generateBattleReport);
  dom.battleShareButton.addEventListener("click", (event) => shareBattleReport(event.currentTarget));
  dom.refreshButton.addEventListener("click", () => refresh({ firstLoad: false }));
  dom.loginButton.addEventListener("click", () => openUrl("https://tronclass.cityu.edu.mo/"));
  dom.loginRefreshButton.addEventListener("click", () => refresh({ firstLoad: false }));
  dom.authLoginButton.addEventListener("click", () => openUrl("https://tronclass.cityu.edu.mo/"));
  dom.authRefreshButton.addEventListener("click", () => refresh({ firstLoad: false }));

  document.querySelectorAll(".scope-button").forEach((button) => {
    button.addEventListener("click", async () => {
      if (state.refreshing || state.scope === button.dataset.scope) return;
      state.scope = button.dataset.scope;
      document.querySelectorAll(".scope-button").forEach((item) => item.classList.toggle("is-active", item === button));
      updateScopeControls();
      if (!state.ui.autoRefresh) {
        if (dashboardCacheMatchesScope()) applyDashboardCache(state.dashboardCache);
        else showOfflineScopeEmpty();
        return;
      }
      if (state.authenticationRequired) await refresh({ firstLoad: false });
      else await loadSelectedCourses();
    });
  });

  dom.historyCourseSelect.addEventListener("change", async () => {
    state.historyCourseId = Number(dom.historyCourseSelect.value);
    if (!state.ui.autoRefresh) {
      if (dashboardCacheMatchesScope()) applyDashboardCache(state.dashboardCache);
      else showOfflineScopeEmpty();
      return;
    }
    if (state.authenticationRequired) await refresh({ firstLoad: false });
    else await loadSelectedCourses();
  });
  dom.taskCourseFilter.addEventListener("change", () => { state.filters.taskCourse = dom.taskCourseFilter.value; renderTasks(); });
  dom.taskStatusFilter.addEventListener("change", () => { state.filters.taskStatus = dom.taskStatusFilter.value; renderTasks(); });
  dom.taskTypeFilter.addEventListener("change", () => { state.filters.taskType = dom.taskTypeFilter.value; renderTasks(); });
  dom.restoreAllHiddenTasks.addEventListener("click", restoreAllIgnoredActivities);
  dom.materialCourseFilter.addEventListener("change", () => { state.filters.materialCourse = dom.materialCourseFilter.value; renderMaterials(); });
  dom.settingsButton.addEventListener("click", openSettings);
  dom.settingsCloseButton.addEventListener("click", () => dom.settingsDialog.close());
  dom.settingsResetButton.addEventListener("click", resetSettingsDraft);
  dom.settingsApplyButton.addEventListener("click", applySettings);
  dom.settingsShowUsageNotice.addEventListener("change", () => {
    if (state.ui.settingsDraft) state.ui.settingsDraft.suppressUsageNotice = !dom.settingsShowUsageNotice.checked;
  });
  dom.settingsResetAnnouncementButton.addEventListener("click", restoreStartupAnnouncement);
  dom.clearCacheButton.addEventListener("click", clearStoredData);
  dom.autoRefreshToggle.addEventListener("change", handleAutoRefreshToggle);
  dom.settingsDialog.addEventListener("click", (event) => {
    if (event.target === dom.settingsDialog) dom.settingsDialog.close();
  });
  dom.usageNoticeDialog.addEventListener("cancel", (event) => event.preventDefault());
  dom.usageNoticeCopyButton.addEventListener("click", copyUsageAcknowledgement);
  dom.usageNoticeAcknowledgement.addEventListener("input", handleUsageAcknowledgementInput);
  dom.usageNoticeConfirmButton.addEventListener("click", confirmUsageNotice);
  dom.startupAnnouncementProjectButton.addEventListener("click", () => {
    const announcement = announcementContent(STARTUP_ANNOUNCEMENT);
    if (announcement?.actionUrl) openUrl(announcement.actionUrl);
  });
  dom.startupAnnouncementCloseButton.addEventListener("click", () => dom.startupAnnouncementDialog.close());
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "SHOW_STARTUP_PROMPTS") return false;
    if (dom.settingsDialog.open) dom.settingsDialog.close();
    showStartupPrompts().then(() => sendResponse({ ok: true }));
    return true;
  });
}


async function handleAutoRefreshToggle() {
  const previous = state.ui.autoRefresh;
  const enabled = dom.autoRefreshToggle.checked;
  state.ui.autoRefresh = enabled;
  try {
    await saveUiPreferences();
    toast(enabled ? "自动刷新已开启" : "自动刷新已关闭；进入插件时将直接使用上次缓存");
    if (enabled && !previous) await refresh({ firstLoad: !state.hasDashboardCache });
  } catch (error) {
    state.ui.autoRefresh = previous;
    dom.autoRefreshToggle.checked = previous;
    toast(`自动刷新设置保存失败：${error?.message || String(error)}`, true);
  }
}

function dashboardCacheMatchesScope() {
  if (!state.dashboardCache || state.dashboardCache.scope !== state.scope) return false;
  return state.scope !== "history" || Number(state.dashboardCache.historyCourseId) === Number(state.historyCourseId);
}

function switchPage(page) {
  if (!['overview', 'battle'].includes(page)) return;
  state.page = page;
  dom.overviewPage.classList.toggle("is-hidden", page !== "overview");
  dom.battlePage.classList.toggle("is-hidden", page !== "battle");
  document.querySelectorAll(".side-nav-button").forEach((navButton) => {
    const active = navButton.dataset.page === page;
    navButton.classList.toggle("is-active", active);
    if (active) navButton.setAttribute("aria-current", "page");
    else navButton.removeAttribute("aria-current");
  });
  document.querySelectorAll(".overview-action").forEach((node) => node.classList.toggle("is-hidden", page !== "overview"));
}

async function generateBattleReport() {
  if (state.battleReportLoading) return;
  state.battleReportLoading = true;
  state.hiddenAttendanceKeys.clear();
  state.hiddenHomeworkKeys.clear();
  if (state.rawBattleReport) await saveBattleReportCache().catch(() => {});
  dom.battleEmpty.classList.add("is-hidden");
  dom.battleError.classList.add("is-hidden");
  dom.battleResult.classList.add("is-hidden");
  dom.battleResultActions.classList.add("is-hidden");
  dom.battleLoading.classList.remove("is-hidden");
  updateBattleProgress(0, 0, null);

  try {
    if (!state.courses.length) {
      dom.battleProgressTitle.textContent = "正在读取全部课程…";
      state.courses = await api.getCourses();
      ({ ongoing: state.ongoing, history: state.history } = splitCoursesByPlatformTerm(state.courses));
      updateScopeControls();
    }
    if (!state.student?.internalUserId) {
      dom.battleProgressTitle.textContent = "正在确认当前登录账号…";
      state.student = await api.getCurrentStudent();
      renderStudentIdentity();
    }

    state.rawBattleReport = await api.loadBattleReportCourses(state.courses, {
      internalUserId: state.student.internalUserId,
      onProgress: ({ completed, total, course, errors }) => updateBattleProgress(completed, total, course, errors)
    });
    state.battleReport = deriveBattleReport(state.rawBattleReport, battleExclusions());
    await saveBattleReportCache();
    dom.battleLoading.classList.add("is-hidden");
    renderBattleReport(state.battleReport);
  } catch (error) {
    state.battleReport = null;
    state.rawBattleReport = null;
    dom.battleLoading.classList.add("is-hidden");
    dom.battleError.classList.remove("is-hidden");
    dom.battleErrorMessage.textContent = error instanceof AuthError
      ? `${error.message}。请先登录 TronClass，再重新生成。`
      : `读取失败：${error?.message || String(error)}。已停止本次扫描，请稍后重试。`;
  } finally {
    state.battleReportLoading = false;
  }
}

function updateBattleProgress(completed, total, course, errors = []) {
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  dom.battleProgressBar.style.width = `${percent}%`;
  dom.battleProgressPercent.textContent = `${percent}%`;
  dom.battleLoading.querySelector("[role=progressbar]")?.setAttribute("aria-valuenow", String(percent));
  if (!total) {
    dom.battleProgressTitle.textContent = "正在准备课程列表…";
    dom.battleProgressDetail.textContent = "报告只读取作业和考勤数据。";
    return;
  }
  dom.battleProgressTitle.textContent = `已读取 ${completed}/${total} 门课程`;
  dom.battleProgressDetail.textContent = course
    ? `${course.name}${errors.length ? " · 部分数据读取失败，仍将继续" : " · 读取完成"}`
    : "正在以 2 门课程的小并发扫描…";
}

function renderBattleReport(report) {
  const colors = battleGradeColors(report.grade);
  dom.battleResult.style.setProperty("--grade-a", colors[0]);
  dom.battleResult.style.setProperty("--grade-b", colors[1]);
  dom.battleGrade.textContent = report.grade || "—";
  dom.battleTitle.textContent = report.title;
  dom.battleIncompleteBadge.classList.toggle("is-hidden", !report.incomplete);
  dom.battleRestoreButton.disabled = state.hiddenAttendanceKeys.size === 0 && state.hiddenHomeworkKeys.size === 0;

  const gaugeValue = Number.isFinite(report.riskRate) ? Math.min(100, report.riskRate / 0.2 * 100) : 0;
  dom.battleRiskRing.style.setProperty("--risk", prefersReducedMotion() ? gaugeValue : 0);
  dom.battleRiskValue.textContent = formatPercent(report.riskRate);

  const stats = [
    ["已提交作业", report.homework.submitted, `全部课程共 ${report.homework.total} 个普通作业`],
    ["拍卡次数", report.attendance.punched, `出席 ${report.attendance.present} · 迟到 ${report.attendance.late}`],
    ["缺勤次数", report.attendance.absenceTotal, `缺席 ${report.attendance.absent} · 事假 ${report.attendance.personalLeave} · 病假 ${report.attendance.sickLeave}`],
    ["缺交作业", report.homework.missing, `已到期 ${report.homework.due} 个作业`]
  ];
  dom.battleStats.replaceChildren(...stats.map(([label, value, help]) => {
    const card = element("article", "battle-stat-card");
    const number = element("strong", "battle-animated-number", "0");
    card.append(element("span", "", label), number, element("small", "", help));
    animateInteger(number, value);
    return card;
  }));

  dom.battleAttendanceRate.textContent = formatPercent(report.attendance.absenceRate);
  dom.battleHomeworkRate.textContent = formatPercent(report.homework.missingRate);
  dom.battleAttendanceHelp.textContent = report.attendance.validTotal
    ? `${report.attendance.absenceTotal} 次缺勤 ÷ ${report.attendance.validTotal} 次有效考勤${report.attendance.unknown ? `；另有 ${report.attendance.unknown} 条未知状态未计入` : ""}`
    : `没有有效考勤分母${report.attendance.unknown ? `；${report.attendance.unknown} 条未知状态未计入` : ""}`;
  dom.battleHomeworkHelp.textContent = report.homework.due
    ? `${report.homework.missing} 个缺交 ÷ ${report.homework.due} 个已到期普通作业`
    : "没有具有明确截止时间且已经到期的普通作业";

  const attendanceWidth = rateMeterWidth(report.attendance.absenceRate);
  const homeworkWidth = rateMeterWidth(report.homework.missingRate);
  dom.battleAttendanceMeter.style.width = prefersReducedMotion() ? `${attendanceWidth}%` : "0%";
  dom.battleHomeworkMeter.style.width = prefersReducedMotion() ? `${homeworkWidth}%` : "0%";

  dom.battleWarning.classList.toggle("is-hidden", !report.incomplete);
  dom.battleFailedCourses.replaceChildren(...report.failedCourses.map((course) =>
    element("li", "", `${course.courseName}：${course.message}`)
  ));
  dom.battleCoverage.textContent = `覆盖 ${report.courseCount} 门课程 · 完整读取 ${report.successfulCourseCount} 门 · 生成于 ${formatFullDateTime(report.generatedAt)}`;
  dom.battleAbsenceCount.textContent = String(report.attendance.absenceTotal);
  dom.battleMissingCount.textContent = String(report.homework.missing);
  renderBattleRecordGroups(dom.battleAbsenceRecords, report.attendance.absenceRecords, "attendance");
  renderBattleRecordGroups(dom.battleMissingRecords, report.homework.missingRecords, "homework");

  dom.battleResult.classList.remove("is-hidden");
  dom.battleResultActions.classList.remove("is-hidden");
  requestAnimationFrame(() => requestAnimationFrame(() => {
    dom.battleRiskRing.style.setProperty("--risk", gaugeValue);
    dom.battleAttendanceMeter.style.width = `${attendanceWidth}%`;
    dom.battleHomeworkMeter.style.width = `${homeworkWidth}%`;
  }));
}

function renderBattleRecordGroups(container, records, type) {
  if (!records.length) {
    container.replaceChildren(emptyState(type === "attendance" ? "没有缺勤记录" : "没有缺交记录", type === "attendance" ? "当前统计中没有缺席、事假或病假。" : "当前统计中没有到期未交的普通作业。"));
    return;
  }
  const groups = groupReportRecords(records);
  container.replaceChildren(...groups.map((group, index) => {
    const details = element("details", "battle-record-group");
    if (index === 0) details.open = true;
    const summary = element("summary");
    summary.append(element("span", "", group.courseName), element("strong", "", `${group.records.length} 条`));
    const list = element("ul");
    list.append(...group.records.map((record) => {
      const row = element("li", "battle-record-row");
      const text = element("div");
      const description = reportRecordDescription(record, type);
      text.append(element("strong", "", type === "attendance" ? (record.detail || record.label || "缺勤") : record.title), element("span", "", description));
      const actions = element("div", "battle-record-actions");
      actions.append(
        button(type === "attendance" ? "查看出勤" : "查看作业", "button button-link button-small", () => openUrl(record.directUrl)),
        button("从统计中排除", "button button-link button-small danger-link", () => excludeBattleRecord(record, type))
      );
      row.append(text, actions);
      return row;
    }));
    details.append(summary, list);
    return details;
  }));
}

async function excludeBattleRecord(record, type) {
  if (!state.rawBattleReport) return;
  const key = record.recordKey || battleRecordKey(record, type);
  const target = type === "attendance" ? state.hiddenAttendanceKeys : state.hiddenHomeworkKeys;
  if (target.has(key)) return;
  target.add(key);
  refreshDerivedBattleReport();
  await saveBattleReportCache().catch((error) => console.warn("无法保存战绩排除状态", error));
  toast(type === "attendance" ? "该缺勤记录已从统计中排除" : "该缺交作业已从统计中排除", false, {
    label: "撤销",
    handler: () => undoBattleExclusion(key, type)
  });
}

async function undoBattleExclusion(key, type) {
  const target = type === "attendance" ? state.hiddenAttendanceKeys : state.hiddenHomeworkKeys;
  if (!target.delete(key)) return;
  refreshDerivedBattleReport();
  await saveBattleReportCache().catch((error) => console.warn("无法保存战绩排除状态", error));
}

async function restoreFullBattleReport() {
  if (!state.rawBattleReport || (state.hiddenAttendanceKeys.size === 0 && state.hiddenHomeworkKeys.size === 0)) return;
  state.hiddenAttendanceKeys.clear();
  state.hiddenHomeworkKeys.clear();
  refreshDerivedBattleReport();
  await saveBattleReportCache().catch((error) => console.warn("无法保存战绩排除状态", error));
  toast("已恢复完整统计");
}

function refreshDerivedBattleReport() {
  state.battleReport = deriveBattleReport(state.rawBattleReport, battleExclusions());
  if (state.battleReport) renderBattleReport(state.battleReport);
}

async function shareBattleReport(target) {
  if (!state.battleReport) return;
  await withBusyButton(target, "正在生成…", async () => {
    const { blob, filename } = await createBattleReportPng(state.battleReport);
    let shared = false;
    if (globalThis.File && navigator.share && navigator.canShare) {
      const file = new File([blob], filename, { type: "image/png" });
      try {
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ title: "我的城大战绩", text: "城大 TronClass 匿名学习报告", files: [file] });
          shared = true;
        }
      } catch {
        shared = false;
      }
    }
    if (!shared) {
      downloadBlob(blob, filename);
      toast("分享图已生成并下载");
    }
  });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

function animateInteger(node, target) {
  const value = Number(target) || 0;
  if (prefersReducedMotion() || value === 0) {
    node.textContent = String(value);
    return;
  }
  const startedAt = performance.now();
  const duration = 720;
  const tick = (now) => {
    const progress = Math.min(1, (now - startedAt) / duration);
    const eased = 1 - (1 - progress) ** 3;
    node.textContent = String(Math.round(value * eased));
    if (progress < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function battleGradeColors(grade) {
  return ({
    SSS: ["#43d9b1", "#4f7cff"], SS: ["#42d7f5", "#5966ff"], S: ["#55d68b", "#18a06e"],
    A: ["#ffd56a", "#ff9b4a"], B: ["#ffb35c", "#f17848"], C: ["#ff8b68", "#e65263"],
    D: ["#f06f78", "#b64066"], F: ["#ff5d6c", "#792653"]
  })[grade] || ["#8391a5", "#40516a"];
}

function rateMeterWidth(rate) {
  return Number.isFinite(rate) ? Math.min(100, Math.max(0, rate / 0.2 * 100)) : 0;
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "暂无数据";
}

function formatFullDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

function prefersReducedMotion() {
  return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

async function refresh({ firstLoad }) {
  if (state.refreshing) return;
  const fallbackCache = state.dashboardCache || null;
  state.refreshing = true;
  dom.refreshButton.disabled = true;
  dom.refreshButton.textContent = "刷新中…";
  dom.loginPanel.classList.add("is-hidden");
  if (firstLoad) {
    dom.loadingPanel.classList.remove("is-hidden");
    dom.dashboardContent.classList.add("is-hidden");
  }

  try {
    const student = await requireCurrentStudent();
    state.student = student;
    renderStudentIdentity();
    clearAuthenticationPrompt();
    const courses = await api.getCourses();
    state.courses = courses;
    ({ ongoing: state.ongoing, history: state.history } = splitCoursesByPlatformTerm(courses));
    if (!state.historyCourseId || !state.history.some((course) => course.id === state.historyCourseId)) {
      state.historyCourseId = state.history[0]?.id || null;
    }
    updateScopeControls();
    await loadSelectedCourses({ fallbackCache });
  } catch (error) {
    showRefreshFailure(error, fallbackCache);
  } finally {
    state.refreshing = false;
    dom.refreshButton.disabled = false;
    dom.refreshButton.textContent = "刷新数据";
  }
}

async function loadSelectedCourses({ fallbackCache = state.dashboardCache || null } = {}) {
  const selected = state.scope === "ongoing"
    ? state.ongoing
    : state.history.filter((course) => course.id === state.historyCourseId);

  state.loadedCourses = selected;
  state.activities = [];
  state.attendance = [];
  state.files = [];
  state.errors = [];
  resetFiltersForCourses(selected);

  if (!selected.length) {
    clearAuthenticationPrompt();
    dom.loginPanel.classList.add("is-hidden");
    dom.loadingPanel.classList.add("is-hidden");
    dom.dashboardContent.classList.remove("is-hidden");
    state.refreshedAt = new Date();
    renderAll();
    dom.refreshMeta.textContent = `本页刷新于 ${formatClockTime(state.refreshedAt)}`;
    try {
      await saveDashboardCache();
    } catch (error) {
      console.warn("无法保存空课程范围缓存", error);
      toast("课程范围已读取，但本地缓存保存失败", true);
    }
    return true;
  }

  dom.loadingPanel.classList.remove("is-hidden");
  dom.dashboardContent.classList.add("is-hidden");
  dom.loadingTitle.textContent = state.scope === "ongoing" ? "正在读取进行中的课程…" : "正在读取历史课程…";
  dom.loadingDetail.textContent = `准备读取 ${selected.length} 门课程；读取完成后将更新匿名本地缓存。`;

  try {
    const result = await api.loadCourses(selected, {
      internalUserId: state.student?.internalUserId,
      onProgress: ({ index, total, course }) => {
        dom.loadingDetail.textContent = `正在读取 ${index + 1}/${total}：${course.name}`;
      }
    });
    state.activities = dedupeBy(result.activities, (item) => item.key);
    state.attendance = result.attendance;
    state.files = dedupeBy(result.files, (item) => item.id);
    state.errors = result.errors;
    state.refreshedAt = new Date();
    dom.refreshMeta.textContent = `本页刷新于 ${formatClockTime(state.refreshedAt)}`;
    clearAuthenticationPrompt();
    dom.loginPanel.classList.add("is-hidden");
    dom.loadingPanel.classList.add("is-hidden");
    dom.dashboardContent.classList.remove("is-hidden");
    renderAll();
    try {
      await saveDashboardCache();
    } catch (error) {
      console.warn("无法保存学习总览缓存", error);
      toast("数据读取成功，但本地缓存保存失败", true);
    }
    return true;
  } catch (error) {
    showRefreshFailure(error, fallbackCache);
    return false;
  }
}

function showRefreshFailure(error, fallbackCache = null) {
  if (fallbackCache) {
    applyDashboardCache(fallbackCache);
    if (error instanceof AuthError) {
      showAuthenticationBanner(`${error.message}。当前继续显示上次缓存，请登录后重新刷新。`);
      toast("无法读取当前用户信息，已保留上次缓存", true);
    } else {
      toast(`刷新失败：${error?.message || String(error)}。正在显示上次缓存。`, true);
    }
    return;
  }
  handleFatalError(error);
}

async function requireCurrentStudent() {
  try {
    const student = await api.getCurrentStudent();
    if (!student || !Number.isFinite(Number(student.internalUserId))) {
      throw new Error("页面没有返回可用的用户标识");
    }
    return student;
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw new AuthError(`无法读取当前用户信息，请先登录 TronClass（${error?.message || String(error)}）`);
  }
}

function showAuthenticationBanner(message) {
  state.authenticationRequired = true;
  dom.authBannerMessage.textContent = message;
  dom.authBanner.classList.remove("is-hidden");
}

function clearAuthenticationPrompt() {
  state.authenticationRequired = false;
  dom.authBanner.classList.add("is-hidden");
  dom.loginPanel.classList.add("is-hidden");
}

function formatClockTime(value) {
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(value);
}

function renderStudentIdentity() {
  const name = state.student?.name?.trim() || "";
  const studentNumber = state.student?.studentNumber?.trim() || "";
  const visible = Boolean(name || studentNumber);
  dom.studentIdentity.classList.toggle("is-hidden", !visible);
  if (!visible) return;

  dom.studentName.textContent = name || "当前学生";
  dom.studentNumber.textContent = studentNumber || "未提供";
}

function updateScopeControls() {
  dom.historyCourseSelect.classList.toggle("is-hidden", state.scope !== "history");
  dom.scopeDescription.textContent = state.scope === "ongoing"
    ? "按照 TronClass 课程列表中的最新学期分组展示，不使用本地日期推测。"
    : "历史课程按 TronClass 返回顺序列出，每次只读取所选课程。";

  replaceOptions(dom.historyCourseSelect, state.history.map((course) => ({
    value: String(course.id),
    label: `${course.semesterName ? `${course.semesterName} · ` : ""}${course.name}`
  })), state.historyCourseId ? String(state.historyCourseId) : "", "暂无历史课程");
}

function resetFiltersForCourses(courses) {
  const options = courses.map((course) => ({ value: String(course.id), label: course.name }));
  if (!courses.some((course) => String(course.id) === state.filters.taskCourse)) state.filters.taskCourse = "all";
  replaceOptions(dom.taskCourseFilter, [{ value: "all", label: "全部课程" }, ...options], state.filters.taskCourse);
}

function syncMaterialCourseFilter() {
  const counts = new Map();
  for (const file of state.files) counts.set(file.courseId, (counts.get(file.courseId) || 0) + 1);
  const coursesWithFiles = state.loadedCourses.filter((course) => counts.has(course.id));
  const options = coursesWithFiles.map((course) => ({
    value: String(course.id),
    label: `${course.name}（${counts.get(course.id)}）`
  }));
  if (!coursesWithFiles.some((course) => String(course.id) === state.filters.materialCourse)) {
    state.filters.materialCourse = options[0]?.value || "";
  }
  replaceOptions(dom.materialCourseFilter, options, state.filters.materialCourse, "暂无文件课程");
}

function renderAll() {
  syncMaterialCourseFilter();
  renderOverview();
  renderAttendance();
  renderTasks();
  renderMaterials();
  renderErrors();
  renderSectionSummaries();
}

function renderSectionSummaries() {
  const attendanceCounts = state.attendance.reduce((totals, item) => {
    totals.present += item.counts.present;
    totals.late += item.counts.late;
    totals.absent += item.counts.absent;
    totals.personalLeave += item.counts.personalLeave;
    totals.sickLeave += item.counts.sickLeave;
    totals.other += item.counts.other;
    return totals;
  }, { present: 0, late: 0, absent: 0, personalLeave: 0, sickLeave: 0, other: 0 });
  const anomalyCount = attendanceCounts.late + attendanceCounts.absent + attendanceCounts.personalLeave + attendanceCounts.sickLeave + attendanceCounts.other;

  const promptedActivities = state.activities.filter((item) => !isActivityIgnored(item));
  const taskCounts = promptedActivities.reduce((totals, item) => {
    if (Object.hasOwn(totals, item.status)) totals[item.status] += 1;
    return totals;
  }, { overdue: 0, pending: 0, upcoming: 0, completed: 0, record: 0 });
  const pendingHomework = promptedActivities.filter((item) => item.sourceType === "homework" && ["pending", "upcoming"].includes(item.status)).length;
  const materialCourseCount = new Set(state.files.map((file) => file.courseId)).size;
  const directlyDownloadable = state.files.filter((file) => file.allowDownload && file.referenceId).length;

  setSectionSummary("overviewTitle", `待提交作业 ${pendingHomework} · 出勤异常 ${anomalyCount} · 文件 ${state.files.length} · 逾期 ${taskCounts.overdue}`);
  setSectionSummary("attendanceTitle", `${state.attendance.length} 门课程 · 出席 ${attendanceCounts.present} 次 · 异常 ${anomalyCount} 次`);
  setSectionSummary("tasksTitle", `需关注 ${taskCounts.overdue + taskCounts.pending + taskCounts.upcoming} · 进行中 ${taskCounts.pending} · 即将开始 ${taskCounts.upcoming} · 逾期 ${taskCounts.overdue} · 已完成 ${taskCounts.completed}`);
  setSectionSummary("materialsTitle", `${materialCourseCount} 门课程 · ${state.files.length} 个附件 · ${directlyDownloadable} 个可直接下载`);
  setSectionSummary("errorsTitle", `${state.errors.length} 项内容读取失败`);
}

function setSectionSummary(headingId, text) {
  const section = document.getElementById(headingId)?.closest("section");
  const summary = section?.querySelector(":scope > .section-heading .section-collapse-summary");
  if (summary) summary.textContent = text;
}

function renderOverview() {
  dom.courseSummary.textContent = state.loadedCourses.length
    ? `已读取 ${state.loadedCourses.length} 门课程 · 匿名学习数据已保存到本地缓存`
    : "当前范围没有课程";

  const attendanceCounts = state.attendance.reduce((totals, item) => {
    totals.late += item.counts.late;
    totals.absent += item.counts.absent;
    totals.personalLeave += item.counts.personalLeave;
    totals.sickLeave += item.counts.sickLeave;
    totals.other += item.counts.other;
    return totals;
  }, { late: 0, absent: 0, personalLeave: 0, sickLeave: 0, other: 0 });
  const anomalyCount = Object.values(attendanceCounts).reduce((sum, count) => sum + count, 0);
  const promptedActivities = state.activities.filter((item) => !isActivityIgnored(item));
  const homeworkCounts = promptedActivities.reduce((totals, item) => {
    if (item.sourceType === "homework" && (item.status === "pending" || item.status === "upcoming")) {
      totals[item.status] += 1;
    }
    return totals;
  }, { pending: 0, upcoming: 0 });
  const pendingHomework = homeworkCounts.pending + homeworkCounts.upcoming;
  const overdueCount = promptedActivities.filter((item) => item.status === "overdue").length;
  const cards = [
    {
      label: "待提交作业",
      value: pendingHomework,
      help: `进行中 ${homeworkCounts.pending} · 即将开始 ${homeworkCounts.upcoming}`,
      glow: "#fff4da",
      color: "#9a5b00"
    },
    {
      label: "出勤异常",
      value: anomalyCount,
      help: `迟到 ${attendanceCounts.late} · 缺席 ${attendanceCounts.absent} · 事假 ${attendanceCounts.personalLeave} · 病假 ${attendanceCounts.sickLeave} · 其他 ${attendanceCounts.other}`,
      glow: "#fff0f1",
      color: "#b4232c"
    },
    { label: "课程文件", value: state.files.length, help: "支持下载平台允许的所有文件类型", glow: "#eaf2ff", color: "#1769e0" },
    { label: "逾期任务", value: overdueCount, help: "已过截止时间且未完成", glow: "#fff0f1", color: "#b4232c" }
  ];
  dom.statsGrid.replaceChildren(...cards.map((card) => {
    const node = element("article", "stat-card");
    node.style.setProperty("--card-glow", card.glow);
    node.append(
      element("span", "stat-label", card.label),
      element("strong", "stat-value", String(card.value), { style: `color:${card.color}` }),
      element("span", "stat-help", card.help)
    );
    return node;
  }));
}

function renderAttendance() {
  if (!state.attendance.length) {
    dom.attendanceGrid.replaceChildren(emptyState("没有可显示的出勤记录", "课程可能尚未点名，或该课程未开放出勤数据。"));
    return;
  }

  const ordered = [...state.attendance].sort((a, b) => b.anomalyCount - a.anomalyCount || a.courseName.localeCompare(b.courseName, "zh-CN"));
  dom.attendanceGrid.replaceChildren(...ordered.map((attendance) => {
    const card = element("article", "attendance-card");
    const header = element("div", "attendance-header");
    const title = element("div", "attendance-title");
    title.append(element("h3", "", attendance.courseName), element("p", "", `共 ${attendance.rollcallCount} 次点名${attendance.score === null ? "" : ` · 出勤成绩 ${attendance.score}`}`));
    const open = button("查看课程出勤", "button button-secondary button-small", () => openUrl(attendance.directUrl));
    header.append(title, open);

    const countGrid = element("div", "attendance-counts");
    const countItems = [
      ["出席", attendance.counts.present, false], ["迟到", attendance.counts.late, true],
      ["缺席", attendance.counts.absent, true], ["事假", attendance.counts.personalLeave, true],
      ["病假", attendance.counts.sickLeave, true], ["其他", attendance.counts.other, true]
    ];
    countGrid.append(...countItems.map(([label, count, alert]) => {
      const box = element("div", `attendance-count${alert && count ? " is-alert" : ""}`);
      box.append(element("strong", "", String(count)), element("span", "", label));
      return box;
    }));

    const details = element("details", "attendance-detail");
    details.append(element("summary", "", `展开 ${attendance.records.length} 条点名记录`));
    const records = element("ul", "attendance-records");
    records.append(...attendance.records.map((record) => {
      const row = element("li", "attendance-record");
      row.append(
        element("span", "task-course", formatDateTime(record.time)),
        element("span", "", record.title),
        element("span", `badge ${record.category === "present" ? "badge-completed" : "badge-overdue"}`, record.detail || record.label, { title: record.rawStatus })
      );
      return row;
    }));
    details.append(records);

    const settingText = attendanceSettingText(attendance.setting);
    card.append(header, countGrid, details);
    if (settingText) card.append(element("p", "setting-note", settingText));
    return card;
  }));
}

function renderTasks() {
  renderHiddenTasksMenu();
  let items = [...state.activities];
  if (state.filters.taskCourse !== "all") items = items.filter((item) => String(item.courseId) === state.filters.taskCourse);
  if (state.filters.taskStatus === "attention") {
    items = items.filter((item) => ["overdue", "pending", "upcoming"].includes(item.status) && !isActivityIgnored(item));
  } else if (state.filters.taskStatus === "ignored") {
    items = items.filter(isActivityIgnored);
  } else if (state.filters.taskStatus !== "all") {
    items = items.filter((item) => item.status === state.filters.taskStatus && !isActivityIgnored(item));
  }
  if (state.filters.taskType === "group") items = items.filter((item) => item.isGroupTask);
  else if (state.filters.taskType !== "all") items = items.filter((item) => item.sourceType === state.filters.taskType);
  items.sort(taskSort);

  if (!items.length) {
    const description = state.filters.taskStatus === "attention"
      ? "当前筛选下没有需要关注的未完成项目；已忽略项目可在“已忽略提示”中恢复。"
      : state.filters.taskStatus === "ignored"
        ? "当前没有已忽略的学习活动。"
        : "可以尝试切换状态、类型或课程筛选。";
    dom.taskList.replaceChildren(emptyState("没有符合条件的任务", description));
    return;
  }

  dom.taskList.replaceChildren(...items.map((item) => {
    const ignored = isActivityIgnored(item);
    const row = element("article", `task-row${ignored ? " is-ignored" : ""}`);
    const main = element("div", "task-main");
    const tags = element("div", "task-tags");
    tags.append(element("span", "badge badge-type", TYPE_LABELS[item.sourceType] || item.sourceType));
    if (item.isGroupTask) tags.append(element("span", "badge badge-group", "分组"));
    if (ignored) tags.append(element("span", "badge badge-ignored", "已忽略提示"));
    main.append(element("span", "task-title", item.title), tags);

    const course = element("div", "task-course", item.courseName);
    const time = element("div", "task-time");
    time.append(element("strong", "", "截止时间"), document.createTextNode(formatDateTime(item.deadlineAt)));
    const statusInfo = taskStatusInfo(item);
    const status = element("span", `badge badge-${statusInfo.style}`, statusInfo.label, { title: statusInfo.title });
    const actionLabel = ["pending", "overdue", "upcoming"].includes(item.status) ? "前往完成" : "查看详情";
    const actions = element("div", "task-actions");
    actions.append(button(actionLabel, "button button-secondary button-small", () => openUrl(item.directUrl)));
    if (ignored || ["pending", "overdue", "upcoming"].includes(item.status)) {
      actions.append(button(ignored ? "恢复提示" : "忽略提示", "button button-link button-small task-ignore-button", () => updateActivityIgnored(item, !ignored)));
    }
    row.append(main, course, time, status, actions);
    return row;
  }));
}

function renderHiddenTasksMenu() {
  const hiddenItems = state.activities
    .filter(isActivityIgnored)
    .sort(taskSort);
  dom.hiddenTaskCount.textContent = String(hiddenItems.length);
  dom.hiddenTasksMenu.classList.toggle("has-hidden-tasks", hiddenItems.length > 0);
  dom.restoreAllHiddenTasks.disabled = hiddenItems.length === 0;

  if (!hiddenItems.length) {
    dom.hiddenTaskList.replaceChildren(emptyState("没有已隐藏任务", "点击任务旁的“忽略提示”后，会显示在这里。"));
    return;
  }

  dom.hiddenTaskList.replaceChildren(...hiddenItems.map((item) => {
    const row = element("div", "hidden-task-row");
    const copy = element("div", "hidden-task-copy");
    copy.append(
      element("strong", "", item.title, { title: item.title }),
      element("span", "", `${item.courseName} · ${TYPE_LABELS[item.sourceType] || item.sourceType}`)
    );
    const actions = element("div", "hidden-task-actions");
    actions.append(
      button("打开", "button button-link button-small", () => openUrl(item.directUrl)),
      button("还原", "button button-secondary button-small", () => updateActivityIgnored(item, false))
    );
    row.append(copy, actions);
    return row;
  }));
}

async function restoreAllIgnoredActivities() {
  const restoredKeys = state.activities.filter(isActivityIgnored).map((item) => item.key);
  if (!restoredKeys.length) return;
  for (const key of restoredKeys) state.ignoredActivityKeys.delete(key);
  renderOverview();
  renderTasks();
  renderSectionSummaries();
  try {
    await saveUiPreferences();
    dom.hiddenTasksMenu.open = false;
    toast(`已还原 ${restoredKeys.length} 个隐藏任务`, false, {
      label: "撤销",
      handler: async () => {
        for (const key of restoredKeys) state.ignoredActivityKeys.add(key);
        renderOverview();
        renderTasks();
        renderSectionSummaries();
        await saveUiPreferences();
      }
    });
  } catch (error) {
    for (const key of restoredKeys) state.ignoredActivityKeys.add(key);
    renderOverview();
    renderTasks();
    renderSectionSummaries();
    toast(`还原失败：${error?.message || String(error)}`, true);
  }
}

function isActivityIgnored(item) {
  return Boolean(item?.key && state.ignoredActivityKeys.has(item.key));
}

async function updateActivityIgnored(item, ignored, { notify = true } = {}) {
  if (!item?.key) return;
  const previous = state.ignoredActivityKeys.has(item.key);
  if (ignored) state.ignoredActivityKeys.add(item.key);
  else state.ignoredActivityKeys.delete(item.key);
  renderOverview();
  renderTasks();
  renderSectionSummaries();
  try {
    await saveUiPreferences();
    if (notify) {
      toast(ignored ? "已忽略该项目的提示" : "已恢复该项目的提示", false, {
        label: "撤销",
        handler: () => updateActivityIgnored(item, previous, { notify: false })
      });
    }
  } catch (error) {
    if (previous) state.ignoredActivityKeys.add(item.key);
    else state.ignoredActivityKeys.delete(item.key);
    renderOverview();
    renderTasks();
    renderSectionSummaries();
    toast(`忽略设置保存失败：${error?.message || String(error)}`, true);
  }
}

function renderMaterials() {
  const files = state.files.filter((file) => String(file.courseId) === state.filters.materialCourse);
  if (!files.length) {
    dom.materialsList.replaceChildren(emptyState("没有可显示的课程文件", "当前课程没有附件，或文件接口暂时不可用。"));
    return;
  }

  const groups = groupBy(files, (file) => file.courseId);
  const courseOrder = state.loadedCourses.filter((course) => groups.has(course.id));
  dom.materialsList.replaceChildren(...courseOrder.map((course) => {
    const courseFiles = groups.get(course.id);
    const section = element("article", "material-course");
    const header = element("div", "material-course-header");
    const heading = element("div");
    heading.append(element("h3", "", course.name), element("p", "", `${courseFiles.length} 个附件 · ${courseFiles.filter((file) => file.allowDownload).length} 个允许直接下载`));
    const batch = button("下载本课程全部可下载文件", "button button-secondary button-small", () => downloadBatch(courseFiles));
    batch.disabled = !courseFiles.some((file) => file.allowDownload && file.referenceId);
    header.append(heading, batch);
    section.append(header, ...courseFiles.map(materialRow));
    return section;
  }));
}

function materialRow(file) {
  const row = element("div", "material-row");
  const main = element("div", "file-main");
  main.append(element("span", "file-name", file.name), element("div", "file-meta", `${formatBytes(file.size)} · ${formatDateTime(file.publishedAt)}`));
  const activity = element("div", "file-activity", file.activityTitle, { title: file.activityTitle });
  const mode = element("span", `badge ${file.allowDownload ? "badge-completed" : file.previewable ? "badge-upcoming" : "badge-record"}`,
    file.allowDownload ? "允许下载" : file.previewable ? "授权预览" : "仅在线查看");
  const actions = element("div", "file-actions");
  actions.append(button("查看活动", "button button-link button-small", () => openUrl(file.directUrl)));
  if (file.allowDownload && file.referenceId) actions.append(button("下载", "button button-primary button-small", (event) => downloadOfficial(file, event.currentTarget)));
  else if (file.previewable) actions.append(button("预览另存", "button button-primary button-small", (event) => downloadPreview(file, event.currentTarget)));
  row.append(main, activity, mode, actions);
  return row;
}

function renderErrors() {
  dom.errorsSection.classList.toggle("is-hidden", !state.errors.length);
  dom.errorsList.replaceChildren(...state.errors.map((error) => element("li", "", `${error.courseName} · ${error.section}：${error.message}`)));
}

async function downloadOfficial(file, target) {
  await withBusyButton(target, "准备下载…", async () => {
    const response = await sendMessage({
      type: "DOWNLOAD",
      url: api.officialDownloadUrl(file.referenceId),
      filename: downloadPath(file)
    });
    if (!response?.ok) throw new Error(response?.error || "下载启动失败");
    toast(`已开始下载：${file.name}`);
  });
}

async function downloadPreview(file, target) {
  await withBusyButton(target, "获取授权…", async () => {
    const signedUrl = await api.resolvePreviewUrl(file);
    const response = await sendMessage({ type: "DOWNLOAD", url: signedUrl, filename: downloadPath(file) });
    if (!response?.ok) throw new Error(response?.error || "另存启动失败");
    toast(`已通过 TronClass 当前授权开始另存：${file.name}`);
  });
}

async function downloadBatch(files) {
  const downloadable = files.filter((file) => file.allowDownload && file.referenceId);
  if (!downloadable.length) return;
  let successes = 0;
  let failures = 0;
  for (const file of downloadable) {
    try {
      const response = await sendMessage({ type: "DOWNLOAD", url: api.officialDownloadUrl(file.referenceId), filename: downloadPath(file) });
      if (!response?.ok) throw new Error(response?.error);
      successes += 1;
    } catch {
      failures += 1;
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  toast(`批量下载已处理：成功 ${successes}，失败 ${failures}`, failures > 0);
}

function downloadPath(file) {
  return `TronClass/${safePathSegment(file.courseName)}/${safePathSegment(file.name)}`;
}

function taskStatusInfo(item) {
  if (item.sourceType === "discussion") {
    return { label: item.completed ? "已发帖" : "未发帖", style: item.completed ? "completed" : item.status, title: "讨论完成状态只按是否发过主题帖判断，回帖不计入。" };
  }
  if (item.sourceType === "interaction" && item.status !== "record") {
    return { label: item.completed ? "已参与" : "未参与", style: item.completed ? "completed" : item.status, title: "按照互动提交记录判断。" };
  }
  if (item.status === "pending") {
    return {
      label: formatRemainingTime(item.deadlineAt),
      style: `remaining-${remainingTimeUrgency(item.deadlineAt)}`,
      title: item.deadlineAt ? `截止时间：${formatDateTime(item.deadlineAt)}` : "该活动没有设置截止时间"
    };
  }
  return { label: STATUS_LABELS[item.status] || item.status, style: item.status, title: item.rawStatus || "" };
}

function taskSort(a, b) {
  const rank = { overdue: 0, pending: 1, upcoming: 2, completed: 3, record: 4 };
  const statusDiff = (rank[a.status] ?? 9) - (rank[b.status] ?? 9);
  if (statusDiff) return statusDiff;
  const aDeadline = a.deadlineAt ? new Date(a.deadlineAt).getTime() : Number.MAX_SAFE_INTEGER;
  const bDeadline = b.deadlineAt ? new Date(b.deadlineAt).getTime() : Number.MAX_SAFE_INTEGER;
  return aDeadline - bDeadline || a.title.localeCompare(b.title, "zh-CN");
}

function attendanceSettingText(setting) {
  const rules = [];
  if (setting.arriveLateAsAbsence) rules.push("迟到计作缺席");
  if (setting.leaveEarlyAsAbsence) rules.push("早退计作缺席");
  if (setting.lateCombineEarlyAsAbsence) rules.push("迟到与早退合并计作缺席");
  if (setting.personalLeaveAsAbsence) rules.push("事假计作缺席");
  if (setting.sickLeaveAsAbsence) rules.push("病假计作缺席");
  return rules.length ? `本课程点名设置：${rules.join("；")}。插件仅展示平台规则，不自行换算。` : "";
}

function handleFatalError(error) {
  state.student = null;
  state.authenticationRequired = error instanceof AuthError;
  renderStudentIdentity();
  dom.authBanner.classList.add("is-hidden");
  dom.loadingPanel.classList.add("is-hidden");
  dom.dashboardContent.classList.add("is-hidden");
  dom.loginPanel.classList.remove("is-hidden");
  dom.loginTitle.textContent = error instanceof AuthError ? "需要登录 TronClass" : "暂时无法读取数据";
  dom.loginMessage.textContent = error instanceof AuthError
    ? `${error.message}。登录后请点击“我已登录，重新刷新”。`
    : `读取失败：${error?.message || String(error)}。请确认已登录后重试。`;
  dom.refreshMeta.textContent = "刷新失败";
}

function replaceOptions(select, options, selected, emptyLabel = "暂无选项") {
  const nodes = options.length ? options.map((option) => {
    const node = document.createElement("option");
    node.value = option.value;
    node.textContent = option.label;
    return node;
  }) : [Object.assign(document.createElement("option"), { value: "", textContent: emptyLabel })];
  select.replaceChildren(...nodes);
  select.value = selected;
  select.disabled = !options.length;
}

function emptyState(title, description) {
  const node = element("div", "empty-state");
  node.append(element("strong", "", title), document.createTextNode(description));
  return node;
}

function element(tag, className = "", textContent, attributes = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (textContent !== undefined) node.textContent = textContent;
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  return node;
}

function button(label, className, handler) {
  const node = element("button", className, label, { type: "button" });
  node.addEventListener("click", handler);
  return node;
}

function groupBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

function dedupeBy(items, keyFn) {
  const map = new Map();
  for (const item of items) if (!map.has(keyFn(item))) map.set(keyFn(item), item);
  return [...map.values()];
}

async function openUrl(url) {
  const response = await sendMessage({ type: "OPEN_URL", url });
  if (!response?.ok) toast(response?.error || "无法打开页面", true);
}

async function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
}

async function withBusyButton(target, label, work) {
  const original = target.textContent;
  target.disabled = true;
  target.textContent = label;
  try {
    await work();
  } catch (error) {
    toast(error?.message || String(error), true);
  } finally {
    target.disabled = false;
    target.textContent = original;
  }
}

function toast(message, isError = false, action = null) {
  const node = element("div", `toast${isError ? " is-error" : ""}`);
  node.append(element("span", "toast-message", message));
  let timer;
  if (action?.label && typeof action.handler === "function") {
    const actionButton = button(action.label, "toast-action", async () => {
      clearTimeout(timer);
      node.remove();
      await action.handler();
    });
    node.append(actionButton);
  }
  dom.toastRegion.append(node);
  timer = setTimeout(() => node.remove(), 4500);
}
