import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { safePathSegment } from "../lib/normalizers.js";

const background = readFileSync(new URL("../background.js", import.meta.url), "utf8");
const dashboard = readFileSync(new URL("../dashboard.js", import.meta.url), "utf8");
const officialUrl = "https://tronclass.cityu.edu.mo/api/uploads/reference/123/blob";
const previewUrl = "https://tcmedia.cityu.edu.mo/download/file/abc?token=ok";

function createDownloadHarness() {
  const downloads = [];
  let listener;
  runInNewContext(background, {
    URL,
    chrome: {
      action: { onClicked: { addListener() {} } },
      runtime: {
        getURL: (path) => `chrome-extension://test/${path}`,
        onMessage: { addListener(handler) { listener = handler; } }
      },
      downloads: {
        async download(options) {
          downloads.push(options);
          return downloads.length;
        }
      }
    }
  });
  return {
    downloads,
    send(message) {
      return new Promise((resolve) => {
        assert.equal(listener(message, {}, resolve), true);
      });
    }
  };
}

const filenameCases = [
  ["普通文件名", "第1课 课件.pdf", "第1课 课件.pdf"],
  ["旧版课程目录", "TronClass/测试课程/课件.pdf", "课件.pdf"],
  ["Windows 目录", "TronClass\\测试课程\\课件.pptx", "课件.pptx"],
  ["空路径段", "TronClass/测试课程//课件.pdf/  /", "课件.pdf"],
  ["非法字符", '讲义<>:"|?*\u0000\u001f.pdf', "讲义_________.pdf"],
  ["空文件名", "", "未命名文件"],
  ["缺少文件名", undefined, "未命名文件"],
  ["只有分隔符和空白", "/ \\ /", "未命名文件"],
  ["只有点号", "..", "_"]
];

for (const [name, input, expected] of filenameCases) {
  test(`后台下载使用单层文件名：${name}`, async () => {
    const harness = createDownloadHarness();
    const response = await harness.send({ type: "DOWNLOAD", url: officialUrl, filename: input });
    assert.equal(response.ok, true);
    assert.equal(response.downloadId, 1);
    const options = harness.downloads[0];
    assert.equal(options.filename, expected);
    assert.doesNotMatch(options.filename, /[/\\]/);
    assert.equal(options.url, officialUrl);
    assert.equal(options.conflictAction, "uniquify");
    assert.equal(options.saveAs, false);
  });
}

test("授权预览下载保留另存选项及同名文件自动编号", async () => {
  const harness = createDownloadHarness();
  const response = await harness.send({ type: "DOWNLOAD", url: previewUrl, filename: "TronClass/课程/课件.pdf", saveAs: true });
  assert.equal(response.ok, true);
  assert.equal(harness.downloads[0].filename, "课件.pdf");
  assert.equal(harness.downloads[0].saveAs, true);
  assert.equal(harness.downloads[0].conflictAction, "uniquify");
});

test("下载仍拒绝非授权域名和不符合规则的地址", async () => {
  const harness = createDownloadHarness();
  for (const url of ["https://example.com/file.pdf", "https://tronclass.cityu.edu.mo/file.pdf", "https://tcmedia.cityu.edu.mo/download/file/abc"]) {
    const response = await harness.send({ type: "DOWNLOAD", url, filename: "课件.pdf" });
    assert.equal(response.ok, false);
    assert.match(response.error, /已阻止非授权下载域名|下载地址不符合安全规则/);
  }
  assert.equal(harness.downloads.length, 0);
});

test("单个、预览另存和批量入口均以原文件名单层保存", async () => {
  const harness = createDownloadHarness();
  const messages = [];
  const context = {
    safePathSegment,
    api: {
      officialDownloadUrl: () => officialUrl,
      resolvePreviewUrl: async () => previewUrl
    },
    async sendMessage(message) {
      messages.push(message);
      return harness.send(message);
    },
    withBusyButton: async (_target, _label, callback) => callback(),
    toast() {},
    setTimeout: (callback) => callback()
  };
  const start = dashboard.indexOf("async function downloadOfficial(");
  const end = dashboard.indexOf("function taskStatusInfo(", start);
  assert.ok(start >= 0 && end > start);
  runInNewContext(dashboard.slice(start, end), context);
  const file = { name: "讲义/第1课.pdf", courseName: "测试课程", referenceId: 123, allowDownload: true };
  await context.downloadOfficial(file);
  await context.downloadPreview(file);
  await context.downloadBatch([file, { ...file, allowDownload: false }, { ...file, referenceId: null }, { ...file, courseName: "另一课程" }]);
  assert.equal(messages.length, 4);
  assert.equal(messages[1].url, previewUrl);
  assert.equal(harness.downloads.length, 4);
  for (const [index, message] of messages.entries()) {
    assert.equal(message.filename, "讲义_第1课.pdf");
    assert.equal(harness.downloads[index].filename, "讲义_第1课.pdf");
    assert.equal(harness.downloads[index].conflictAction, "uniquify");
  }
});
