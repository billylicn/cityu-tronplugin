import {
  TRONCLASS_ORIGIN,
  extractArray,
  normalizeAttendance,
  normalizeCourse,
  normalizeCoursewares,
  normalizeDiscussion,
  normalizeExam,
  normalizeHomework,
  normalizeInteraction,
  normalizeQuestionnaire
} from "./normalizers.js";
import { buildBattleReport } from "./battle-report.js";
import { normalizeExamGrades, normalizeHomeworkGrades, normalizeQuestionnaireGrade } from "./grades.js";

const PAGE_SIZE = 100;

export class AuthError extends Error {
  constructor(message = "TronClass 登录已失效") {
    super(message);
    this.name = "AuthError";
  }
}

class HttpError extends Error {
  constructor(status) {
    super(`请求失败（HTTP ${status}）`);
    this.name = "HttpError";
    this.status = status;
  }
}

export class TronClassApi {
  constructor({ fetchImpl = (...args) => globalThis.fetch(...args), now = () => new Date() } = {}) {
    this.fetchImpl = fetchImpl;
    this.now = now;
  }

  async getCourses() {
    let rawCourses;
    let postError;

    // 新版 TronClass 使用只读查询式 POST；旧版仍可能支持 GET，因此保留回退。
    try {
      rawCourses = await this.getMyCoursesByPost();
    } catch (error) {
      if (error instanceof AuthError) throw error;
      postError = error;
    }

    if (!rawCourses) {
      try {
        const payload = await this.requestJson("/api/my-courses");
        rawCourses = extractArray(payload, ["courses", "items"]);
        if (!rawCourses.length && !hasArrayCollection(payload, ["courses", "items"])) {
          throw postError || new Error("课程接口返回格式无法识别");
        }
      } catch (error) {
        if (error instanceof AuthError) throw error;
        throw new AuthError(`无法读取课程，请先登录 TronClass（${error?.message || String(error)}）`);
      }
    }

    return rawCourses.map(normalizeCourse).filter((course) => Number.isFinite(course.id));
  }

  async getMyCoursesByPost() {
    const items = [];
    for (let page = 1; page <= 20; page += 1) {
      const payload = await this.requestJson("/api/my-courses", {
        method: "POST",
        body: JSON.stringify({ page, page_size: PAGE_SIZE, fields: "", conditions: {} }),
        headers: { "Content-Type": "application/json" }
      });
      const batch = extractArray(payload, ["courses", "items"]);
      if (!batch.length && page === 1 && !hasArrayCollection(payload, ["courses", "items"])) {
        throw new Error("课程接口返回格式无法识别");
      }
      items.push(...batch);
      const { pages, total } = paginationInfo(payload, items.length);
      if (page >= pages || batch.length === 0 || items.length >= total) break;
    }
    return items;
  }

  async loadCourses(courseList, { onProgress, internalUserId: providedInternalUserId } = {}) {
    const internalUserId = providedInternalUserId ?? await this.getInternalUserId().catch(() => null);
    const output = { activities: [], attendance: [], files: [], errors: [] };

    await mapLimit(courseList, 2, async (course, index) => {
      onProgress?.({ index, total: courseList.length, course });
      const result = await this.loadCourse(course, internalUserId);
      output.activities.push(...result.activities);
      output.attendance.push(result.attendance);
      output.files.push(...result.files);
      output.errors.push(...result.errors);
    });

    output.attendance = output.attendance.filter(Boolean);
    return output;
  }

