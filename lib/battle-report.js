import { attendanceLabel, formatDateTime } from "./normalizers.js";

export const GRADE_TITLES = Object.freeze({
  SSS: "教务系统重点保护对象",
  SS: "人形绩点打印机",
  S: "奖学金常驻人口",
  A: "考前临时抱佛脚大师",
  B: "六十分精准控制师",
  C: "课堂摸鱼总工程师",
  D: "作业延迟交付专家",
  F: "疑似已退学但仍在群里"
});

export function gradeRisk({ attendanceRate = null, missingHomeworkRate = null } = {}) {
  const validRates = [attendanceRate, missingHomeworkRate].filter(isRate);
  if (!validRates.length) return { riskRate: null, grade: null, title: "暂无等级" };

  const riskRate = Math.max(...validRates);
  let grade;
  if ((isRate(attendanceRate) && attendanceRate >= 0.2) || (isRate(missingHomeworkRate) && missingHomeworkRate >= 0.2)) grade = "F";
  else if (riskRate === 0) grade = "SSS";
  else if (riskRate <= 0.03) grade = "SS";
  else if (riskRate <= 0.06) grade = "S";
  else if (riskRate <= 0.09) grade = "A";
  else if (riskRate <= 0.12) grade = "B";
  else if (riskRate <= 0.15) grade = "C";
  else grade = "D";

  return { riskRate, grade, title: GRADE_TITLES[grade] };
}

export function battleRecordKey(record, type) {
  const prefix = type === "attendance" ? "attendance" : "homework";
  const stableId = type === "attendance" ? record.id : (record.sourceId ?? record.id);
  if (stableId !== null && stableId !== undefined && stableId !== "") {
    return `${prefix}:${record.courseId ?? "unknown"}:${stableId}`;
  }
  const parts = type === "attendance"
    ? [record.courseId, record.time, record.category, record.title, record.detail, record.rawStatus]
    : [record.courseId, record.deadlineAt, record.startAt, record.title, record.directUrl];
  return `${prefix}:fallback:${simpleHash(parts.map((value) => String(value ?? "")).join("\u001f"))}`;
}

export function buildBattleReport({ courses = [], courseResults = [], generatedAt = new Date() } = {}) {
  const generatedDate = validDate(generatedAt) || new Date();
  const homeworkByKey = new Map();
  const attendanceRecords = [];
  const failedCourses = [];
  const successfulCourseIds = new Set();

  for (const result of courseResults) {
    const course = result.course || courses.find((item) => item.id === result.courseId) || {
      id: result.courseId,
      name: result.courseName || "未命名课程"
    };
    const errors = Array.isArray(result.errors) ? result.errors : [];
    if (errors.length) {
      failedCourses.push({
        courseId: course.id,
        courseName: course.name,
        sections: errors.map((error) => error.section).filter(Boolean),
        message: errors.map((error) => `${error.section || "数据"}：${error.message}`).join("；")
      });
    } else {
      successfulCourseIds.add(course.id);
    }

    for (const item of Array.isArray(result.homework) ? result.homework : []) {
      const key = item.key || `${course.id}:homework:${item.sourceId}`;
      if (!homeworkByKey.has(key)) homeworkByKey.set(key, item);
    }

    const attendance = result.attendance;
    if (attendance?.records) {
      for (const record of attendance.records) {
        attendanceRecords.push({
          ...record,
          courseId: attendance.courseId ?? course.id,
          courseName: attendance.courseName || course.name,
          directUrl: attendance.directUrl
        });
      }
    }
  }

  const homeworkItems = [...homeworkByKey.values()];
  const submitted = homeworkItems.filter((item) => item.completed).length;
  const dueItems = homeworkItems.filter((item) => isHomeworkDue(item, generatedDate));
  const missingRecords = dueItems
    .filter((item) => !item.completed)
    .map((item) => ({ ...item, recordKey: battleRecordKey(item, "homework") }))
    .sort((a, b) => dateValue(b.deadlineAt) - dateValue(a.deadlineAt));

  const counts = countAttendance(attendanceRecords);
  const validAttendanceTotal = validAttendanceCount(counts);
  const absenceTotal = absenceCount(counts);
  const absenceRecords = attendanceRecords
    .filter((record) => ["absent", "personalLeave", "sickLeave"].includes(record.category))
    .map((record) => ({ ...record, recordKey: battleRecordKey(record, "attendance") }))
    .sort((a, b) => dateValue(b.time) - dateValue(a.time));

  const absenceRate = validAttendanceTotal > 0 ? absenceTotal / validAttendanceTotal : null;
  const missingRate = dueItems.length > 0 ? missingRecords.length / dueItems.length : null;
  const grading = gradeRisk({ attendanceRate: absenceRate, missingHomeworkRate: missingRate });

  return {
    generatedAt: generatedDate.toISOString(),
    courseCount: courses.length,
    successfulCourseCount: successfulCourseIds.size,
    failedCourses,
    incomplete: failedCourses.length > 0,
    homework: {
      total: homeworkItems.length,
      submitted,
      due: dueItems.length,
      missing: missingRecords.length,
      missingRate,
      missingRecords
    },
    attendance: {
      total: attendanceRecords.length,
      validTotal: validAttendanceTotal,
      punched: counts.present + counts.late,
      present: counts.present,
      late: counts.late,
      absent: counts.absent,
      personalLeave: counts.personalLeave,
      sickLeave: counts.sickLeave,
      absenceTotal,
      unknown: counts.other,
      absenceRate,
      absenceRecords
    },
    ...grading
  };
}

