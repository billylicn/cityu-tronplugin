import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../dashboard.html", import.meta.url), "utf8");
const script = readFileSync(new URL("../dashboard.js", import.meta.url), "utf8");
const background = readFileSync(new URL("../background.js", import.meta.url), "utf8");

test("插件每次启动先展示使用与责任声明", () => {
  assert.match(html, /id="usageNoticeDialog"/);
  assert.match(html, /软件使用方法/);
  assert.match(html, /MIT License/);
  assert.match(html, /不为任何漏报、错报/);
  assert.match(html, /使用者必须自行以 TronClass 原页面/);
  assert.match(script, /await showUsageNotice\(\);\s*await initialize\(\);/);
  assert.doesNotMatch(script, /usageNoticeAccepted|noticeAccepted/);
  assert.match(script, /addEventListener\("cancel", \(event\) => event\.preventDefault\(\)\)/);
});

test("再次点击扩展图标时重新展示声明", () => {
  assert.match(background, /sendMessage\(tab\.id, \{ type: "SHOW_USAGE_NOTICE" \}\)/);
  assert.match(script, /message\?\.type !== "SHOW_USAGE_NOTICE"/);
  assert.match(script, /showUsageNotice\(\)\.then/);
});

test("插件界面提供 GitHub 开源项目入口", () => {
  const projectUrl = "https://github.com/billylicn/cityu-tronplugin";
  assert.ok(html.split(projectUrl).length - 1 >= 2);
  assert.match(html, /GitHub 开源项目/);
});