  async loadBattleReportCourses(courseList, { onProgress, internalUserId: providedInternalUserId } = {}) {
    const internalUserId = providedInternalUserId ?? await this.getInternalUserId();
    let completed = 0;
    let authenticationFailed = false;

    const courseResults = await mapLimit(courseList, 2, async (course) => {
      if (authenticationFailed) return null;

      const settled = await Promise.allSettled([
        this.getPaged(`/api/courses/${course.id}/homework-activities`, "homework_activities"),
        this.getPaged(`/api/course/${course.id}/student/${internalUserId}/rollcalls`, "rollcalls")
      ]);
      const authFailure = settled.find((result) => result.status === "rejected" && result.reason instanceof AuthError);
      if (authFailure) {
        authenticationFailed = true;
        throw authFailure.reason;
      }

      const errors = [];
      const sections = ["作业", "出勤"];
      settled.forEach((result, index) => {
        if (result.status === "rejected") {
          errors.push({
            courseId: course.id,
            courseName: course.name,
            section: sections[index],
            message: result.reason?.message || String(result.reason)
          });
        }
      });

      const homeworkItems = settled[0].status === "fulfilled" ? settled[0].value : [];
      const attendanceRecords = settled[1].status === "fulfilled" ? settled[1].value : [];
      const result = {
        course,
        homework: homeworkItems.map((item) => normalizeHomework(course, item, this.now())),
        attendance: settled[1].status === "fulfilled" ? normalizeAttendance(course, attendanceRecords) : null,
        errors
      };

      completed += 1;
      onProgress?.({ completed, total: courseList.length, course, errors });
      return result;
    });

    return buildBattleReport({
      courses: courseList,
      courseResults: courseResults.filter(Boolean),
      generatedAt: this.now()
    });
  }

  async loadGradesCourses(courseList, { onProgress } = {}) {
    const output = { grades: [], errors: [], courseResults: [] };
    let completed = 0;
    let authenticationFailed = false;

    const results = await mapLimit(courseList, 2, async (course) => {
      if (authenticationFailed) return null;
      try {
        const result = await this.loadCourseGrades(course);
        completed += 1;
        onProgress?.({ completed, total: courseList.length, course, errors: result.errors });
        return result;
      } catch (error) {
        if (error instanceof AuthError) {
          authenticationFailed = true;
          throw error;
        }
        const errors = [gradeError(course, "成绩读取", error)];
        completed += 1;
        onProgress?.({ completed, total: courseList.length, course, errors });
        return { course, grades: [], errors };
      }
    });

    for (const result of results.filter(Boolean)) {
      output.grades.push(...result.grades);
      output.errors.push(...result.errors);
      output.courseResults.push(result);
    }
    return output;
  }

