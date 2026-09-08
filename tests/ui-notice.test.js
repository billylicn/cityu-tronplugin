import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../dashboard.html", import.meta.url), "utf8");
const script = readFileSync(new URL("../dashboard.js", import.meta.url), "utf8");
const background = readFileSync(new URL("../background.js", import.meta.url), "utf8");
const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));

test("插件默认先展示使用与责任声明", () => {
  assert.match(html, /id="usageNoticeDialog"/);
  assert.match(html, /软件使用方法/);
  assert.match(html, /MIT License/);
  assert.match(html, /不为任何漏报、错报/);
  assert.match(html, /使用者必须自行以 TronClass 原页面/);
  assert.match(script, /await loadUiPreferences\(\);[\s\S]*await showUsageNotice\(\);[\s\S]*await initialize\(\);/);
  assert.match(script, /addEventListener\("cancel", \(event\) => event\.preventDefault\(\)\)/);
});

test("用户可永久关闭声明并在页面设置中恢复", () => {
  assert.match(html, /id="usageNoticeDontShow"/);
  assert.match(html, /以后不再展示此声明/);
  assert.match(html, /id="usageNoticeAcknowledgement"/);
  assert.match(html, /id="usageNoticeCopyButton"/);
  assert.match(html, /id="usageNoticeConfirmButton"[^>]*disabled/);
  assert.equal(html.match(/一键复制/g)?.length, 1);
  assert.match(html, /我已知本软件可能出现漏报、错报、重复、延迟或无法读取等情况。我会自行以 TronClass 原页面、课程通知及教师要求为准，并自行承担使用本插件造成的所有后果。/);
  assert.doesNotMatch(html, /id="usageNoticeAcceptButton"/);
  assert.match(script, /input\.value\.trim\(\) === USAGE_ACKNOWLEDGEMENT/);
  assert.match(script, /usageNoticeConfirmButton\.disabled = !matched/);
  assert.match(script, /navigator\.clipboard\.writeText\(USAGE_ACKNOWLEDGEMENT\)/);
  assert.match(html, /id="settingsShowUsageNotice"/);
  assert.match(script, /suppressUsageNotice/);
  assert.match(script, /state\.ui\.suppressUsageNotice = true/);
  assert.match(script, /suppressUsageNotice: state\.ui\.suppressUsageNotice/);
});


test("声明匹配后仍须用户手动确认", () => {
  assert.match(script, /内容一致，请点击确认/);
  assert.match(script, /function confirmUsageNotice\(\)/);
  assert.match(script, /usageNoticeConfirmed = true;[\s\S]*usageNoticeDialog\.close\(\)/);
  assert.doesNotMatch(script, /setTimeout\([\s\S]{0,160}usageNoticeDialog\.close/);
  assert.match(script, /if \(!usageNoticeConfirmed\)[\s\S]*dialog\.showModal\(\)/);
});

test("再次点击扩展图标时按设置决定是否重新展示声明", () => {
  assert.match(background, /sendMessage\(tab\.id, \{ type: "SHOW_USAGE_NOTICE" \}\)/);
  assert.match(script, /message\?\.type !== "SHOW_USAGE_NOTICE"/);
  assert.match(script, /state\.ui\.suppressUsageNotice \|\|/);
});

test("插件界面提供 GitHub 项目、当前版本和更新入口", () => {
  const projectUrl = "https://github.com/billylicn/cityu-tronplugin";
  assert.ok(html.split(projectUrl).length - 1 >= 2);
  assert.match(html, /id="currentVersion"/);
  assert.match(html, /id="updateNotice"/);
  assert.match(html, /releases\/latest/);
  assert.match(script, /api\.github\.com\/repos\/billylicn\/cityu-tronplugin\/releases\/latest/);
  assert.ok(manifest.host_permissions.includes("https://api.github.com/*"));
});
