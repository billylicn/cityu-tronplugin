import test from "node:test";
import assert from "node:assert/strict";
import {
  attendanceCategory,
  classifyActivity,
  formatRemainingTime,
  remainingTimeUrgency,
  normalizeDiscussion,
  normalizeExam,
  normalizeHomework,
  normalizeQuestionnaire,
  normalizeCoursewares,
  splitCoursesByPlatformTerm
} from "../lib/normalizers.js";

const course = { id: 10, name: "测试课程" };
const now = new Date("2025-01-10T12:00:00Z");

test("作业优先使用 submitted，并兼容 user_submit_count", () => {
  assert.equal(normalizeHomework(course, { id: 1, title: "A", submitted: true }, now).completed, true);
  assert.equal(normalizeHomework(course, { id: 2, title: "B", submitted: false, user_submit_count: 1 }, now).completed, true);
  assert.equal(normalizeHomework(course, { id: 3, title: "C", submitted: false, user_submit_count: 0 }, now).completed, false);
});

test("测验与问卷使用各自提交数字段", () => {
  assert.equal(normalizeExam(course, { id: 1, submission_count: 1 }, now).completed, true);
  assert.equal(normalizeExam(course, { id: 2, submit_times: 2 }, now).completed, true);
  assert.equal(normalizeQuestionnaire(course, { id: 3, submission_count: 0 }, now).completed, false);
});

test("讨论只按发帖数量判断，回帖不算完成", () => {
  const replyOnly = normalizeDiscussion(course, { id: 4, title: "讨论", current_user_topic_count: 0, current_user_reply_count: 99 }, now);
  const posted = normalizeDiscussion(course, { id: 5, title: "讨论", current_user_topic_count: 1, current_user_reply_count: 0 }, now);
  assert.equal(replyOnly.completed, false);
  assert.equal(replyOnly.rawStatus, "not_posted");
  assert.equal(posted.completed, true);
  assert.equal(posted.rawStatus, "posted");
});

test("活动状态覆盖即将开始、待办、逾期、完成和仅记录", () => {
  assert.equal(classifyActivity({ completed: false, startAt: "2025-01-11T00:00:00Z" }, now), "upcoming");
  assert.equal(classifyActivity({ completed: false, startAt: "2025-01-01T00:00:00Z", deadlineAt: "2025-01-11T00:00:00Z" }, now), "pending");
  assert.equal(classifyActivity({ completed: false, deadlineAt: "2025-01-09T00:00:00Z" }, now), "overdue");
  assert.equal(classifyActivity({ completed: true, deadlineAt: "2025-01-09T00:00:00Z" }, now), "completed");
  assert.equal(classifyActivity({ completed: false, recordOnly: true }, now), "record");
});

test("剩余完成时间按天或小时展示", () => {
  assert.equal(formatRemainingTime("2025-01-13T12:00:00Z", now), "剩余 3 天");
  assert.equal(formatRemainingTime("2025-01-10T17:01:00Z", now), "剩余 6 小时");
  assert.equal(formatRemainingTime("2025-01-10T12:01:00Z", now), "剩余 1 小时");
  assert.equal(formatRemainingTime(null, now), "未设截止时间");
  assert.equal(formatRemainingTime("2025-01-10T11:59:00Z", now), "已逾期");
});

test("剩余完成时间按截止距离返回颜色等级", () => {
  assert.equal(remainingTimeUrgency("2025-01-11T12:00:00Z", now), "critical");
  assert.equal(remainingTimeUrgency("2025-01-11T12:00:01Z", now), "urgent");
  assert.equal(remainingTimeUrgency("2025-01-13T12:00:00Z", now), "urgent");
  assert.equal(remainingTimeUrgency("2025-01-13T12:00:01Z", now), "warning");
  assert.equal(remainingTimeUrgency("2025-01-17T12:00:00Z", now), "warning");
  assert.equal(remainingTimeUrgency("2025-01-17T12:00:01Z", now), "safe");
  assert.equal(remainingTimeUrgency(null, now), "neutral");
  assert.equal(remainingTimeUrgency("2025-01-10T11:59:00Z", now), "overdue");
});

test("课程进行中分组按平台首个学期 ID，不使用日期", () => {
  const courses = [
    { id: 1, semesterId: 47, academicYearId: 23 },
    { id: 2, semesterId: 47, academicYearId: 23 },
    { id: 3, semesterId: 42, academicYearId: 21 }
  ];
  const result = splitCoursesByPlatformTerm(courses);
  assert.deepEqual(result.ongoing.map((item) => item.id), [1, 2]);
  assert.deepEqual(result.history.map((item) => item.id), [3]);
});

test("出勤状态标准化", () => {
  assert.equal(attendanceCategory({ status: "on_call_fine", student_status: "on_call" }), "present");
  assert.equal(attendanceCategory({ status: "on_call_arrive_late" }), "late");
  assert.equal(attendanceCategory({ status: "absent" }), "absent");
  assert.equal(attendanceCategory({ status: "on_personal_leave" }), "personalLeave");
  assert.equal(attendanceCategory({ student_status_detail: "病假" }), "sickLeave");
  assert.equal(attendanceCategory({ status: "new_status" }), "other");
});

test("课程文件以 upload.id 去重并保留授权能力", () => {
  const upload = { id: 88, reference_id: 99, name: "讲义.pdf", size: 100, type: "document", status: "ready", allow_download: false, origin_allow_download: true };
  const files = normalizeCoursewares(course, [
    { id: 1, title: "第一课", uploads: [upload] },
    { id: 2, title: "重复引用", uploads: [upload] }
  ]);
  assert.equal(files.length, 1);
  assert.equal(files[0].previewable, true);
  assert.equal(files[0].allowDownload, false);
});

test("课程文件保留平台允许下载的所有文件类型", () => {
  const files = normalizeCoursewares(course, [{
    id: 3,
    title: "课程资源",
    uploads: [
      { id: 101, reference_id: 201, name: "源代码.zip", type: "archive", status: "ready", allow_download: true },
      { id: 102, reference_id: 202, name: "课堂录像.mp4", type: "video", status: "ready", allow_download: true },
      { id: 103, reference_id: 203, name: "数据.csv", type: "spreadsheet", status: "ready", allow_download: true }
    ]
  }]);
  assert.deepEqual(new Set(files.map((file) => file.name)), new Set(["源代码.zip", "课堂录像.mp4", "数据.csv"]));
  assert.ok(files.every((file) => file.allowDownload));
});
