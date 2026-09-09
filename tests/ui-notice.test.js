import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../dashboard.html", import.meta.url), "utf8");
const script = readFileSync(new URL("../dashboard.js", import.meta.url), "utf8");
const background = readFileSync(new URL("../background.js", import.meta.url), "utf8");
const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));

test("插件默认依次展示使用声明与启动通知", () => {
  assert.match(html, /id="usageNoticeDialog"/);
  assert.match(html, /软件使用方法/);
  assert.match(html, /MIT License/);
  assert.match(html, /不为任何漏报、错报/);
  assert.match(html, /使用者必须自行以 TronClass 原页面/);
  assert.match(script, /await loadUiPreferences\(\);[\s\S]*await showStartupPrompts\(\);[\s\S]*await initialize\(\);/);
  assert.match(script, /await showUsageNotice\(\);[\s\S]*await showStartupAnnouncement\(\);/);
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

test("再次点击扩展图标时串行检查声明和启动通知", () => {
  assert.match(background, /sendMessage\(tab\.id, \{ type: "SHOW_STARTUP_PROMPTS" \}\)/);
  assert.match(script, /message\?\.type !== "SHOW_STARTUP_PROMPTS"/);
  assert.match(script, /state\.ui\.suppressUsageNotice \|\|/);
  assert.match(script, /startupPromptsPromise/);
});

test("普通启动通知支持长内容和仅忽略完全相同的内容", () => {
  assert.match(html, /id="startupAnnouncementDialog"/);
  assert.match(html, /id="startupAnnouncementLabel"/);
  assert.match(html, /id="startupAnnouncementPublishedAt"/);
  assert.match(html, /id="startupAnnouncementParagraphs"/);
  assert.match(html, /id="startupAnnouncementItems"/);
  assert.match(html, /id="startupAnnouncementDontShow"/);
  assert.match(html, /id="startupAnnouncementCloseButton"[^>]*aria-label="关闭通知"/);
  assert.match(html, /不再显示这条通知/);
  assert.match(html, /仅忽略内容完全相同的通知/);
  assert.doesNotMatch(html, /id="startupAnnouncementIgnoreButton"/);
  assert.doesNotMatch(html, /announcement-icon/);
  assert.doesNotMatch(html, /版本通知/);
  assert.doesNotMatch(html, />知道了</);
  assert.match(html, /id="settingsResetAnnouncementButton"/);
  assert.match(script, /announcementFingerprint\(announcement\)/);
  assert.match(script, /fingerprint === state\.ui\.ignoredAnnouncementFingerprint/);
  assert.match(script, /startupAnnouncementDontShow\.checked/);
  assert.match(script, /const shouldRemember = dom\.startupAnnouncementDontShow\.checked/);
  assert.match(script, /ignoredAnnouncementFingerprint: state\.ui\.ignoredAnnouncementFingerprint/);
  assert.match(script, /欢迎使用 CityU TronClass Plugin/);
  assert.match(script, /学习总览：集中查看出勤、待提交作业/);
  assert.doesNotMatch(script, /CityU TronClass Plugin v0\.3\.6 已发布/);
});

test("用户信息读取失败时提供显著登录入口并保留缓存", () => {
  assert.match(html, /id="authBanner"/);
  assert.match(html, /id="authLoginButton"/);
  assert.match(html, /id="authRefreshButton"/);
  assert.match(html, /id="loginRefreshButton"/);
  assert.match(script, /const student = await requireCurrentStudent\(\);[\s\S]*const courses = await api\.getCourses\(\);/);
  assert.match(script, /applyDashboardCache\(fallbackCache\);[\s\S]*showAuthenticationBanner/);
  assert.match(script, /clearAuthenticationPrompt\(\)/);
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

test("页面设置已迁移到左侧独立功能页", () => {
  assert.match(html, /class="side-nav-button" data-page="settings"/);
  assert.match(html, /id="settingsPage" class="page-view is-hidden"/);
  assert.match(html, /id="settingsForm"/);
  assert.doesNotMatch(html, /id="settingsButton"/);
  assert.doesNotMatch(html, /id="settingsDialog"/);
  assert.match(script, /\["overview", "battle", "settings"\]\.includes\(page\)/);
  assert.match(script, /dom\.settingsPage\.classList\.toggle\("is-hidden", page !== "settings"\)/);
  assert.match(script, /if \(page === "settings"\) prepareSettingsPage\(\)/);
});

test("学习总览默认将任务置顶、折叠出勤并展开课程文件", () => {
  assert.match(script, /DEFAULT_SECTION_ORDER = Object\.freeze\(\["tasks", "attendance", "materials"\]\)/);
  assert.match(script, /DEFAULT_COLLAPSED = Object\.freeze\(\{ overview: false, tasks: false, attendance: true, materials: false \}\)/);
  const overviewIndex = html.indexOf('data-section-key="overview"');
  const tasksIndex = html.indexOf('data-section-key="tasks"');
  const attendanceIndex = html.indexOf('data-section-key="attendance"');
  const materialsIndex = html.indexOf('data-section-key="materials"');
  assert.ok(overviewIndex < tasksIndex && tasksIndex < attendanceIndex && attendanceIndex < materialsIndex);
});
