import test from "node:test";
import assert from "node:assert/strict";
import {
  courseTermKey,
  gradeScoreText,
  groupCoursesByTerm,
  normalizeExamGrades,
  normalizeHomeworkGrades,
  normalizeQuestionnaireGrade
} from "../lib/grades.js";

const course = { id: 10, name: "测试课程", semesterId: 7, semesterName: "2025/2026 第一学期" };

test("作业成绩只展示已提交项目并保留 0 分和未公布状态", () => {
  const grades = normalizeHomeworkGrades(course, { activities: [
    { id: 1, title: "已评分作业", type: "homework", score_percentage: "20" },
    { id: 2, title: "未评分作业", type: "homework" },
    { id: 3, title: "未提交作业", type: "homework" }
  ] }, { homework_activities: [
    { id: 1, status_code: "submitted", score: 0 },
    { id: 2, status_code: "submitted", score: null },
    { id: 3, status_code: "absent", score: 100 }
  ] });
  assert.equal(grades.length, 2);
  assert.equal(grades[0].score, 0);
  assert.equal(grades[0].scoreText, "0");
  assert.equal(grades[0].weight, 20);
  assert.equal(grades[1].score, null);
  assert.equal(grades[1].scoreText, "成绩未公布");
});

test("考试使用 submitted-exams 判断本人是否提交，而不是 exam-scores 条目", () => {
  const grades = normalizeExamGrades(course, { exams: [
    { id: 11, title: "已交考试" },
    { id: 12, title: "未交考试" }
  ] }, { exam_ids: [11] }, { exam_scores: [
    { activity_id: 11, score: 87 },
    { activity_id: 12, score: 99 }
  ] });
  assert.deepEqual(grades.map((item) => item.title), ["已交考试"]);
  assert.equal(grades[0].score, 87);
});

test("问卷支持匿名、未计分、未公布与提交时间", () => {
  const scored = normalizeQuestionnaireGrade(course, { id: 21, title: "匿名问卷" }, {
    id: 21, title: "匿名问卷", is_anonymous: true, is_scored: true, is_submitted: true
  }, { exam_score: 100, submissions: [{ id: 999, score: "100.0", created_at: "2025-01-01T00:00:00Z", answers: "不应进入模型" }] });
  assert.equal(scored.scoreText, "100");
  assert.equal(scored.submittedAt, "2025-01-01T00:00:00Z");
  assert.equal("answers" in scored, false);

  const notScored = normalizeQuestionnaireGrade(course, { id: 22, title: "意见调查" }, {
    id: 22, is_scored: false, is_submitted: true
  }, { submissions: [{ score: null }] });
  assert.equal(notScored.scoreStatus, "not_scored");
  assert.equal(gradeScoreText(notScored), "不计分");

  assert.equal(normalizeQuestionnaireGrade(course, { id: 23 }, { id: 23, is_submitted: false }, { submissions: [] }), null);
});

test("课程按平台学期字段分组，不使用本地日期", () => {
  const courses = [
    { id: 1, semesterId: 9, semesterName: "当前学期" },
    { id: 2, semesterId: 9, semesterName: "当前学期" },
    { id: 3, semesterId: 8, semesterName: "历史学期" }
  ];
  assert.equal(courseTermKey(courses[0]), "semester:9");
  const groups = groupCoursesByTerm(courses);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].courses.map((item) => item.id), [1, 2]);
});
