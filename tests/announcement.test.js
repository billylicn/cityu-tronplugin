import test from "node:test";
import assert from "node:assert/strict";
import { announcementContent, announcementFingerprint } from "../lib/announcement.js";

const announcement = {
  label: "功能说明",
  title: "欢迎使用 CityU TronClass Plugin",
  publishedAt: "2026-09-09",
  paragraphs: ["插件会整理当前账号有权访问的课程学习信息。"],
  items: ["查看出勤和待提交任务。", "下载有权访问的课程文件。"],
  actionLabel: "查看开源项目与使用说明",
  actionUrl: "https://github.com/billylicn/cityu-tronplugin"
};

test("通知指纹对完全相同的结构化内容保持稳定", async () => {
  const first = await announcementFingerprint(announcement);
  const second = await announcementFingerprint({
    ...announcement,
    paragraphs: [...announcement.paragraphs],
    items: [...announcement.items]
  });
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first, second);
});

test("任一可见通知字段变化都会产生新的指纹", async () => {
  const original = await announcementFingerprint(announcement);
  const variants = [
    { ...announcement, label: "使用说明" },
    { ...announcement, title: `${announcement.title} 更新` },
    { ...announcement, publishedAt: "2026-09-10" },
    { ...announcement, paragraphs: [` ${announcement.paragraphs[0]}`] },
    { ...announcement, items: [...announcement.items, "新增内容"] },
    { ...announcement, actionLabel: "查看项目" },
    { ...announcement, actionUrl: `${announcement.actionUrl}/releases` }
  ];
  for (const variant of variants) {
    assert.notEqual(await announcementFingerprint(variant), original);
  }
});

test("通知内容按结构化字段标准化并过滤空列表项", () => {
  assert.deepEqual(announcementContent({
    ...announcement,
    paragraphs: [announcement.paragraphs[0], "", null],
    items: ["  ", announcement.items[0], 3]
  }), {
    ...announcement,
    paragraphs: [announcement.paragraphs[0]],
    items: [announcement.items[0]]
  });
});

test("空通知配置不会生成可展示内容或指纹", async () => {
  assert.equal(announcementContent(null), null);
  assert.equal(announcementContent({ title: "", paragraphs: [], items: [] }), null);
  assert.equal(announcementContent({ title: "只有标题", paragraphs: [], items: [] }), null);
  assert.equal(await announcementFingerprint(null), "");
});
