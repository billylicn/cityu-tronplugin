import test from "node:test";
import assert from "node:assert/strict";
import { MANUAL_REFRESH_REMINDER_MS, manualRefreshReminderDue, validReminderSince } from "../lib/refresh-reminder.js";

const baseline = "2026-09-13T00:00:00.000Z";
const baselineTime = Date.parse(baseline);

test("自动刷新开启时永远不显示手动刷新提醒", () => {
  assert.equal(manualRefreshReminderDue({ autoRefresh: true, reminderSince: baseline, now: baselineTime + MANUAL_REFRESH_REMINDER_MS }), false);
});

test("自动刷新关闭达到连续 24 小时时提醒", () => {
  assert.equal(manualRefreshReminderDue({ autoRefresh: false, reminderSince: baseline, now: baselineTime + MANUAL_REFRESH_REMINDER_MS - 1 }), false);
  assert.equal(manualRefreshReminderDue({ autoRefresh: false, reminderSince: baseline, now: baselineTime + MANUAL_REFRESH_REMINDER_MS }), true);
  assert.equal(manualRefreshReminderDue({ autoRefresh: false, reminderSince: baseline, now: baselineTime + MANUAL_REFRESH_REMINDER_MS + 1 }), true);
});

test("无效提醒时间不会导致首次打开立即提醒", () => {
  assert.equal(validReminderSince("not-a-date"), "");
  assert.equal(manualRefreshReminderDue({ autoRefresh: false, reminderSince: "", now: baselineTime + MANUAL_REFRESH_REMINDER_MS }), false);
});
