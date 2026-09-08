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