  async loadCourseGrades(course) {
    const settled = await Promise.allSettled([
      this.requestJson(`/api/courses/${course.id}/activities?sub_course_id=0`),
      this.requestJson(`/api/course/${course.id}/homework/submission-status?no-intercept=true`),
      this.requestJson(`/api/courses/${course.id}/exams`),
      this.requestJson(`/api/courses/${course.id}/submitted-exams?no-intercept=true`),
      this.requestJson(`/api/courses/${course.id}/exam-scores?no-intercept=true`)
    ]);

    const authFailure = settled.find((result) => result.status === "rejected" && result.reason instanceof AuthError);
    if (authFailure) throw authFailure.reason;

    const errors = [];
    const sections = ["成绩活动", "作业成绩", "考试列表", "考试提交状态", "考试成绩"];
    const value = (index, fallback = {}) => settled[index]?.status === "fulfilled" ? settled[index].value : fallback;
    const activitiesPayload = value(0);
    const activityItems = extractArray(activitiesPayload, ["activities", "items"]);
    const hasHomeworkActivity = activityItems.some((activity) => activity?.type === "homework");
    settled.forEach((result, index) => {
      if (result.status !== "rejected") return;
      // TronClass 在完全没有作业的课程中会让作业提交状态端点返回 404。
      // 这代表“没有该类成绩”，不是读取失败，不应向学生显示误导性的局部错误。
      if (index === 1 && result.reason?.status === 404 && !hasHomeworkActivity) return;
      errors.push(gradeError(course, sections[index], result.reason));
    });
    const grades = [];

    if (settled[1].status === "fulfilled") {
      grades.push(...normalizeHomeworkGrades(course, activitiesPayload, value(1)));
    }
    if (settled[2].status === "fulfilled" && settled[3].status === "fulfilled") {
      grades.push(...normalizeExamGrades(course, value(2), value(3), value(4)));
    }

    const questionnaires = extractArray(activitiesPayload, ["activities", "items"])
      .filter((activity) => activity?.type === "questionnaire" && Number.isFinite(Number(activity?.id)));
    const questionnaireResults = await mapLimit(questionnaires, 3, async (activity) => {
      const details = await Promise.allSettled([
        this.requestJson(`/api/questionnaires/${activity.id}`),
        this.requestJson(`/api/questionnaire/${activity.id}/submissions`)
      ]);
      const questionnaireAuthFailure = details.find((result) => result.status === "rejected" && result.reason instanceof AuthError);
      if (questionnaireAuthFailure) throw questionnaireAuthFailure.reason;
      if (details[0].status === "rejected") {
        errors.push(gradeError(course, `问卷成绩：${activity.title || activity.id}`, details[0].reason));
        return null;
      }
      if (details[1].status === "rejected" && details[1].reason?.status !== 404) {
        errors.push(gradeError(course, `问卷成绩：${activity.title || activity.id}`, details[1].reason));
        return null;
      }
      // 未提交问卷的 submissions 端点可能返回 404；详情中的 is_submitted 仍可安全判定状态。
      const submissionsPayload = details[1].status === "fulfilled" ? details[1].value : { submissions: [] };
      return normalizeQuestionnaireGrade(course, activity, details[0].value, submissionsPayload);
    });
    grades.push(...questionnaireResults.filter(Boolean));

    return {
      course,
      grades: grades.sort((a, b) => a.sourceType.localeCompare(b.sourceType) || a.title.localeCompare(b.title, "zh-CN")),
      errors
    };
  }

  async loadCourse(course, internalUserId) {
    const errors = [];
    const now = this.now();
    const settled = await Promise.allSettled([
      this.getPaged(`/api/courses/${course.id}/homework-activities`, "homework_activities"),
      this.getPaged(`/api/courses/${course.id}/exam-list`, "exams"),
      this.getPaged(`/api/courses/${course.id}/questionnaire-list`, "questionnaires"),
      this.getPaged(`/api/courses/${course.id}/topic-categories`, "topic_categories"),
      this.getInteractions(course.id),
      this.getPaged(`/api/course/${course.id}/coursewares`, "activities"),
      this.getAttendance(course, internalUserId)
    ]);
    const names = ["作业", "线上测验", "问卷", "讨论", "互动", "课程文件", "出勤"];
    settled.forEach((result, index) => {
      if (result.status === "rejected") {
        if (result.reason instanceof AuthError) throw result.reason;
        errors.push({ courseId: course.id, courseName: course.name, section: names[index], message: result.reason?.message || String(result.reason) });
      }
    });

    const value = (index, fallback) => settled[index]?.status === "fulfilled" ? settled[index].value : fallback;
    return {
      activities: [
        ...value(0, []).map((item) => normalizeHomework(course, item, now)),
        ...value(1, []).map((item) => normalizeExam(course, item, now)),
        ...value(2, []).map((item) => normalizeQuestionnaire(course, item, now)),
        ...value(3, []).map((item) => normalizeDiscussion(course, item, now)),
        ...value(4, []).map(({ item, submissions }) => normalizeInteraction(course, item, submissions, now))
      ],
      files: normalizeCoursewares(course, value(5, [])),
      attendance: value(6, null),
      errors
    };
  }

