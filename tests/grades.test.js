import test from "node:test";
import assert from "node:assert/strict";
import {
  GRADE_STATUS_LABELS,
  courseTermKey,
  groupCoursesByTerm,
  normalizeCourseGradeSummary,
  normalizeOfficialGradeItems,
  normalizeSingletonGradeItem
} from "../lib/grades.js";

const course = { id: 10, name: "测试课程", semesterId: 7, semesterName: "测试学期" };


test("数值成绩状态只表示已获取，不宣称最终成绩已经公布", () => {
  assert.equal(GRADE_STATUS_LABELS.published, "已获取成绩");
  assert.equal(GRADE_STATUS_LABELS.unpublished, "成绩未公布");
});

test("课程总成绩只使用 student-self-score 的 total_score", () => {
  const summary = normalizeCourseGradeSummary(course, { self_score: {
    raw_score: "87.2", total_score: "87.0", instructor_score_time: "2026-01-01T00:00:00Z", exceptional_case: "none"
  } });
  assert.equal(summary.totalScore, 87);
  assert.equal(summary.rawScore, 87.2);
  assert.equal(summary.scoreStatus, "published");
  assert.equal(summary.gpa, null);
  assert.match(summary.directUrl, /\/course\/10\/score$/);
});

test("官方总成绩保留明确 0，空值为未公布", () => {
  assert.equal(normalizeCourseGradeSummary(course, { self_score: { total_score: 0 } }).totalScore, 0);
  const unpublished = normalizeCourseGradeSummary(course, { self_score: { total_score: null } });
  assert.equal(unpublished.totalScore, null);
  assert.equal(unpublished.scoreStatus, "unpublished");
});

test("GPA 只接受后台明确提供的 gpa 或 grade_point", () => {
  assert.equal(normalizeCourseGradeSummary(course, { self_score: { total_score: 90, gpa: "3.75" } }).gpa, 3.75);
  assert.equal(normalizeCourseGradeSummary(course, { self_score: { total_score: 90, grade_point: 4 } }).gpa, 4);
  assert.equal(normalizeCourseGradeSummary(course, { self_score: { total_score: 95, grade: "A" } }).gpa, null);
});

test("官方分项按活动 ID 配对且不保留学生身份字段", () => {
  const items = normalizeOfficialGradeItems(course, "homework", {
    homework_activities: [{ id: 1, title: "测试作业", score_percentage: "20.00" }]
  }, {
    scores: [{ activity_id: 1, final_score: "91.0", student_id: 99999, comments: "不应进入模型" }]
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].score, 91);
  assert.equal(items[0].weight, 20);
  assert.equal(items[0].title, "测试作业");
  assert.equal("student_id" in items[0], false);
  assert.equal("comments" in items[0], false);
});

test("官方分项兼容成绩页实际返回的课堂考试与虚拟实验集合名", () => {
  const classroomItems = normalizeOfficialGradeItems(course, "classroom_exam", {
    classrooms: [{ id: 11, title: "课堂考试" }]
  }, {
    classroom_scores: [{ activity_id: 11, score: "76" }]
  });
  const virtualItems = normalizeOfficialGradeItems(course, "virtual_experiment", {
    virtual_experiments: [{ id: 12, title: "虚拟实验" }]
  }, {
    virtual_experiments_scores: [{ virtual_experiment_id: 12, final_score: "82" }]
  });
  assert.equal(classroomItems[0].score, 76);
  assert.equal(virtualItems[0].score, 82);
});

test("单项考勤成绩明确 0 正常显示", () => {
  const item = normalizeSingletonGradeItem(course, "attendance", { score: "0", score_percentage: "10.00", student_id: 1 }, "考勤");
  assert.equal(item.score, 0);
  assert.equal(item.scoreText, "0");
  assert.equal(item.weight, 10);
  assert.equal("student_id" in item, false);
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
