import test from "node:test";
import assert from "node:assert/strict";
import { battleRecordKey, buildBattleReport, deriveBattleReport, gradeRisk } from "../lib/battle-report.js";

const titles = { SSS: "教务系统重点保护对象", SS: "人形绩点打印机", S: "奖学金常驻人口", A: "考前临时抱佛脚大师", B: "六十分精准控制师", C: "课堂摸鱼总工程师", D: "作业延迟交付专家", F: "疑似已退学但仍在群里" };

test("评级覆盖全部边界，任一指标达到 20% 强制 F", () => {
  const cases = [
    [0, "SSS"], [0.03, "SS"], [0.030001, "S"], [0.06, "S"],
    [0.060001, "A"], [0.09, "A"], [0.090001, "B"], [0.12, "B"],
    [0.120001, "C"], [0.15, "C"], [0.150001, "D"], [0.199999, "D"], [0.2, "F"]
  ];
  for (const [rate, expected] of cases) {
    const result = gradeRisk({ attendanceRate: rate, missingHomeworkRate: 0 });
    assert.equal(result.grade, expected, `${rate} 应为 ${expected}`);
    assert.equal(result.title, titles[expected]);
  }
  assert.equal(gradeRisk({ attendanceRate: 0.01, missingHomeworkRate: 0.2 }).grade, "F");
  assert.equal(gradeRisk({ attendanceRate: null, missingHomeworkRate: null }).grade, null);
});

test("拍卡、缺勤和未知状态使用指定口径", () => {
  const report = buildBattleReport({
    courses: [{ id: 1, name: "示例课程" }],
    generatedAt: "2026-09-08T12:00:00Z",
    courseResults: [{
      course: { id: 1, name: "示例课程" },
      errors: [],
      homework: [],
      attendance: {
        courseId: 1,
        courseName: "示例课程",
        directUrl: "https://tronclass.cityu.edu.mo/course/1/rollcall",
        records: ["present", "late", "absent", "personalLeave", "sickLeave", "other"].map((category, id) => ({ id, category, time: `2026-09-0${id + 1}` }))
      }
    }]
  });
  assert.equal(report.attendance.punched, 2);
  assert.equal(report.attendance.absenceTotal, 3);
  assert.equal(report.attendance.validTotal, 5);
  assert.equal(report.attendance.unknown, 1);
  assert.equal(report.attendance.absenceRate, 3 / 5);
});

test("缺交率排除未来、未开放和无截止时间，已提交活动只算一次", () => {
  const common = { courseId: 1, courseName: "示例课程", sourceType: "homework", directUrl: "https://example.test" };
  const report = buildBattleReport({
    courses: [{ id: 1, name: "示例课程" }],
    generatedAt: "2026-09-08T12:00:00Z",
    courseResults: [{ course: { id: 1, name: "示例课程" }, errors: [], attendance: { records: [] }, homework: [
      { ...common, key: "1", sourceId: 1, title: "到期未交", deadlineAt: "2026-09-01", completed: false },
      { ...common, key: "2", sourceId: 2, title: "逾期后已交", deadlineAt: "2026-09-01", completed: true },
      { ...common, key: "2", sourceId: 2, title: "重复记录", deadlineAt: "2026-09-01", completed: true },
      { ...common, key: "3", sourceId: 3, title: "未来", deadlineAt: "2026-09-20", completed: false },
      { ...common, key: "4", sourceId: 4, title: "未开放", startAt: "2026-09-20", deadlineAt: "2026-09-01", completed: false },
      { ...common, key: "5", sourceId: 5, title: "无截止", completed: false }
    ] }]
  });
  assert.equal(report.homework.total, 5);
  assert.equal(report.homework.submitted, 1);
  assert.equal(report.homework.due, 2);
  assert.equal(report.homework.missing, 1);
  assert.equal(report.homework.missingRate, 0.5);
});

test("缺少一种指标时使用另一项，两项都为空时不产生虚假 SSS 或评价字段", () => {
  const homeworkOnly = buildBattleReport({
    courses: [{ id: 1, name: "示例课程" }],
    generatedAt: "2026-09-08",
    courseResults: [{ course: { id: 1, name: "示例课程" }, errors: [], attendance: { records: [] }, homework: [{ key: "a", sourceType: "homework", deadlineAt: "2026-09-01", completed: true }] }]
  });
  assert.equal(homeworkOnly.grade, "SSS");
  assert.equal(homeworkOnly.attendance.absenceRate, null);

  const empty = buildBattleReport({ courses: [], courseResults: [], generatedAt: "2026-09-08" });
  assert.equal(empty.grade, null);
  assert.equal(empty.riskRate, null);
  assert.equal("evaluation" in empty, false);
});

