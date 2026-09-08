export const TRONCLASS_ORIGIN = "https://tronclass.cityu.edu.mo";

export const TYPE_LABELS = Object.freeze({
  homework: "作业",
  exam: "线上测验",
  questionnaire: "问卷",
  discussion: "讨论",
  interaction: "互动"
});

export const STATUS_LABELS = Object.freeze({
  overdue: "逾期",
  pending: "进行中",
  upcoming: "即将开始",
  completed: "已完成",
  record: "仅记录"
});

export function normalizeCourse(course) {
  return {
    id: Number(course.id),
    name: text(course.name, "未命名课程"),
    code: text(course.course_code),
    academicYearId: numberOrNull(course.academic_year?.id),
    academicYearName: text(course.academic_year?.name || course.academic_year?.code),
    semesterId: numberOrNull(course.semester?.id),
    semesterName: text(course.semester?.name || course.semester?.real_name || course.semester?.code),
    completeness: finiteOrNull(course.study_completeness)
  };
}

/**
 * TronClass 的课程列表按平台当前学期优先返回。为了不使用本地日期猜测，
 * “进行中”定义为与列表第一门有效课程具有相同 semester.id 的课程。
 * 若缺少学期 ID，则退回 academic_year.id；仍缺失时只将第一门课程作为进行中。
 */
export function splitCoursesByPlatformTerm(courses) {
  if (!courses.length) return { ongoing: [], history: [] };
  const first = courses.find((course) => course.semesterId || course.academicYearId) || courses[0];
  let matches;
  if (first.semesterId) matches = (course) => course.semesterId === first.semesterId;
  else if (first.academicYearId) matches = (course) => course.academicYearId === first.academicYearId;
  else matches = (course) => course.id === first.id;
  return {
    ongoing: courses.filter(matches),
    history: courses.filter((course) => !matches(course))
  };
}

export function classifyActivity({ completed, startAt, deadlineAt, recordOnly = false }, now = new Date()) {
  if (recordOnly) return "record";
  if (completed) return "completed";
  const start = parseDate(startAt);
  const deadline = parseDate(deadlineAt);
  if (start && now < start) return "upcoming";
  if (deadline && now > deadline) return "overdue";
  return "pending";
}

export function normalizeHomework(course, item, now = new Date()) {
  const completed = item.submitted === true || Number(item.user_submit_count || 0) > 0;
  return activityBase(course, item, {
    sourceType: "homework",
    completed,
    deadlineAt: item.deadline || item.end_time,
    directUrl: `/course/${course.id}/learning-activity#/${item.id}`
  }, now);
}

export function normalizeExam(course, item, now = new Date()) {
  const completed = Number(item.submission_count || 0) > 0 || Number(item.submit_times || 0) > 0;
  return activityBase(course, item, {
    sourceType: "exam",
    completed,
    deadlineAt: item.end_time,
    directUrl: `/course/${course.id}/learning-activity#/exam/${item.id}`
  }, now);
}

export function normalizeQuestionnaire(course, item, now = new Date()) {
  const completed = Number(item.submission_count || 0) > 0;
  return activityBase(course, item, {
    sourceType: "questionnaire",
    completed,
    deadlineAt: item.end_time,
    directUrl: `/course/${course.id}/learning-activity#/questionnaire/${item.id}`
  }, now);
}

export function normalizeDiscussion(course, item, now = new Date()) {
  const activity = item.activity || item;
  // 产品规则：只看是否发过主题帖，回帖数量不计入完成。
  const completed = Number(item.current_user_topic_count || 0) > 0;
  return activityBase(course, { ...activity, id: item.id, title: item.title || activity.title }, {
    sourceType: "discussion",
    completed,
    deadlineAt: activity.end_time,
    directUrl: `/course/${course.id}/forum#/topic-category/${item.id}?show_sidebar=false`,
    rawStatus: completed ? "posted" : "not_posted"
  }, now);
}

