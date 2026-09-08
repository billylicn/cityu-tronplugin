const DASHBOARD_URL = chrome.runtime.getURL("dashboard.html");
const ALLOWED_OPEN_ORIGINS = new Set(["https://tronclass.cityu.edu.mo"]);
const ALLOWED_DOWNLOAD_ORIGINS = new Set([
  "https://tronclass.cityu.edu.mo",
  "https://tcmedia.cityu.edu.mo"
]);

chrome.action.onClicked.addListener(() => openOrFocusDashboard());

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;

  if (message.type === "OPEN_DASHBOARD") {
    openOrFocusDashboard().then(() => sendResponse({ ok: true }), respondError(sendResponse));
    return true;
  }

  if (message.type === "OPEN_URL") {
    openSafeUrl(message.url).then(() => sendResponse({ ok: true }), respondError(sendResponse));
    return true;
  }

  if (message.type === "DOWNLOAD") {
    downloadFile(message).then(
      (downloadId) => sendResponse({ ok: true, downloadId }),
      respondError(sendResponse)
    );
    return true;
  }

  return false;
});

async function openOrFocusDashboard() {
  const tabs = await chrome.tabs.query({ url: `${DASHBOARD_URL}*` });
  if (tabs.length) {
    const tab = tabs[0];
    await chrome.tabs.update(tab.id, { active: true });
    if (tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
    return;
  }
  await chrome.tabs.create({ url: DASHBOARD_URL });
}

async function openSafeUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (!ALLOWED_OPEN_ORIGINS.has(url.origin)) throw new Error("已阻止非 TronClass 地址");
  await chrome.tabs.create({ url: url.href });
}

async function downloadFile({ url: rawUrl, filename, saveAs = false }) {
  const url = new URL(rawUrl);
  if (!ALLOWED_DOWNLOAD_ORIGINS.has(url.origin)) throw new Error("已阻止非授权下载域名");

  const isOfficialBlob =
    url.origin === "https://tronclass.cityu.edu.mo" &&
    /^\/api\/uploads\/reference\/\d+\/blob\/?$/.test(url.pathname);
  const isSignedMedia =
    url.origin === "https://tcmedia.cityu.edu.mo" &&
    url.pathname.startsWith("/download/file/") &&
    url.searchParams.has("token");

  if (!isOfficialBlob && !isSignedMedia) throw new Error("下载地址不符合安全规则");

  return chrome.downloads.download({
    url: url.href,
    filename: sanitizeDownloadPath(filename),
    conflictAction: "uniquify",
    saveAs: Boolean(saveAs)
  });
}

function sanitizeDownloadPath(input) {
  const parts = String(input || "TronClass/未命名文件")
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.replace(/[<>:"|?*\u0000-\u001f]/g, "_").replace(/^\.+$/, "_").trim())
    .filter(Boolean)
    .slice(-3);
  return parts.join("/") || "TronClass/未命名文件";
}

function respondError(sendResponse) {
  return (error) => sendResponse({ ok: false, error: error?.message || String(error) });
}
