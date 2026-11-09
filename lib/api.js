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
import { normalizeCourseGradeSummary, normalizeOfficialGradeItems, normalizeSingletonGradeItem } from "./grades.js";
import { completionEligibility, isViewOnlyActivity, normalizeCompletionSnapshot } from "./completion.js";

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
    const output = { activities: [], attendance: [], files: [], errors: [], successfulSectionCount: 0 };

    await mapLimit(courseList, 2, async (course, index) => {
      onProgress?.({ index, total: courseList.length, course });
      const result = await this.loadCourse(course, internalUserId);
      output.activities.push(...result.activities);
      output.attendance.push(result.attendance);
      output.files.push(...result.files);
      output.errors.push(...result.errors);
      output.successfulSectionCount += Number(result.successfulSectionCount || 0);
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
    const output = { summaries: [], errors: [] };
    let completed = 0;
    let authenticationFailed = false;

    const results = await mapLimit(courseList, 2, async (course) => {
      if (authenticationFailed) return null;
      try {
        const summary = await this.loadCourseGradeSummary(course);
        completed += 1;
        onProgress?.({ completed, total: courseList.length, course, errors: [] });
        return { summary, errors: [] };
      } catch (error) {
        if (error instanceof AuthError) {
          authenticationFailed = true;
          throw error;
        }
        const errors = [gradeError(course, "课程总成绩", error)];
        completed += 1;
        onProgress?.({ completed, total: courseList.length, course, errors });
        return { summary: null, errors };
      }
    });

    for (const result of results.filter(Boolean)) {
      if (result.summary) output.summaries.push(result.summary);
      output.errors.push(...result.errors);
    }
    return output;
  }

  async loadCourseGradeSummary(course) {
    const payload = await this.requestJson(`/api/course/${course.id}/student-self-score`);
    return normalizeCourseGradeSummary(course, payload);
  }

  async loadCompletionCourses(courseList, { internalUserId, onProgress } = {}) {
    const userId = internalUserId ?? await this.getInternalUserId();
    let completed = 0;
    let authenticationFailed = false;
    const snapshots = await mapLimit(courseList, 2, async (course) => {
      if (authenticationFailed) return null;
      try {
        const snapshot = await this.loadCourseCompletion(course, { internalUserId: userId });
        onProgress?.({ completed: ++completed, total: courseList.length, course });
        return snapshot;
      } catch (error) {
        if (error instanceof AuthError) authenticationFailed = true;
        throw error;
      }
    });
    return snapshots.filter(Boolean);
  }

  async loadCourseCompletion(course, { internalUserId } = {}) {
    const courseId = positiveId(course.id);
    const userId = internalUserId ?? await this.getInternalUserId();
    // Verified against the CityU front end and the authenticated my-stat page.
    const definitions = [
      ["课程完成度", () => this.requestJson(`/api/course/${courseId}/my-completeness`)],
      ["学习活动", () => this.getCompletionCollection(`/api/courses/${courseId}/activities`, "activities")],
      ["测验完成要求", () => this.getCompletionCollection(`/api/courses/${courseId}/exams?no-intercept=true`, "exams")],
      ["活动阅读状态", () => this.getCompletionCollection(`/api/course/${courseId}/activity-reads-for-user`, "activity_reads")],
      ["课程公告", () => this.getCompletionCollection(`/api/courses/${courseId}/bulletins`, "bulletins")],
      ["公告阅读统计", () => this.requestJson(`/api/stat/students/${positiveId(userId)}/courses/${courseId}`)]
    ];
    const settled = await Promise.allSettled(definitions.map(([, load]) => load()));
    const auth = settled.find(r => r.status === "rejected" && r.reason instanceof AuthError);
    if (auth) throw auth.reason;
    const errors = settled.flatMap((r, index) => r.status === "rejected" ? [gradeError(course, definitions[index][0], r.reason)] : []);
    const value = index => settled[index].status === "fulfilled" ? settled[index].value : undefined;
    const snapshot = normalizeCompletionSnapshot(course, {
      summary: value(0), activities: value(1), exams: value(2), reads: value(3), bulletins: value(4),
      bulletinStats: value(5)?.student_stats, errors
    }, this.now());
    snapshot.stale = !value(0) || snapshot.percent === null || snapshot.total === null
      || snapshot.totalCompleted === null || snapshot.totalCompleted > snapshot.total;
    return snapshot;
  }

  async getCompletionCollection(path, key) {
    const items = [];
    for (let page = 1; page <= 20; page += 1) {
      const separator = path.includes("?") ? "&" : "?";
      const payload = await this.requestJson(`${path}${separator}page=${page}&page_size=${PAGE_SIZE}`, { cache: "no-store" });
      if (!Array.isArray(payload?.[key])) throw new Error("平台返回的完成度列表格式无法识别");
      items.push(...payload[key]);
      const { pages, total } = paginationInfo(payload, items.length);
      if (page >= pages || !payload[key].length || items.length >= total) return items;
    }
    throw new Error("完成度列表超过分页上限，未将不完整结果当作全部记录");
  }

  async readCompletionResource(course, item, { shouldStop = () => false } = {}) {
    const courseId = positiveId(course.id), id = positiveId(item?.id);
    if (Number(item.courseId) !== courseId || !completionEligibility(item).allowed) throw new Error("该项目不允许一键查看");
    const checkStop = () => { if (shouldStop()) throw new DOMException("已停止", "AbortError"); };
    checkStop();
    if (item.type === "bulletin") {
      // Fetch the actual content and recheck course membership before recording a view.
      const bulletins = await this.getCompletionCollection(`/api/courses/${courseId}/bulletins`, "bulletins");
      const bulletin = bulletins.find(b => Number(b.id) === id && !b.deleted);
      if (!bulletin || typeof bulletin.content !== "string") throw new Error("无法确认此课程公告的内容");
      checkStop();
      await this.request(`/api/bulletins/${id}/read`, { method: "POST", retries: 0 });
      return;
    }
    // A normalized/cache item is never authority to write: validate live metadata again.
    const activity = await this.requestJson(`/api/activities/${id}`, { cache: "no-store" });
    if (Number(activity.id) !== id || Number(activity.course_id) !== courseId || activity.type !== item.type
      || !isViewOnlyActivity(activity) || activity.published !== true || activity.is_started === false
      || activity.is_in_progress === false || activity.is_closed === true || !prerequisitesCompleted(activity.prerequisites)) {
      throw completionUnsupported("此项目的最新完成要求或访问条件不允许一键查看");
    }
    checkStop();
    if (activity.type === "page") {
      if (typeof activity.data?.content !== "string" && typeof activity.data?.description !== "string") throw new Error("教材正文格式无法识别");
      await this.#recordCompletionView(id, {});
      return;
    }
    const uploads = [...new Map((Array.isArray(activity.uploads) ? activity.uploads : [])
      .filter(upload => !upload.deleted).map(upload => [positiveId(upload.id), upload])).values()];
    if (!uploads.length) throw completionUnsupported("教材没有可核实的普通附件，请手动查看");
    for (const upload of uploads) {
      checkStop();
      if (!ordinaryCompletionUpload(upload)) throw completionUnsupported("教材包含影音、互动或不支持读取的附件，请手动完成");
    }
    const reads = await this.getCompletionCollection(`/api/course/${courseId}/activity-reads-for-user`, "activity_reads");
    const read = reads.find(r => Number(r.activity_id) === id && r.activity_type === "learning_activity");
    if (read?.completeness === "full") return;
    const readUploadIds = new Set(read?.data?.upload_ids || []);
    for (const upload of uploads) {
      checkStop();
      if (readUploadIds.has(Number(upload.id))) continue;
      const referenceId = positiveId(upload.reference_id);
      const url = upload.type === "document" ? await this.resolveCompletionPreviewUrl(referenceId, id)
        : this.officialDownloadUrl(referenceId);
      checkStop();
      const response = await this.request(url, { retries: 0, cache: "no-store" });
      const contentType = response.headers.get("content-type") || "";
      if (/text\/html|application\/json/i.test(contentType)) throw new Error("附件返回了登录页或错误信息，未记录阅读");
      // Drain the response without keeping file contents in memory or downloading to disk.
      if (response.body) {
        const reader = response.body.getReader();
        try {
          while (true) {
            if (shouldStop()) { await reader.cancel(); checkStop(); }
            if ((await reader.read()).done) break;
          }
        } finally { reader.releaseLock(); }
      } else await response.arrayBuffer();
      checkStop();
      await this.#recordCompletionView(id, { upload_id: Number(upload.id) });
    }
  }

  async #recordCompletionView(id, body) {
    // Only the checked reader can emit these two view payloads.
    await this.request(`/api/course/activities-read/${positiveId(id)}`, {
      method: "POST", retries: 0, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
    });
  }

  async resolveCompletionPreviewUrl(referenceId, activityId) {
    const payload = await this.requestJson(`/api/uploads/reference/document/${positiveId(referenceId)}/url?preview=true&refer_id=${positiveId(activityId)}&refer_type=learning_activity`, { retries: 0, cache: "no-store" });
    const url = new URL(payload?.url || "", TRONCLASS_ORIGIN);
    // CityU returns both original PDFs and converted Office PDFs. These URLs are
    // read transiently; they do not enter the existing download/Save As feature.
    const allowedPath = /^\/download\/file\/[a-zA-Z0-9_-]+$/.test(url.pathname)
      || /^\/download\/processed\/[a-zA-Z0-9_-]+\.pdf$/.test(url.pathname);
    if (payload?.status !== "ready" || url.origin !== "https://tcmedia.cityu.edu.mo" || !allowedPath || !url.searchParams.has("token")) {
      throw completionUnsupported("平台尚未提供可读取的文档预览，请手动查看");
    }
    return url.href;
  }

  async loadCourseGradeDetails(course) {
    const definitions = [
      { type: "homework", paths: [`/api/course/${course.id}/homework-scores?fields=id,title,score_percentage`] },
      { type: "classroom_exam", paths: [`/api/courses/${course.id}/classroom-list`, `/api/course/${course.id}/classroom-exam-scores`] },
      { type: "exam", paths: [`/api/courses/${course.id}/exams`, `/api/courses/${course.id}/exam-scores?no-intercept=true`] },
      { type: "forum", paths: [`/api/course/${course.id}/forum-activities`, `/api/course/${course.id}/forum-scores`] },
      { type: "web_link", paths: [`/api/course/${course.id}/web-link-activities`, `/api/course/${course.id}/web-link-scores`] },
      { type: "questionnaire", paths: [`/api/course/${course.id}/questionnaires`, `/api/course/${course.id}/questionnaire-scores`] },
      { type: "interaction", paths: [`/api/course/${course.id}/interactions`, `/api/course/${course.id}/interaction-scores`] },
      { type: "custom", paths: [`/api/courses/${course.id}/custom-score-items`] },
      { type: "virtual_experiment", paths: [`/api/course/${course.id}/virtual-experiments`, `/api/course/${course.id}/virtual-experiment-scores`] }
    ];
    const singletonDefinitions = [
      { type: "attendance", title: "考勤", paths: [`/api/course/${course.id}/rollcall-score`] },
      { type: "performance", title: "课堂表现", paths: [`/api/course/${course.id}/performance-score?isOriginalScore=true`] },
      {
        type: "online_video",
        title: "在线视频完成度",
        paths: [
          `/api/course/${course.id}/online-video-completeness/setting?no-loading-animation=true`,
          `/api/course/${course.id}/online-video-completeness/score`
        ]
      }
    ];
    const errors = [];
    const items = [];

    for (const definition of definitions) {
      const settled = await Promise.allSettled(definition.paths.map((path) => this.requestJson(path)));
      const authFailure = settled.find((result) => result.status === "rejected" && result.reason instanceof AuthError);
      if (authFailure) throw authFailure.reason;
      settled.forEach((result) => {
        if (result.status === "rejected" && result.reason?.status !== 404) errors.push(gradeError(course, definition.type, result.reason));
      });
      const fulfilled = settled.filter((result) => result.status === "fulfilled").map((result) => result.value);
      if (fulfilled.length) items.push(...normalizeOfficialGradeItems(course, definition.type, fulfilled[0], fulfilled[1] || fulfilled[0]));
    }

    const singletonSettled = await Promise.allSettled(singletonDefinitions.map(async (definition) => {
      const results = await Promise.allSettled(definition.paths.map((path) => this.requestJson(path)));
      const authFailure = results.find((result) => result.status === "rejected" && result.reason instanceof AuthError);
      if (authFailure) throw authFailure.reason;
      return {
        payload: Object.assign({}, ...results.filter((result) => result.status === "fulfilled").map((result) => result.value)),
        failures: results.filter((result) => result.status === "rejected" && result.reason?.status !== 404).map((result) => result.reason)
      };
    }));
    const singletonAuthFailure = singletonSettled.find((result) => result.status === "rejected" && result.reason instanceof AuthError);
    if (singletonAuthFailure) throw singletonAuthFailure.reason;
    singletonSettled.forEach((result, index) => {
      const definition = singletonDefinitions[index];
      if (result.status === "fulfilled") {
        const item = normalizeSingletonGradeItem(course, definition.type, result.value.payload, definition.title);
        if (item) items.push(item);
        result.value.failures.forEach((error) => errors.push(gradeError(course, definition.title, error)));
      } else if (result.reason?.status !== 404) errors.push(gradeError(course, definition.title, result.reason));
    });

    return { course, items, errors, loadedAt: this.now().toISOString() };
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
      errors,
      successfulSectionCount: settled.filter((result) => result.status === "fulfilled").length
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

function positiveId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("无效的课程或资源标识");
  return id;
}

function completionUnsupported(message) {
  const error = new Error(message);
  error.name = "CompletionUnsupportedError";
  return error;
}

function prerequisitesCompleted(value) {
  return Array.isArray(value) && value.every(p => p.completion_criterion?.has_completed === true);
}

function ordinaryCompletionUpload(upload) {
  const name = String(upload.name || "");
  if (/\.(mp4|mp3|m4a|wav|webm|mov|avi|m3u8|ogg|scorm|html?)$/i.test(name)) return false;
  if (!["document", "image", "file"].includes(upload.type) || upload.status !== "ready") return false;
  return upload.allow_download === true || upload.type === "document";
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