export function normalizeInteraction(course, item, submissionResult, now = new Date()) {
  const submissions = extractArray(submissionResult, ["submissions", "items"]);
  const explicitSubmissionRequirement =
    item.requires_submission === true ||
    item.need_submit === true ||
    item.type === "exam" ||
    item.interaction_type === "exam" ||
    item.activity_type === "exam" ||
    submissionResult?.required === true;
  const endpointAvailable = submissionResult && submissionResult.__unavailable !== true;
  const recordOnly = !explicitSubmissionRequirement && (!endpointAvailable || submissions.length === 0);
  const completed = submissions.length > 0;
  return activityBase(course, item, {
    sourceType: "interaction",
    completed,
    recordOnly,
    deadlineAt: item.end_time,
    directUrl: `/course/${course.id}/learning-activity#/classroom/${item.id}`,
    rawStatus: item.status || (completed ? "participated" : "not_participated")
  }, now);
}

function activityBase(course, item, options, now) {
  const startAt = item.start_time || item.publish_time || item.created_at || null;
  const deadlineAt = options.deadlineAt || null;
  const isGroupTask = item.submit_by_group === true || Number(item.group_set_id || 0) > 0;
  const normalized = {
    key: `${course.id}:${options.sourceType}:${item.id}`,
    courseId: course.id,
    courseName: course.name,
    sourceType: options.sourceType,
    sourceId: Number(item.id),
    title: text(item.title || item.name, "未命名活动"),
    startAt,
    deadlineAt,
    completed: Boolean(options.completed),
    isGroupTask,
    groupSetId: numberOrNull(item.group_set_id),
    directUrl: absoluteUrl(options.directUrl),
    rawStatus: text(options.rawStatus || item.submitted_status || item.status || item.type)
  };
  normalized.status = classifyActivity({
    completed: normalized.completed,
    startAt,
    deadlineAt,
    recordOnly: Boolean(options.recordOnly)
  }, now);
  return normalized;
}

export function normalizeAttendance(course, records, score = {}, setting = {}) {
  const normalizedRecords = records.map((record, index) => {
    const category = attendanceCategory(record);
    return {
      id: Number(record.student_rollcall_id || record.rollcall_id || index),
      title: text(record.title, "点名记录"),
      time: record.rollcall_time || record.published_at || null,
      category,
      label: attendanceLabel(category),
      detail: text(record.student_status_detail),
      rawStatus: text(record.status || record.student_status || "unknown")
    };
  });
  const counts = { present: 0, late: 0, absent: 0, personalLeave: 0, sickLeave: 0, other: 0 };
  for (const record of normalizedRecords) counts[record.category] += 1;
  return {
    courseId: course.id,
    courseName: course.name,
    directUrl: absoluteUrl(`/course/${course.id}/rollcall`),
    records: normalizedRecords.sort((a, b) => dateValue(b.time) - dateValue(a.time)),
    counts,
    anomalyCount: counts.late + counts.absent + counts.personalLeave + counts.sickLeave + counts.other,
    rollcallCount: finiteOrNull(score.rollcall_count) ?? normalizedRecords.length,
    score: finiteOrNull(score.score),
    setting: {
      arriveLateAsAbsence: Boolean(setting.arrive_late_as_absence),
      leaveEarlyAsAbsence: Boolean(setting.leave_early_as_absence),
      personalLeaveAsAbsence: Boolean(setting.on_personal_leave_as_absence),
      sickLeaveAsAbsence: Boolean(setting.on_sick_leave_as_absence),
      lateCombineEarlyAsAbsence: Boolean(setting.late_combine_early_as_absence)
    }
  };
}

export function attendanceCategory(record) {
  const status = `${record.status || ""} ${record.student_status || ""} ${record.student_status_detail || ""}`.toLowerCase();
  if (status.includes("arrive_late") || status.includes("迟到") || status.includes("遲到")) return "late";
  if (status.includes("sick") || status.includes("病假")) return "sickLeave";
  if (status.includes("personal_leave") || status.includes("事假")) return "personalLeave";
  if (status.includes("absent")) return "absent";
  if (status.includes("on_call") || status.includes("fine") || status.includes("present")) return "present";
  return "other";
}

export function attendanceLabel(category) {
  return ({
    present: "出席",
    late: "迟到",
    absent: "缺席",
    personalLeave: "事假",
    sickLeave: "病假",
    other: "其他"
  })[category] || "其他";
}

