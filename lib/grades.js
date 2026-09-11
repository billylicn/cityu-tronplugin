import { absoluteUrl, extractArray } from "./normalizers.js";

export const GRADE_TYPE_LABELS = Object.freeze({
  homework: "作业",
  classroom_exam: "课堂考试",
  exam: "线上考试",
  forum: "讨论",
  web_link: "网页链接",
  questionnaire: "问卷",
  interaction: "互动",
  attendance: "考勤",
  performance: "课堂表现",
  online_video: "在线视频完成度",
  custom: "自定义成绩项",
  virtual_experiment: "虚拟实验"
});

export const GRADE_STATUS_LABELS = Object.freeze({
  published: "已获取成绩",
  unpublished: "成绩未公布"
});

const DETAIL_CONFIG = Object.freeze({
  homework: { activityKeys: ["homework_activities", "activities", "items"], scoreKeys: ["scores", "homework_scores", "items"] },
  classroom_exam: { activityKeys: ["classrooms", "classroom_list", "items"], scoreKeys: ["classroom_exam_scores", "classroom_scores", "scores", "items"] },
  exam: { activityKeys: ["exams", "items"], scoreKeys: ["exam_scores", "scores", "items"] },
  forum: { activityKeys: ["forum_activities", "activities", "items"], scoreKeys: ["forum_scores", "scores", "items"] },
  web_link: { activityKeys: ["web_link_activities", "activities", "items"], scoreKeys: ["web_link_scores", "scores", "items"] },
  questionnaire: { activityKeys: ["questionnaires", "items"], scoreKeys: ["questionnaire_scores", "scores", "items"] },
  interaction: { activityKeys: ["interactions", "items"], scoreKeys: ["interaction_scores", "scores", "items"] },
  custom: { activityKeys: ["custom_score_items", "items"], scoreKeys: ["custom_score_items", "scores", "items"] },
  virtual_experiment: { activityKeys: ["virtual_experiments", "items"], scoreKeys: ["virtual_experiment_scores", "virtual_experiments_scores", "scores", "items"] }
});

export function normalizeCourseGradeSummary(course, payload) {
  const selfScore = payload?.self_score && typeof payload.self_score === "object" ? payload.self_score : {};
  const totalScore = finiteNumber(selfScore.total_score);
  return {
    courseId: Number(course.id),
    courseName: String(course.name || "未命名课程"),
    semesterId: finiteNumber(course.semesterId),
    semesterName: String(course.semesterName || course.academicYearName || ""),
    totalScore,
    rawScore: finiteNumber(selfScore.raw_score),
    gpa: finiteNumber(selfScore.gpa) ?? finiteNumber(selfScore.grade_point),
    scoreUpdatedAt: validDateText(selfScore.instructor_score_time),
    exceptionalCase: safeText(selfScore.exceptional_case),
    scoreStatus: totalScore === null ? "unpublished" : "published",
    directUrl: absoluteUrl(`/course/${course.id}/score`)
  };
}

export function normalizeOfficialGradeItems(course, sourceType, activitiesPayload, scoresPayload = activitiesPayload) {
  const config = DETAIL_CONFIG[sourceType];
  if (!config) return [];
  const activities = extractArray(activitiesPayload, config.activityKeys);
  const scores = extractArray(scoresPayload, config.scoreKeys);
  const scoreById = new Map(scores.map((item) => [recordId(item), item]).filter(([id]) => Number.isFinite(id)));
  const activityById = new Map(activities.map((item) => [recordId(item), item]).filter(([id]) => Number.isFinite(id)));
  const ids = new Set([...activityById.keys(), ...scoreById.keys()]);
  return [...ids].map((id) => detailItem(course, sourceType, id, activityById.get(id) || {}, scoreById.get(id) || {}));
}

export function normalizeSingletonGradeItem(course, sourceType, payload, title) {
  if (!payload || typeof payload !== "object") return null;
  const score = firstFinite(payload, ["final_score", "score", "total_score", "student_score", "value"]);
  const weight = firstFinite(payload, ["score_percentage", "percentage", "weight"]);
  const hasData = score !== null || weight !== null || Object.keys(payload).length > 0;
  if (!hasData) return null;
  return {
    courseId: Number(course.id),
    courseName: String(course.name || "未命名课程"),
    sourceType,
    sourceId: null,
    title: title || GRADE_TYPE_LABELS[sourceType] || "成绩分项",
    score,
    scoreText: gradeScoreText({ score }),
    scoreStatus: score === null ? "unpublished" : "published",
    weight,
    directUrl: absoluteUrl(`/course/${course.id}/score`)
  };
}

export function gradeScoreText(grade) {
  if (!Number.isFinite(grade?.score)) return "成绩未公布";
  return formatScore(grade.score);
}

export function courseTermKey(course) {
  if (Number.isFinite(Number(course?.semesterId))) return `semester:${Number(course.semesterId)}`;
  if (Number.isFinite(Number(course?.academicYearId))) return `academic:${Number(course.academicYearId)}`;
  return `course:${Number(course?.id) || 0}`;
}

export function groupCoursesByTerm(courses) {
  const groups = new Map();
  for (const course of Array.isArray(courses) ? courses : []) {
    const key = courseTermKey(course);
    if (!groups.has(key)) groups.set(key, { key, name: course.semesterName || course.academicYearName || "学期信息未提供", courses: [] });
    groups.get(key).courses.push(course);
  }
  return [...groups.values()];
}

function detailItem(course, sourceType, id, activity, result) {
  const score = firstFinite(result, ["final_score", "score", "total_score", "student_score", "value"]);
  const weight = firstFinite(activity, ["score_percentage", "percentage", "weight"])
    ?? firstFinite(activity?.data, ["score_percentage", "percentage", "weight"])
    ?? firstFinite(result, ["score_percentage", "percentage", "weight"]);
  const title = safeText(activity.title) || safeText(activity.name) || safeText(result.title) || safeText(result.name)
    || `${GRADE_TYPE_LABELS[sourceType] || "成绩分项"} ${id}`;
  return {
    courseId: Number(course.id),
    courseName: String(course.name || "未命名课程"),
    sourceType,
    sourceId: id,
    title,
    score,
    scoreText: gradeScoreText({ score }),
    scoreStatus: score === null ? "unpublished" : "published",
    weight,
    directUrl: absoluteUrl(`/course/${course.id}/score`)
  };
}

function recordId(item) {
  return firstFinite(item, ["activity_id", "classroom_id", "exam_id", "forum_id", "web_link_id", "questionnaire_id", "interaction_id", "custom_score_item_id", "virtual_experiment_id", "id"]);
}

function firstFinite(source, fields) {
  if (!source || typeof source !== "object") return null;
  for (const field of fields) {
    const value = finiteNumber(source[field]);
    if (value !== null) return value;
  }
  return null;
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatScore(value) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

function safeText(value) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function validDateText(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