  async getAttendance(course, internalUserId) {
    if (!internalUserId) throw new Error("无法取得出勤所需的内部标识");
    const [score, setting, records] = await Promise.all([
      this.requestJson(`/api/course/${course.id}/rollcall-score`).catch(() => ({})),
      this.requestJson(`/api/course/${course.id}/rollcall/setting`).catch(() => ({})),
      this.getPaged(`/api/course/${course.id}/student/${internalUserId}/rollcalls`, "rollcalls")
    ]);
    return normalizeAttendance(course, records, score, setting);
  }

  async getInteractions(courseId) {
    const [interactionsResult, classroomsResult] = await Promise.allSettled([
      this.getPaged(`/api/courses/${courseId}/interactions`, "interactions"),
      this.getPaged(`/api/courses/${courseId}/classroom-list`, "classrooms")
    ]);
    const interactions = interactionsResult.status === "fulfilled" ? interactionsResult.value : [];
    const classrooms = classroomsResult.status === "fulfilled" ? classroomsResult.value : [];
    if (interactionsResult.status === "rejected" && classroomsResult.status === "rejected") throw interactionsResult.reason;

    const map = new Map();
    for (const item of [...interactions, ...classrooms]) if (item?.id) map.set(Number(item.id), item);
    return mapLimit([...map.values()], 3, async (item) => {
      let submissions;
      try {
        submissions = await this.requestJson(`/api/classroom-exams/${item.id}/my-submissions`, { retries: 0 });
      } catch (error) {
        if (error instanceof AuthError) throw error;
        submissions = { __unavailable: true, submissions: [] };
      }
      return { item, submissions };
    });
  }

  async getPaged(path, preferredKey) {
    const items = [];
    for (let page = 1; page <= 20; page += 1) {
      const separator = path.includes("?") ? "&" : "?";
      const payload = await this.requestJson(`${path}${separator}page=${page}&page_size=${PAGE_SIZE}`);
      const batch = extractArray(payload, [preferredKey]);
      items.push(...batch);
      const { pages, total } = paginationInfo(payload, items.length);
      if (page >= pages || batch.length === 0 || items.length >= total) break;
    }
    return items;
  }

  async getInternalUserId() {
    const student = await this.getCurrentStudent();
    return student.internalUserId;
  }

  async getCurrentStudent() {
    const response = await this.request("/", { retries: 1, expectJson: false, cache: "no-store" });
    const html = await response.text();
    const profile = extractStudentProfile(html);
    if (profile) return profile;

    const patterns = [
      /["']userId["']\s*:\s*["']?(\d+)["']?/i,
      /statisticsSettings\s*=\s*\{[^}]{0,1000}?userId\s*:\s*["']?(\d+)["']?/i,
      /["']user["']\s*:\s*\{[^}]{0,1000}?["']id["']\s*:\s*(\d+)/i
    ];
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match) return { internalUserId: Number(match[1]), name: "", studentNumber: "" };
    }
    throw new Error("页面中没有找到内部用户标识");
  }

  async resolvePreviewUrl(file) {
    if (!file.previewable || !file.referenceId || !file.activityId) throw new Error("该附件不支持授权预览另存");
    const path = `/api/uploads/reference/document/${file.referenceId}/url?preview=true&refer_id=${file.activityId}&refer_type=learning_activity`;
    const payload = await this.requestJson(path, { retries: 1, cache: "no-store" });
    const url = new URL(payload?.url || "");
    if (payload?.status !== "ready" || url.origin !== "https://tcmedia.cityu.edu.mo" || !url.pathname.startsWith("/download/file/") || !url.searchParams.has("token")) {
      throw new Error("平台没有返回可另存的完整预览文件");
    }
    return url.href;
  }

  officialDownloadUrl(referenceId) {
    return `${TRONCLASS_ORIGIN}/api/uploads/reference/${Number(referenceId)}/blob`;
  }

  async requestJson(path, options = {}) {
    const response = await this.request(path, { ...options, expectJson: true });
    try {
      return await response.json();
    } catch {
      throw new Error("TronClass 返回了无法解析的数据");
    }
  }

  async request(path, { retries = 2, expectJson = false, headers = {}, ...init } = {}) {
    const url = new URL(path, TRONCLASS_ORIGIN);
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const response = await this.fetchImpl(url.href, {
          method: "GET",
          credentials: "include",
          cache: init.cache || "no-cache",
          headers: { Accept: expectJson ? "application/json" : "text/html,application/xhtml+xml", ...headers },
          ...init
        });
        if (response.status === 401) throw new AuthError();
        if (response.status === 429 || response.status >= 500) {
          if (attempt < retries) {
            await delay(350 * 2 ** attempt);
            continue;
          }
          throw new HttpError(response.status);
        }
        if (!response.ok) throw new HttpError(response.status);
        if (expectJson) {
          const contentType = response.headers.get("content-type") || "";
          if (!contentType.includes("json")) throw new AuthError("当前会话未登录 TronClass");
        }
        return response;
      } catch (error) {
        if (error instanceof AuthError) throw error;
        lastError = error;
        // 4xx 是确定性响应（429 除外），重复请求不会改善结果；仅重试网络错误。
        if (error instanceof HttpError) break;
        if (attempt < retries) await delay(350 * 2 ** attempt);
      }
    }
    throw lastError || new Error("网络请求失败");
  }
}