test("排除缺勤会同步扣除分母、异常分类并重新评级", () => {
  const raw = buildBattleReport({
    courses: [{ id: 1, name: "示例课程" }],
    generatedAt: "2026-09-08T12:00:00Z",
    courseResults: [{
      course: { id: 1, name: "示例课程" }, errors: [], homework: [],
      attendance: { courseId: 1, courseName: "示例课程", records: [
        { id: 1, category: "present", time: "2026-09-01" },
        { id: 2, category: "absent", time: "2026-09-02" },
        { id: 3, category: "personalLeave", time: "2026-09-03" }
      ] }
    }]
  });
  const hidden = raw.attendance.absenceRecords.find((record) => record.category === "absent").recordKey;
  const derived = deriveBattleReport(raw, { hiddenAttendanceKeys: [hidden] });
  assert.equal(derived.attendance.total, 2);
  assert.equal(derived.attendance.validTotal, 2);
  assert.equal(derived.attendance.absent, 0);
  assert.equal(derived.attendance.personalLeave, 1);
  assert.equal(derived.attendance.absenceTotal, 1);
  assert.equal(derived.attendance.absenceRate, 0.5);
  assert.equal(derived.attendance.absenceRecords.length, 1);
  assert.equal(derived.grade, "F");
});

test("排除缺交会同步扣除作业总数、到期分母并重新评级", () => {
  const common = { courseId: 1, courseName: "示例课程", sourceType: "homework", deadlineAt: "2026-09-01" };
  const raw = buildBattleReport({
    courses: [{ id: 1, name: "示例课程" }], generatedAt: "2026-09-08T12:00:00Z",
    courseResults: [{ course: { id: 1, name: "示例课程" }, errors: [], attendance: { records: [] }, homework: [
      { ...common, key: "done", sourceId: 1, title: "已交", completed: true },
      { ...common, key: "missing-a", sourceId: 2, title: "缺交一", completed: false },
      { ...common, key: "missing-b", sourceId: 3, title: "缺交二", completed: false }
    ] }]
  });
  const hidden = raw.homework.missingRecords[0].recordKey;
  const derived = deriveBattleReport(raw, { hiddenHomeworkKeys: [hidden] });
  assert.equal(derived.homework.total, 2);
  assert.equal(derived.homework.submitted, 1);
  assert.equal(derived.homework.due, 2);
  assert.equal(derived.homework.missing, 1);
  assert.equal(derived.homework.missingRate, 0.5);
  assert.equal(derived.homework.missingRecords.length, 1);
});

test("排除全部有效记录后显示暂无数据，不出现 NaN 或虚假等级", () => {
  const raw = buildBattleReport({
    courses: [{ id: 1, name: "示例课程" }], generatedAt: "2026-09-08T12:00:00Z",
    courseResults: [{
      course: { id: 1, name: "示例课程" }, errors: [], homework: [],
      attendance: { courseId: 1, courseName: "示例课程", records: [{ id: 1, category: "absent", time: "2026-09-01" }] }
    }]
  });
  const derived = deriveBattleReport(raw, { hiddenAttendanceKeys: [raw.attendance.absenceRecords[0].recordKey] });
  assert.equal(derived.attendance.validTotal, 0);
  assert.equal(derived.attendance.absenceRate, null);
  assert.equal(derived.riskRate, null);
  assert.equal(derived.grade, null);
});

test("记录键优先使用平台 ID，回退键保持确定性", () => {
  assert.equal(battleRecordKey({ courseId: 5, sourceId: 8 }, "homework"), "homework:5:8");
  assert.equal(battleRecordKey({ courseId: 5, id: 9 }, "attendance"), "attendance:5:9");
  const record = { courseId: 5, time: "2026-09-08", category: "absent", title: "点名" };
  assert.equal(battleRecordKey(record, "attendance"), battleRecordKey({ ...record }, "attendance"));
});
