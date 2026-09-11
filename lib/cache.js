export const DASHBOARD_CACHE_KEY = "dashboardCacheV1";
export const BATTLE_REPORT_CACHE_KEY = "battleReportCacheV1";
export const GRADE_CACHE_KEY = "gradeCacheV2";
export const LEGACY_GRADE_CACHE_KEY = "gradeCacheV1";
export const CACHE_VERSION = 1;

const COURSE_FIELDS = ["id", "name", "code", "semesterName", "semesterId", "academicYearId", "academicYearName", "completeness", "status"];
const ACTIVITY_FIELDS = ["key", "courseId", "courseName", "sourceType", "sourceId", "title", "startAt", "deadlineAt", "completed", "status", "isGroupTask", "groupSetId", "directUrl", "rawStatus"];
const ATTENDANCE_RECORD_FIELDS = ["id", "title", "time", "category", "label", "detail", "rawStatus", "recordKey"];
const FILE_FIELDS = ["id", "uploadId", "referenceId", "activityId", "courseId", "courseName", "activityTitle", "name", "size", "type", "extension", "publishedAt", "status", "allowDownload", "originAllowDownload", "previewable", "directUrl"];
const REPORT_RECORD_FIELDS = [...ACTIVITY_FIELDS, ...ATTENDANCE_RECORD_FIELDS, "recordKey"];
const GRADE_SUMMARY_FIELDS = ["courseId", "courseName", "semesterId", "semesterName", "totalScore", "rawScore", "gpa", "scoreUpdatedAt", "exceptionalCase", "scoreStatus", "directUrl"];
const GRADE_DETAIL_FIELDS = ["courseId", "courseName", "sourceType", "sourceId", "title", "score", "scoreText", "scoreStatus", "weight", "directUrl"];

export function createDashboardCache(state, savedAt = new Date()) {
  return {
    version: CACHE_VERSION,
    savedAt: iso(savedAt),
    scope: state.scope === "history" ? "history" : "ongoing",
    historyCourseId: finiteOrNull(state.historyCourseId),
    courses: list(state.courses).map((item) => pick(item, COURSE_FIELDS)),
    loadedCourses: list(state.loadedCourses).map((item) => pick(item, COURSE_FIELDS)),
    activities: list(state.activities).map((item) => pick(item, ACTIVITY_FIELDS)),
    attendance: list(state.attendance).map(sanitizeAttendance),
    files: list(state.files).map((item) => pick(item, FILE_FIELDS)),
    errors: list(state.errors).map((item) => pick(item, ["courseId", "courseName", "section", "message"])),
    refreshedAt: iso(state.refreshedAt)
  };
}

export function readDashboardCache(value) {
  if (!validEnvelope(value)) return null;
  return createDashboardCache(value, value.savedAt);
}

export function createGradeCache(value, savedAt = new Date()) {
  const source = value && typeof value === "object" ? value : {};
  return {
    version: CACHE_VERSION,
    savedAt: iso(savedAt),
    courses: list(source.courses).map((item) => pick(item, COURSE_FIELDS)),
    terms: list(source.terms).map((term) => ({
      key: typeof term?.key === "string" ? term.key : "",
      name: typeof term?.name === "string" ? term.name : "",
      courseIds: list(term?.courseIds).map(finiteOrNull).filter(Number.isFinite),
      summaries: list(term?.summaries).map((item) => pick(item, GRADE_SUMMARY_FIELDS)),
      details: list(term?.details).map((detail) => ({
        courseId: finiteOrNull(detail?.courseId),
        loadedAt: iso(detail?.loadedAt),
        items: list(detail?.items).map((item) => pick(item, GRADE_DETAIL_FIELDS)),
        errors: list(detail?.errors).map((item) => pick(item, ["courseId", "courseName", "section", "message"]))
      })).filter((detail) => Number.isFinite(detail.courseId)),
      errors: list(term?.errors).map((item) => pick(item, ["courseId", "courseName", "section", "message"])),
      refreshedAt: iso(term?.refreshedAt)
    })).filter((term) => term.key)
  };
}