export function deriveBattleReport(rawReport, { hiddenAttendanceKeys = [], hiddenHomeworkKeys = [] } = {}) {
  if (!rawReport) return null;
  const attendanceKeys = new Set(hiddenAttendanceKeys);
  const homeworkKeys = new Set(hiddenHomeworkKeys);
  const removedAttendance = (rawReport.attendance?.absenceRecords || []).filter((record) => attendanceKeys.has(record.recordKey || battleRecordKey(record, "attendance")));
  const removedHomework = (rawReport.homework?.missingRecords || []).filter((record) => homeworkKeys.has(record.recordKey || battleRecordKey(record, "homework")));
  const absenceRecords = (rawReport.attendance?.absenceRecords || []).filter((record) => !attendanceKeys.has(record.recordKey || battleRecordKey(record, "attendance")));
  const missingRecords = (rawReport.homework?.missingRecords || []).filter((record) => !homeworkKeys.has(record.recordKey || battleRecordKey(record, "homework")));

  const removedByCategory = { absent: 0, personalLeave: 0, sickLeave: 0 };
  for (const record of removedAttendance) {
    if (Object.hasOwn(removedByCategory, record.category)) removedByCategory[record.category] += 1;
  }

  const attendance = {
    ...rawReport.attendance,
    total: Math.max(0, Number(rawReport.attendance?.total || 0) - removedAttendance.length),
    validTotal: Math.max(0, Number(rawReport.attendance?.validTotal || 0) - removedAttendance.length),
    absent: Math.max(0, Number(rawReport.attendance?.absent || 0) - removedByCategory.absent),
    personalLeave: Math.max(0, Number(rawReport.attendance?.personalLeave || 0) - removedByCategory.personalLeave),
    sickLeave: Math.max(0, Number(rawReport.attendance?.sickLeave || 0) - removedByCategory.sickLeave),
    absenceTotal: Math.max(0, Number(rawReport.attendance?.absenceTotal || 0) - removedAttendance.length),
    absenceRecords
  };
  attendance.absenceRate = attendance.validTotal > 0 ? attendance.absenceTotal / attendance.validTotal : null;

  const homework = {
    ...rawReport.homework,
    total: Math.max(0, Number(rawReport.homework?.total || 0) - removedHomework.length),
    due: Math.max(0, Number(rawReport.homework?.due || 0) - removedHomework.length),
    missing: missingRecords.length,
    missingRecords
  };
  homework.missingRate = homework.due > 0 ? homework.missing / homework.due : null;

  const grading = gradeRisk({ attendanceRate: attendance.absenceRate, missingHomeworkRate: homework.missingRate });
  return { ...rawReport, homework, attendance, ...grading };
}

export function groupReportRecords(records = []) {
  const groups = new Map();
  for (const record of records) {
    const key = record.courseId;
    if (!groups.has(key)) groups.set(key, { courseId: key, courseName: record.courseName || "未命名课程", records: [] });
    groups.get(key).records.push(record);
  }
  return [...groups.values()].sort((a, b) => a.courseName.localeCompare(b.courseName, "zh-CN"));
}

export function reportRecordDescription(record, type) {
  if (type === "attendance") {
    return `${formatDateTime(record.time)} · ${record.title || "点名记录"} · ${record.detail || attendanceLabel(record.category)}`;
  }
  return `${formatDateTime(record.deadlineAt)} 截止 · ${record.title || "未命名作业"}`;
}

function countAttendance(records) {
  const counts = { present: 0, late: 0, absent: 0, personalLeave: 0, sickLeave: 0, other: 0 };
  for (const record of records) {
    const category = Object.hasOwn(counts, record.category) ? record.category : "other";
    counts[category] += 1;
  }
  return counts;
}

function validAttendanceCount(counts) {
  return counts.present + counts.late + counts.absent + counts.personalLeave + counts.sickLeave;
}

function absenceCount(counts) {
  return counts.absent + counts.personalLeave + counts.sickLeave;
}

function isHomeworkDue(item, now) {
  if (item.sourceType && item.sourceType !== "homework") return false;
  const deadline = validDate(item.deadlineAt);
  if (!deadline || deadline > now) return false;
  const start = validDate(item.startAt);
  return !start || start <= now;
}

function isRate(value) {
  return Number.isFinite(value) && value >= 0;
}

function validDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateValue(value) {
  return validDate(value)?.getTime() || 0;
}

function simpleHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
