import test from "node:test";
import assert from "node:assert/strict";
import { TronClassApi, extractStudentProfile, mapLimit } from "../lib/api.js";

test("只从 globalData.user 提取页面展示所需的学生信息", () => {
  const html = `
    <script>
      var globalData = {
        user: {
          id: 12345,
          name: "测试学生 TEST STUDENT",
          userNo: "TEST-STUDENT-ID",
          mobile: "不应提取",
          email: "EMAIL_SHOULD_NOT_BE_EXTRACTED"
        }
      };
    </script>`;
  assert.deepEqual(extractStudentProfile(html), {
    internalUserId: 12345,
    name: "测试学生 TEST STUDENT",
    studentNumber: "TEST-STUDENT-ID"
  });
  assert.equal(extractStudentProfile("<html></html>"), null);
});

test("预览另存只接受 tcmedia 的签名文件 URL", async () => {
  const good = new TronClassApi({ fetchImpl: async () => new Response(JSON.stringify({ status: "ready", url: "https://tcmedia.cityu.edu.mo/download/file/abc?token=ok" }), { status: 200, headers: { "content-type": "application/json" } }) });
  const file = { previewable: true, referenceId: 1, activityId: 2 };
  assert.equal(await good.resolvePreviewUrl(file), "https://tcmedia.cityu.edu.mo/download/file/abc?token=ok");

  const bad = new TronClassApi({ fetchImpl: async () => new Response(JSON.stringify({ status: "ready", url: "https://example.com/file?token=bad" }), { status: 200, headers: { "content-type": "application/json" } }) });
  await assert.rejects(() => bad.resolvePreviewUrl(file), /没有返回可另存/);
});

test("mapLimit 保持结果顺序且限制并发", async () => {
  let active = 0;
  let maximum = 0;
  const result = await mapLimit([1, 2, 3, 4, 5], 2, async (value) => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return value * 2;
  });
  assert.deepEqual(result, [2, 4, 6, 8, 10]);
  assert.equal(maximum, 2);
});

test("战绩报告每门课程只读取作业和考勤接口", async () => {
  const paths = [];
  const api = new TronClassApi({ now: () => new Date("2026-09-08T12:00:00Z") });
  api.getPaged = async (path) => {
    paths.push(path);
    if (path.includes("homework-activities")) return [{ id: 7, title: "作业", submitted: true, deadline: "2026-09-01" }];
    return [{ rollcall_id: 9, status: "on_call_fine", rollcall_time: "2026-09-01" }];
  };

  const progress = [];
  const report = await api.loadBattleReportCourses([{ id: 1, name: "课程" }], {
    internalUserId: 88,
    onProgress: (value) => progress.push(value.completed)
  });

  assert.deepEqual(paths, [
    "/api/courses/1/homework-activities",
    "/api/course/1/student/88/rollcalls"
  ]);
  assert.deepEqual(progress, [1]);
  assert.equal(report.homework.submitted, 1);
  assert.equal(report.attendance.punched, 1);
});

test("战绩报告保留单课程局部错误而不中止", async () => {
  const api = new TronClassApi({ now: () => new Date("2026-09-08T12:00:00Z") });
  api.getPaged = async (path) => {
    if (path.includes("homework-activities")) throw new Error("作业接口暂时不可用");
    return [];
  };
  const report = await api.loadBattleReportCourses([{ id: 2, name: "异常课程" }], { internalUserId: 88 });
  assert.equal(report.incomplete, true);
  assert.equal(report.failedCourses.length, 1);
  assert.match(report.failedCourses[0].message, /作业接口暂时不可用/);
});

test("成绩读取使用后台 API，并按课程并发 2 处理", async () => {
  const api = new TronClassApi();
  let active = 0;
  let maximum = 0;
  api.loadCourseGrades = async (course) => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return { course, grades: [{ courseId: course.id, sourceId: course.id }], errors: [] };
  };
  const progress = [];
  const result = await api.loadGradesCourses([{ id: 1 }, { id: 2 }, { id: 3 }], {
    onProgress: ({ completed }) => progress.push(completed)
  });
  assert.equal(maximum, 2);
  assert.equal(result.grades.length, 3);
  assert.deepEqual(progress.sort((a, b) => a - b), [1, 2, 3]);
});

