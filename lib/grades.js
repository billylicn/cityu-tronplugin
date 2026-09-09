import { absoluteUrl, extractArray } from "./normalizers.js";

export const GRADE_TYPE_LABELS = Object.freeze({
  homework: "作业",
  questionnaire: "问卷",
  exam: "线上考试"
});

export const GRADE_STATUS_LABELS = Object.freeze({
  published: "成绩已公布",
  unpublished: "成绩未公布",
  not_scored: "不计分"
});

export function normalizeHomeworkGrades(course, activitiesPayload, submissionPayload) {
  const activities = activityMap(activitiesPayload);
  const submissions = extractArray(submissionPayload, ["homework_activities", "items"]);
  return submissions
    .filter((item) => String(item?.status_code || "").toLowerCase() === "submitted")
    .map((item) => {
      const activity = activities.get(Number(item.id)) || {};
      const score = finiteNumber(item.score);
      return gradeBase(course, activity, item, {
        sourceType: "homework",
        score,
        scoreStatus: score === null ? "unpublished" : "published",
        weight: scorePercentage(activity),
        directUrl: `/course/${course.id}/learning-activity#/${item.id}`
      });
    })
    .filter(validGrade);
}

export function normalizeExamGrades(course, examsPayload, submittedPayload, scoresPayload) {
  const exams = extractArray(examsPayload, ["exams", "items"]);
  const submittedIds = new Set(extractArray(submittedPayload, ["exam_ids", "ids", "items"]).map(Number).filter(Number.isFinite));
  const scores = new Map(extractArray(scoresPayload, ["exam_scores", "scores", "items"])
    .map((item) => [Number(item?.activity_id ?? item?.id), item]));

  return exams
    .filter((exam) => submittedIds.has(Number(exam?.id)))
    .map((exam) => {
      const result = scores.get(Number(exam.id)) || {};
      const score = finiteNumber(result.score);
      return gradeBase(course, exam, exam, {
        sourceType: "exam",
        score,
        scoreStatus: score === null ? "unpublished" : "published",
        weight: scorePercentage(exam),
        directUrl: `/course/${course.id}/learning-activity#/exam/${exam.id}`
      });
    })
    .filter(validGrade);
}

export function normalizeQuestionnaireGrade(course, activity, detailPayload, submissionsPayload) {
  const detail = detailPayload && typeof detailPayload === "object" ? detailPayload : {};
  const submissions = extractArray(submissionsPayload, ["submissions", "items"]);
  if (detail.is_submitted !== true && submissions.length === 0) return null;

  const latest = [...submissions].sort((a, b) => dateValue(b?.created_at) - dateValue(a?.created_at))[0] || {};
  const isScored = detail.is_scored !== false && detail.data?.is_scored !== false;
  const score = isScored ? (finiteNumber(submissionsPayload?.exam_score) ?? finiteNumber(latest.score)) : null;
  const scoreStatus = !isScored ? "not_scored" : score === null ? "unpublished" : "published";

  return gradeBase(course, { ...activity, ...detail }, detail, {
    sourceType: "questionnaire",
    score,
    scoreStatus,
    weight: scorePercentage(detail) ?? scorePercentage(activity),
    submittedAt: latest.created_at || null,
    directUrl: `/course/${course.id}/learning-activity#/questionnaire/${detail.id || activity.id}`
  });
}

export function gradeScoreText(grade) {
  if (grade?.scoreStatus === "not_scored") return "不计分";
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
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        name: course.semesterName || course.academicYearName || "学期信息未提供",
        courses: []
      });
    }
    groups.get(key).courses.push(course);
  }
  return [...groups.values()];
}

function gradeBase(course, activity, fallback, options) {
  const sourceId = Number(activity?.id ?? fallback?.id);
  const scoreStatus = options.scoreStatus;
  return {
    courseId: Number(course.id),
    courseName: String(course.name || "未命名课程"),
    semesterId: finiteNumber(course.semesterId),
    semesterName: String(course.semesterName || course.academicYearName || ""),
    sourceType: options.sourceType,
    sourceId,
    title: String(activity?.title || fallback?.title || `${GRADE_TYPE_LABELS[options.sourceType]} ${sourceId}`).trim(),
    submitted: true,
    score: options.score,
    scoreText: gradeScoreText({ score: options.score, scoreStatus }),
    scoreStatus,
    scorePublished: scoreStatus === "published",
    weight: options.weight,
    submittedAt: options.submittedAt || fallback?.submitted_at || fallback?.created_at || null,
    directUrl: absoluteUrl(options.directUrl)
  };
}

function activityMap(payload) {
  return new Map(extractArray(payload, ["activities", "items"])
    .map((item) => [Number(item?.id), item]));
}

function validGrade(item) {
  return Number.isFinite(item.courseId) && Number.isFinite(item.sourceId);
}

function scorePercentage(source) {
  return finiteNumber(source?.score_percentage ?? source?.data?.score_percentage);
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatScore(value) {
  if (!Number.isFinite(value)) return "成绩未公布";
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

function dateValue(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.getTime() : 0;
}
