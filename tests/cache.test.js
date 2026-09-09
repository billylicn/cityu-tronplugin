import test from "node:test";
import assert from "node:assert/strict";
import {
  CACHE_VERSION,
  createBattleReportCache,
  createGradeCache,
  createDashboardCache,
  readBattleReportCache,
  readDashboardCache,
  readGradeCache
} from "../lib/cache.js";

test("学习总览缓存使用白名单且不持久化身份、凭证与签名数据", () => {
  const cache = createDashboardCache({
    scope: "ongoing",
    historyCourseId: null,
    student: { name: "不应保存", studentNumber: "不应保存", internalUserId: 999, email: "EMAIL_SHOULD_NOT_PERSIST" },
    courses: [{ id: 1, name: "示例课程", semesterName: "示例学期", internalUserId: 999, token: "secret" }],
    loadedCourses: [{ id: 1, name: "示例课程" }],
    activities: [{ key: "a", courseId: 1, courseName: "示例课程", sourceType: "homework", sourceId: 2, title: "示例作业", completed: false, cookie: "secret" }],
    attendance: [{ courseId: 1, courseName: "示例课程", records: [{ id: 3, category: "absent", time: "2026-09-08", jwt: "secret" }], counts: { absent: 1 }, bootstrap: { name: "hidden" } }],
    files: [{ id: 4, referenceId: 5, activityId: 6, courseId: 1, courseName: "示例课程", name: "示例.pdf", signedUrl: "https://tcmedia.cityu.edu.mo/download/file/private", blob: "binary" }],
    errors: [],
    refreshedAt: "2026-09-08T12:00:00Z"
  }, "2026-09-08T12:01:00Z");
  const serialized = JSON.stringify(cache);
  for (const forbidden of ["不应保存", "studentNumber", "internalUserId", "EMAIL_SHOULD_NOT_PERSIST", "cookie", "jwt", "bootstrap", "signedUrl", "binary", "secret"]) {
    assert.equal(serialized.includes(forbidden), false, `缓存不应包含 ${forbidden}`);
  }
  assert.equal(cache.version, CACHE_VERSION);
  assert.equal(cache.courses[0].name, "示例课程");
  assert.equal(cache.activities[0].title, "示例作业");
});

test("缓存版本不兼容时安全忽略", () => {
  assert.equal(readDashboardCache({ version: 999 }), null);
  assert.equal(readBattleReportCache({ version: 999, rawReport: {} }), null);
});

test("战绩缓存保留排除键并移除评价和未知字段", () => {
  const cache = createBattleReportCache({
    generatedAt: "2026-09-08T12:00:00Z",
    courseCount: 1,
    successfulCourseCount: 1,
    failedCourses: [],
    incomplete: false,
    homework: { total: 1, submitted: 0, due: 1, missing: 1, missingRate: 1, missingRecords: [{ courseId: 1, sourceId: 2, title: "示例作业", recordKey: "homework:1:2", token: "secret" }] },
    attendance: { total: 1, validTotal: 1, punched: 0, present: 0, late: 0, absent: 1, personalLeave: 0, sickLeave: 0, absenceTotal: 1, unknown: 0, absenceRate: 1, absenceRecords: [{ courseId: 1, id: 3, category: "absent", recordKey: "attendance:1:3", cookie: "secret" }] },
    riskRate: 1,
    grade: "F",
    title: "固定称号",
    evaluation: "不应保存"
  }, ["attendance:1:3"], ["homework:1:2"], "2026-09-08T12:01:00Z");
  assert.deepEqual(cache.hiddenAttendanceKeys, ["attendance:1:3"]);
  assert.deepEqual(cache.hiddenHomeworkKeys, ["homework:1:2"]);
  const serialized = JSON.stringify(cache);
  assert.equal(serialized.includes("evaluation"), false);
  assert.equal(serialized.includes("不应保存"), false);
  assert.equal(serialized.includes("secret"), false);
});


test("成绩缓存只保留展示字段，不保存身份、作答内容和原始响应", () => {
  const cache = createGradeCache({
    student: { name: "不应保存", studentNumber: "NO", internalUserId: 123 },
    courses: [{ id: 1, name: "课程", semesterId: 9, token: "secret" }],
    terms: [{
      key: "semester:9",
      name: "当前学期",
      courseIds: [1],
      grades: [{
        courseId: 1, courseName: "课程", sourceType: "questionnaire", sourceId: 2, title: "问卷",
        submitted: true, score: 100, scoreText: "100", scoreStatus: "published", scorePublished: true,
        weight: 5, submittedAt: "2026-09-01T00:00:00Z", directUrl: "https://tronclass.cityu.edu.mo/course/1",
        answers: "秘密答案", submissionId: 99, cookie: "secret"
      }],
      errors: [],
      refreshedAt: "2026-09-09T00:00:00Z",
      rawResponse: { private: true }
    }]
  }, "2026-09-09T00:01:00Z");
  const serialized = JSON.stringify(cache);
  for (const forbidden of ["不应保存", "studentNumber", "internalUserId", "秘密答案", "submissionId", "cookie", "secret", "rawResponse"]) {
    assert.equal(serialized.includes(forbidden), false, `成绩缓存不应包含 ${forbidden}`);
  }
  assert.equal(cache.terms[0].grades[0].score, 100);
  assert.equal(readGradeCache(cache).terms[0].key, "semester:9");
});