function gradeError(course, section, error) {
  return {
    courseId: course.id,
    courseName: course.name,
    section,
    message: error?.message || String(error)
  };
}

export function extractStudentProfile(html) {
  const source = String(html || "");
  const globalDataIndex = source.search(/\bglobalData\s*=\s*\{/i);
  if (globalDataIndex < 0) return null;

  const globalDataSlice = source.slice(globalDataIndex, globalDataIndex + 12000);
  const userMatch = globalDataSlice.match(/\buser\s*:\s*\{/i);
  if (!userMatch) return null;

  // TronClass 的 globalData.user 是服务器输出的扁平对象。只截取较小片段并读取三个必要字段，
  // 不执行页面脚本，也不保留手机号、邮箱等其余身份资料。
  const userSlice = globalDataSlice.slice((userMatch.index || 0) + userMatch[0].length, (userMatch.index || 0) + userMatch[0].length + 3000);
  const internalUserId = extractNumericProperty(userSlice, "id");
  if (!internalUserId) return null;

  return {
    internalUserId,
    name: extractStringProperty(userSlice, "name"),
    studentNumber: extractStringProperty(userSlice, "userNo")
  };
}

export async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

function paginationInfo(payload, loadedCount) {
  const source = payload?.pagination || payload?.meta || payload || {};
  const pages = Number(source.pages || source.page_count || source.total_pages || 1);
  const total = Number(source.total || source.total_count || loadedCount);
  return {
    pages: Number.isFinite(pages) && pages > 0 ? pages : 1,
    total: Number.isFinite(total) && total >= 0 ? total : loadedCount
  };
}

function hasArrayCollection(payload, keys) {
  return Boolean(payload && typeof payload === "object" && keys.some((key) => Array.isArray(payload[key])));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractNumericProperty(source, property) {
  const pattern = new RegExp(`(?:["']?${property}["']?)\\s*:\\s*["']?(\\d+)["']?`, "i");
  const value = Number(source.match(pattern)?.[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function extractStringProperty(source, property) {
  const pattern = new RegExp(`(?:["']?${property}["']?)\\s*:\\s*(["'])((?:\\\\.|(?!\\1)[\\s\\S])*)\\1`, "i");
  const raw = source.match(pattern)?.[2];
  if (!raw) return "";
  return raw
    .replace(/\\u([0-9a-f]{4})/gi, (_match, code) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/\\x([0-9a-f]{2})/gi, (_match, code) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/\\n/g, " ")
    .replace(/\\r/g, " ")
    .replace(/\\t/g, " ")
    .replace(/\\([\\/"'])/g, "$1")
    .trim();
}
