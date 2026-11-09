// Only the platform's explicit view criterion can enter the reading executor.
// Submissions, discussions, media progress and unknown criteria never do.
export const COMPLETION_TYPE_LABELS = Object.freeze({
  material: "资料", page: "教材", bulletin: "公告", online_video: "视频",
  homework: "作业", exam: "测验", classroom: "课堂活动", questionnaire: "问卷",
  forum: "讨论", web_link: "链接", interaction: "互动"
});

const MANUAL_REQUIREMENT = /分钟|分鐘|秒|时长|時長|播放|进度|進度|提交|缴交|繳交|讨论|討論|发言|發言|答题|答題|互评|互評|成绩|成績|得分|测验|測驗|问卷|問卷|\d\s*%/i;

export function completionNumber(value) {
  if (!["number", "string"].includes(typeof value) || (typeof value === "string" && !value.trim())) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function isViewOnlyActivity(activity) {
  return ["material", "page"].includes(activity?.type)
    && activity.completion_criterion_key === "view"
    && typeof activity.completion_criterion === "string"
    && Boolean(activity.completion_criterion.trim())
    && !MANUAL_REQUIREMENT.test(activity.completion_criterion)
    && (activity.completion_criterion_value == null || Number(activity.completion_criterion_value) === 0)
    && !activity.interaction_activity_attributes
    && !activity.data?.material_type;
}

export function completionEligibility(item) {
  if (!item || item.completed === true) return { allowed: false, reason: "平台已确认完成" };
  if (item.blockedReason) return { allowed: false, reason: item.blockedReason };
  if (!item.available) return { allowed: false, reason: "尚未开放、已关闭或访问条件未满足" };
  if (item.type === "bulletin") return { allowed: true, reason: "查看公告" };
  if (item.completed !== false) return { allowed: false, reason: "完成状态未能核实，请刷新后核对" };
  if (!["material", "page"].includes(item.type)) return { allowed: false, reason: manualRequirement(item) };
  if (item.viewOnly !== true) return { allowed: false, reason: item.requirement || "完成要求不明确，需手动核对" };
  return { allowed: true, reason: item.requirement };
}

export function manualRequirement(item) {
  if (item.requirement) return item.requirement;
  return ({ online_video: "观看视频至教师要求时长", homework: "提交作业并满足教师完成要求", forum: "手动完成讨论要求",
    exam: "手动完成测验", questionnaire: "手动填写问卷", web_link: "手动访问课程链接" })[item.type] || "在原站核对并完成活动要求";
}

export function normalizeCompletionSnapshot(course, { summary, activities, exams, reads, bulletins, bulletinStats, errors = [] }, now = new Date()) {
  const result = summary?.completed_result;
  const hasSummary = Boolean(result && result.completed && typeof result.completed === "object" && !Array.isArray(result.completed)
    && completionNumber(result.total_activities) !== null && completionNumber(result.total_completed) !== null);
  const completed = new Set();
  for (const [type, ids] of Object.entries(result?.completed || {})) {
    if (Array.isArray(ids)) for (const id of ids) completed.add(`${type}:${Number(id)}`);
  }
  const readByKey = new Map((Array.isArray(reads) ? reads : []).map(r => [`${r.activity_type}:${Number(r.activity_id)}`, r]));
  const items = new Map();
  for (const [list, readType] of [[activities, "learning_activity"], [exams, "exam_activity"]]) {
    for (const activity of Array.isArray(list) ? list : []) {
      if (!Number.isSafeInteger(Number(activity.id)) || Number(activity.id) <= 0 || activity.published === false) continue;
      const id = Number(activity.id);
      const type = readType === "exam_activity" ? "exam" : String(activity.type || "unknown");
      const key = `${course.id}:${readType}:${id}`;
      const requirement = typeof activity.completion_criterion === "string" ? activity.completion_criterion.trim() : "";
      const criterionKey = typeof activity.completion_criterion_key === "string" ? activity.completion_criterion_key : "";
      const criterionKnown = "completion_criterion" in activity || "completion_criterion_key" in activity;
      // CityU uses the literal "none" for activities excluded from the denominator.
      const required = criterionKey === "none" ? false : requirement || criterionKey ? true : criterionKnown ? false : null;
      const read = readByKey.get(`${readType}:${id}`);
      items.set(key, {
        key, courseId: Number(course.id), id, type, readType, title: String(activity.title || "未命名活动"),
        criterionKey, requirement, required,
        completed: hasSummary ? completed.has(`${readType}:${id}`) : read?.completeness === "full" ? true : null,
        available: activity.published === true && activity.is_started !== false && activity.is_in_progress !== false && activity.is_closed !== true,
        viewOnly: isViewOnlyActivity(activity), updatedAt: typeof activity.updated_at === "string" ? activity.updated_at : ""
      });
    }
  }
  const bulletinTotal = completionNumber(bulletinStats?.should_viewed_bulletin_count);
  const bulletinCompleted = completionNumber(bulletinStats?.complete_bulletin_count);
  const allBulletinsRead = bulletinTotal !== null && bulletinCompleted !== null && bulletinCompleted >= bulletinTotal;
  for (const bulletin of Array.isArray(bulletins) ? bulletins : []) {
    if (bulletin.deleted || !Number.isSafeInteger(Number(bulletin.id)) || Number(bulletin.id) <= 0) continue;
    const id = Number(bulletin.id), key = `${course.id}:bulletin:${id}`;
    items.set(key, {
      key, courseId: Number(course.id), id, type: "bulletin", readType: "bulletin", title: String(bulletin.title || "未命名公告"),
      criterionKey: "view", requirement: "查看公告（单独统计）", required: false,
      // This site's bulletin list has no per-bulletin read flag. Never invent one.
      completed: allBulletinsRead ? true : null, available: true, viewOnly: true,
      updatedAt: typeof bulletin.updated_at === "string" ? bulletin.updated_at : ""
    });
  }
  const total = completionNumber(result?.total_activities), totalCompleted = completionNumber(result?.total_completed);
  const requiredItems = [...items.values()].filter(i => i.required === true);
  const detailsComplete = hasSummary && Array.isArray(activities) && Array.isArray(exams)
    && requiredItems.length === total && requiredItems.filter(i => i.completed).length === totalCompleted
    && ![...items.values()].some(i => i.required === null);
  const percent = completionNumber(summary?.study_completeness);
  return {
    courseId: Number(course.id), courseName: String(course.name || "未命名课程"),
    semesterId: course.semesterId ?? null, semesterName: course.semesterName || "",
    percent: percent !== null && percent <= 100 ? percent : null,
    total, totalCompleted, detailsComplete, bulletinTotal, bulletinCompleted,
    items: [...items.values()], errors, refreshedAt: now.toISOString(), stale: false
  };
}

export function summarizeCompletion(snapshot) {
  const items = snapshot?.items || [];
  const remaining = items.filter(i => i.required === true && i.completed !== true);
  const unknown = items.filter(i => i.required == null && i.completed !== true);
  const readable = items.filter(i => completionEligibility(i).allowed);
  const manual = remaining.filter(i => !completionEligibility(i).allowed);
  const bulletinRemaining = snapshot?.bulletinTotal != null && snapshot?.bulletinCompleted != null
    ? Math.max(0, snapshot.bulletinTotal - snapshot.bulletinCompleted) : null;
  const countsReliable = snapshot?.total == null || snapshot?.totalCompleted == null
    || remaining.length <= Math.max(0, snapshot.total - snapshot.totalCompleted);
  return { remaining, unknown, readable, manual, bulletinRemaining, countsReliable, exact: Boolean(snapshot?.detailsComplete && !snapshot?.stale) };
}

export function completionResultText(result) {
  const { manual, remaining, unknown, exact, countsReliable } = summarizeCompletion(result.snapshot);
  const pending = new Set(result.pendingKeys || []);
  const pendingCount = remaining.filter(i => pending.has(i.key)).length;
  const failedKeys = new Set((result.failures || []).map(i => i.key));
  const manualCount = manual.length;
  const parts = [`${result.cancelled ? "已停止，" : ""}已读取 ${result.readCount} 项`,
    countsReliable ? `${exact ? "还有" : "已确认至少"} ${manualCount} 项需要手动完成` : "剩余事项数量尚待核实"];
  if (unknown.length) parts.push(`另有 ${unknown.length} 项完成要求待核实`);
  if (pendingCount) parts.push(`${pendingCount} 项等待平台更新`);
  const unread = remaining.filter(i => completionEligibility(i).allowed && !pending.has(i.key) && !failedKeys.has(i.key)).length;
  if (unread) parts.push(`另有 ${unread} 项尚未读取`);
  const bulletinPending = (result.snapshot?.items || []).filter(i => i.type === "bulletin" && i.completed !== true && pending.has(i.key)).length;
  if (bulletinPending) parts.push("公告阅读统计等待平台更新");
  if (result.failures?.length) parts.push(`${result.failures.length} 项读取失败，可重试`);
  if (result.verificationFailed) parts.push("平台状态核对失败，请刷新后确认");
  if (result.error) parts.push(result.error.message || "处理已中止");
  return `${parts.join("；")}。`;
}

export class CompletionRunner {
  constructor(api, { wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
    this.api = api;
    this.wait = wait;
    this.running = false;
    this.stopped = false;
  }
  stop() { this.stopped = true; }
  async run(course, { internalUserId, onProgress = () => {} } = {}) {
    if (this.running) throw new Error("已有课程正在处理");
    this.running = true;
    this.stopped = false;
    const result = { snapshot: null, readCount: 0, failures: [], blocked: [], pendingKeys: [], cancelled: false, verificationFailed: false, error: null };
    const options = { internalUserId };
    try {
      result.snapshot = await this.api.loadCourseCompletion(course, options);
      if (result.snapshot.stale) throw new Error("课程状态未能核实，请刷新后重试");
      const queue = summarizeCompletion(result.snapshot).readable;
      for (let index = 0; index < queue.length && !this.stopped; index += 1) {
        const item = queue[index];
        onProgress({ index, total: queue.length, item, phase: "reading" });
        if (this.stopped) break;
        try {
          await this.api.readCompletionResource(course, item, { shouldStop: () => this.stopped });
          result.readCount += 1;
          result.pendingKeys.push(item.key);
        } catch (error) {
          if (error.name === "AbortError") { this.stopped = true; break; }
          if (error.name === "AuthError") { result.error = error; break; }
          if (error.name === "CompletionUnsupportedError") { result.blocked.push({ key: item.key, message: error.message }); continue; }
          result.failures.push({ key: item.key, title: item.title, message: error.message || "读取失败" });
        }
      }
      result.cancelled = this.stopped;
      onProgress({ index: result.readCount, total: queue.length, phase: "verifying" });
      if (!result.error) {
        try {
          result.snapshot = await this.api.loadCourseCompletion(course, options);
          const pending = () => result.snapshot.items.some(i => i.completed !== true && result.pendingKeys.includes(i.key));
          if (!this.stopped && pending()) {
            await this.wait(1500);
            result.snapshot = await this.api.loadCourseCompletion(course, options);
          }
          result.verificationFailed = result.snapshot.stale;
        } catch (error) {
          result.verificationFailed = true;
          if (error.name === "AuthError") result.error = error;
        }
      } else result.verificationFailed = true;
      if (result.verificationFailed) result.snapshot = { ...result.snapshot, stale: true };
      for (const blocked of result.blocked) {
        const item = result.snapshot.items.find(i => i.key === blocked.key);
        if (item && item.completed !== true) item.blockedReason = blocked.message;
      }
      return result;
    } finally { this.running = false; }
  }
}