test("单课程成绩读取合并作业、考试和问卷后台接口", async () => {
  const api = new TronClassApi();
  const paths = [];
  api.requestJson = async (path) => {
    paths.push(path);
    if (path.includes("/activities")) return { activities: [
      { id: 10, type: "homework", title: "作业" },
      { id: 30, type: "questionnaire", title: "问卷" }
    ] };
    if (path.includes("homework/submission-status")) return { homework_activities: [{ id: 10, status_code: "submitted", score: 80 }] };
    if (path.endsWith("/exams")) return { exams: [{ id: 20, title: "考试" }] };
    if (path.includes("submitted-exams")) return { exam_ids: [20] };
    if (path.includes("exam-scores")) return { exam_scores: [{ activity_id: 20, score: 90 }] };
    if (path === "/api/questionnaires/30") return { id: 30, title: "问卷", is_submitted: true, is_scored: true };
    if (path === "/api/questionnaire/30/submissions") return { exam_score: 100, submissions: [{ score: "100" }] };
    throw new Error(`unexpected ${path}`);
  };
  const result = await api.loadCourseGrades({ id: 1, name: "课程" });
  assert.deepEqual(result.grades.map((item) => item.sourceType).sort(), ["exam", "homework", "questionnaire"]);
  assert.ok(paths.includes("/api/courses/1/activities?sub_course_id=0"));
  assert.ok(paths.includes("/api/course/1/homework/submission-status?no-intercept=true"));
  assert.ok(paths.includes("/api/courses/1/submitted-exams?no-intercept=true"));
  assert.ok(paths.includes("/api/questionnaire/30/submissions"));
});

test("单门课程成绩读取异常不会中止其他课程", async () => {
  const api = new TronClassApi();
  api.loadCourseGrades = async (course) => {
    if (course.id === 2) throw new Error("课程成绩接口暂时不可用");
    return { course, grades: [{ courseId: course.id, sourceId: course.id }], errors: [] };
  };

  const result = await api.loadGradesCourses([
    { id: 1, name: "课程一" },
    { id: 2, name: "课程二" },
    { id: 3, name: "课程三" }
  ]);

  assert.deepEqual(result.grades.map((item) => item.courseId), [1, 3]);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].courseId, 2);
  assert.match(result.errors[0].message, /暂时不可用/);
});

test("无作业课程的提交状态 404 不显示为成绩读取错误", async () => {
  const api = new TronClassApi();
  api.requestJson = async (path) => {
    if (path.includes("/activities")) return { activities: [{ id: 30, type: "questionnaire", title: "未提交问卷" }] };
    if (path.includes("homework/submission-status")) {
      const error = new Error("请求失败（HTTP 404）");
      error.status = 404;
      throw error;
    }
    if (path.endsWith("/exams")) return { exams: [] };
    if (path.includes("submitted-exams")) return { exam_ids: [] };
    if (path.includes("exam-scores")) return { exam_scores: [] };
    if (path === "/api/questionnaires/30") return { id: 30, is_submitted: false, is_scored: false };
    if (path === "/api/questionnaire/30/submissions") {
      const error = new Error("请求失败（HTTP 404）");
      error.status = 404;
      throw error;
    }
    throw new Error(`unexpected ${path}`);
  };

  const result = await api.loadCourseGrades({ id: 1, name: "无作业课程" });
  assert.deepEqual(result.grades, []);
  assert.deepEqual(result.errors, []);
});

test("确定性 4xx 响应不会重复重试", async () => {
  let requests = 0;
  const api = new TronClassApi({
    fetchImpl: async () => {
      requests += 1;
      return new Response(JSON.stringify({ message: "Not Found" }), {
        status: 404,
        headers: { "content-type": "application/json" }
      });
    }
  });

  await assert.rejects(() => api.requestJson("/api/missing"), /HTTP 404/);
  assert.equal(requests, 1);
});