export function normalizeCoursewares(course, activities) {
  const files = [];
  for (const activity of activities) {
    for (const upload of Array.isArray(activity.uploads) ? activity.uploads : []) {
      if (!upload || upload.deleted || !upload.id) continue;
      const filename = withExtension(text(upload.name, "未命名文件"), upload);
      files.push({
        id: Number(upload.id),
        referenceId: Number(upload.reference_id),
        activityId: Number(activity.id),
        activityTitle: text(activity.title, "课程文件"),
        courseId: course.id,
        courseName: course.name,
        name: filename,
        size: finiteOrNull(upload.size),
        type: text(upload.type || extension(filename).slice(1), "file"),
        status: text(upload.status, "unknown"),
        allowDownload: upload.allow_download === true,
        originAllowDownload: upload.origin_allow_download === true,
        previewable: canPreview(upload, filename),
        publishedAt: activity.start_time || activity.created_at || upload.referenced_at || upload.created_at || null,
        directUrl: absoluteUrl(`/course/${course.id}/learning-activity#/${activity.id}`)
      });
    }
  }
  const byId = new Map();
  for (const file of files) if (!byId.has(file.id)) byId.set(file.id, file);
  return [...byId.values()].sort((a, b) => dateValue(b.publishedAt) - dateValue(a.publishedAt));
}

export function extractArray(payload, preferredKeys = []) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  for (const key of preferredKeys) if (Array.isArray(payload[key])) return payload[key];
  for (const value of Object.values(payload)) if (Array.isArray(value)) return value;
  return [];
}

export function absoluteUrl(path) {
  return new URL(path, TRONCLASS_ORIGIN).href;
}

export function formatBytes(value) {
  if (!Number.isFinite(value) || value < 0) return "大小未知";
  const units = ["B", "KB", "MB", "GB"];
  let number = value;
  let index = 0;
  while (number >= 1024 && index < units.length - 1) {
    number /= 1024;
    index += 1;
  }
  return `${number >= 10 || index === 0 ? number.toFixed(0) : number.toFixed(1)} ${units[index]}`;
}

export function formatDateTime(value) {
  const date = parseDate(value);
  if (!date) return "未设置";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

export function formatRemainingTime(value, now = new Date()) {
  const deadline = parseDate(value);
  const current = parseDate(now);
  if (!deadline) return "未设截止时间";
  if (!current) return "剩余时间未知";

  const remaining = deadline.getTime() - current.getTime();
  if (remaining <= 0) return "已逾期";

  const hour = 60 * 60 * 1000;
  const day = 24 * hour;
  if (remaining >= day) return `剩余 ${Math.ceil(remaining / day)} 天`;
  return `剩余 ${Math.max(1, Math.ceil(remaining / hour))} 小时`;
}

export function remainingTimeUrgency(value, now = new Date()) {
  const deadline = parseDate(value);
  const current = parseDate(now);
  if (!deadline || !current) return "neutral";

  const remaining = deadline.getTime() - current.getTime();
  const day = 24 * 60 * 60 * 1000;
  if (remaining <= 0) return "overdue";
  if (remaining <= day) return "critical";
  if (remaining <= 3 * day) return "urgent";
  if (remaining <= 7 * day) return "warning";
  return "safe";
}

export function safePathSegment(value) {
  return text(value, "未命名").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim().slice(0, 100) || "未命名";
}

function canPreview(upload, filename) {
  const ext = extension(filename).toLowerCase();
  return upload.status === "ready" && (upload.type === "document" || [".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx"].includes(ext));
}

function withExtension(name, upload) {
  if (/\.[a-z0-9]{1,8}$/i.test(name)) return name;
  const hinted = text(upload.extension || upload.ext);
  if (hinted) return `${name}.${hinted.replace(/^\./, "")}`;
  return name;
}

function extension(name) {
  const match = String(name).match(/(\.[a-z0-9]{1,8})$/i);
  return match?.[1] || "";
}

function parseDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateValue(value) {
  return parseDate(value)?.getTime() || 0;
}

function text(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  const result = String(value).trim();
  return result || fallback;
}

function numberOrNull(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function finiteOrNull(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}
