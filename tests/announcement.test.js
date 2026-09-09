import test from "node:test";
import assert from "node:assert/strict";
import { announcementContent, announcementFingerprint } from "../lib/announcement.js";

const announcement = {
  title: "CityU TronClass Plugin v0.3.6",
  content: "CityU TronClass Plugin v0.3.6 已发布。",
  actionLabel: "查看 GitHub 项目",
  actionUrl: "https://github.com/billylicn/cityu-tronplugin"
};

test("通知指纹对完全相同的内容保持稳定", async () => {
  const first = await announcementFingerprint(announcement);
  const second = await announcementFingerprint({ ...announcement });
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first, second);
});

test("标题、正文或操作地址变化会产生新的通知指纹", async () => {
  const original = await announcementFingerprint(announcement);
  assert.notEqual(await announcementFingerprint({ ...announcement, title: `${announcement.title} 更新` }), original);
  assert.notEqual(await announcementFingerprint({ ...announcement, content: `${announcement.content} 新内容` }), original);
  assert.notEqual(await announcementFingerprint({ ...announcement, actionUrl: `${announcement.actionUrl}/releases` }), original);
  assert.notEqual(await announcementFingerprint({ ...announcement, content: ` ${announcement.content}` }), original);
});

test("空通知配置不会生成可展示内容或指纹", async () => {
  assert.equal(announcementContent(null), null);
  assert.equal(announcementContent({ title: "", content: "" }), null);
  assert.equal(await announcementFingerprint(null), "");
});