export function readGradeCache(value) {
  if (!validEnvelope(value)) return null;
  return createGradeCache(value, value.savedAt);
}

export function createBattleReportCache(rawReport, hiddenAttendanceKeys = [], hiddenHomeworkKeys = [], savedAt = new Date()) {
  return {
    version: CACHE_VERSION,
    savedAt: iso(savedAt),
    rawReport: sanitizeBattleReport(rawReport),
    hiddenAttendanceKeys: stringList(hiddenAttendanceKeys),
    hiddenHomeworkKeys: stringList(hiddenHomeworkKeys)
  };
}

export function readBattleReportCache(value) {
  if (!validEnvelope(value) || !value.rawReport) return null;
  return createBattleReportCache(value.rawReport, value.hiddenAttendanceKeys, value.hiddenHomeworkKeys, value.savedAt);
}

export function sanitizeBattleReport(report) {
  if (!report || typeof report !== "object") return null;
  return {
    generatedAt: iso(report.generatedAt),
    courseCount: number(report.courseCount),
    successfulCourseCount: number(report.successfulCourseCount),
    failedCourses: list(report.failedCourses).map((item) => pick(item, ["courseId", "courseName", "sections", "message"])),
    incomplete: Boolean(report.incomplete),
    homework: {
      total: number(report.homework?.total),
      submitted: number(report.homework?.submitted),
      due: number(report.homework?.due),
      missing: number(report.homework?.missing),
      missingRate: rate(report.homework?.missingRate),
      missingRecords: list(report.homework?.missingRecords).map((item) => pick(item, REPORT_RECORD_FIELDS))
    },
    attendance: {
      total: number(report.attendance?.total),
      validTotal: number(report.attendance?.validTotal),
      punched: number(report.attendance?.punched),
      present: number(report.attendance?.present),
      late: number(report.attendance?.late),
      absent: number(report.attendance?.absent),
      personalLeave: number(report.attendance?.personalLeave),
      sickLeave: number(report.attendance?.sickLeave),
      absenceTotal: number(report.attendance?.absenceTotal),
      unknown: number(report.attendance?.unknown),
      absenceRate: rate(report.attendance?.absenceRate),
      absenceRecords: list(report.attendance?.absenceRecords).map((item) => pick(item, REPORT_RECORD_FIELDS))
    },
    riskRate: rate(report.riskRate),
    grade: typeof report.grade === "string" ? report.grade : null,
    title: typeof report.title === "string" ? report.title : "暂无等级"
  };
}

function sanitizeAttendance(item) {
  return {
    ...pick(item, ["courseId", "courseName", "directUrl", "anomalyCount", "rollcallCount", "score"]),
    records: list(item.records).map((record) => pick(record, ATTENDANCE_RECORD_FIELDS)),
    counts: pick(item.counts || {}, ["present", "late", "absent", "personalLeave", "sickLeave", "other"]),
    setting: pick(item.setting || {}, ["arriveLateAsAbsence", "leaveEarlyAsAbsence", "personalLeaveAsAbsence", "sickLeaveAsAbsence", "lateCombineEarlyAsAbsence"])
  };
}

function pick(source, fields) {
  const output = {};
  if (!source || typeof source !== "object") return output;
  for (const field of new Set(fields)) {
    const value = source[field];
    if (value === undefined) continue;
    if (Array.isArray(value)) output[field] = value.filter((item) => ["string", "number", "boolean"].includes(typeof item));
    else if (value === null || ["string", "number", "boolean"].includes(typeof value)) output[field] = value;
  }
  return output;
}

function validEnvelope(value) {
  return Boolean(value && typeof value === "object" && value.version === CACHE_VERSION);
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function stringList(value) {
  return [...new Set(list(value).filter((item) => typeof item === "string"))];
}

function number(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function finiteOrNull(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function rate(value) {
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function iso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
