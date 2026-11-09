import { CompletionRunner, COMPLETION_TYPE_LABELS, completionEligibility, completionResultText, manualRequirement, summarizeCompletion } from "./completion.js";
import { COMPLETION_CACHE_KEY, createCompletionCache } from "./cache.js";
import { formatDateTime, splitCoursesByPlatformTerm } from "./normalizers.js";

export class CompletionPage {
  constructor({ api, getContext, onCourses, onAuthenticated, onAuthError, onManualRead, onNotice }) {
    Object.assign(this, { api, getContext, onCourses, onAuthenticated, onAuthError, onManualRead, onNotice });
    this.runner = new CompletionRunner(api);
    this.snapshots = new Map();
    this.results = new Map();
    this.expanded = new Set();
    this.cacheCourses = [];
    this.refreshedAt = null;
    this.initialized = false;
    this.loading = false;
    this.activeCourseId = null;
    this.progress = "";
    this.error = "";
    this.loadedSignature = "";
    this.cacheGeneration = 0;
    this.dom = Object.fromEntries(["completionRefreshButton", "completionTerm", "completionSummary", "completionMeta", "completionState", "completionError", "completionList"]
      .map(id => [id, document.getElementById(id)]));
    this.dom.completionRefreshButton.addEventListener("click", () => void this.refresh({ manual: true }));
  }
  courses() {
    const courses = this.getContext().courses;
    return splitCoursesByPlatformTerm(courses.length ? courses : this.cacheCourses).ongoing;
  }
  restore(cache) {
    this.cacheCourses = cache.courses;
    this.snapshots = new Map(cache.snapshots.map(s => [Number(s.courseId), s]));
    this.refreshedAt = cache.refreshedAt;
    this.loadedSignature = this.courses().map(c => c.id).join(",");
  }
  clearCache() { this.cacheCourses = []; this.cacheGeneration += 1; }
  async prepare() {
    const signature = this.courses().map(c => c.id).join(",");
    const shouldRead = !this.initialized || signature !== this.loadedSignature;
    this.initialized = true;
    this.render();
    if (shouldRead && this.getContext().autoRefresh) await this.refresh();
  }
  async refresh({ manual = false } = {}) {
    if (this.loading || this.runner.running || this.activeCourseId !== null) return;
    if (!manual && !this.getContext().autoRefresh) return;
    const cacheGeneration = this.cacheGeneration;
    this.loading = true;
    this.error = "";
    this.progress = "正在读取当前学期课程…";
    this.render();
    try {
      const student = await this.api.getCurrentStudent();
      this.onAuthenticated(student);
      const courses = await this.api.getCourses();
      this.onCourses(courses);
      this.cacheCourses = courses;
      const current = this.courses();
      const snapshots = await this.api.loadCompletionCourses(current, {
        internalUserId: student.internalUserId,
        onProgress: ({ completed, total }) => { this.progress = `正在读取完成度 ${completed}/${total}`; this.renderStatus(); }
      });
      for (const fresh of snapshots) {
        const old = this.snapshots.get(fresh.courseId);
        this.snapshots.set(fresh.courseId, fresh.stale && old ? { ...old, stale: true, errors: fresh.errors } : fresh);
        this.results.delete(fresh.courseId);
      }
      this.snapshots = new Map(current.map(c => [Number(c.id), this.snapshots.get(Number(c.id))]).filter(([, v]) => v));
      this.loadedSignature = current.map(c => c.id).join(",");
      if (!current.length || snapshots.some(s => !s.stale)) {
        this.refreshedAt = new Date().toISOString();
        await this.save(cacheGeneration);
        if (manual) await this.onManualRead();
      }
    } catch (error) {
      this.error = `${error.message || "读取失败"}。${this.snapshots.size ? "已保留上次数据。" : "请稍后重试。"}`;
      if (error.name === "AuthError") this.onAuthError(error.message);
    } finally {
      this.loading = false;
      this.progress = "";
      this.render();
    }
  }
  async run(course) {
    // Lock before the first await, including authentication and the preflight read.
    if (this.loading || this.activeCourseId !== null || this.runner.running) return;
    const cacheGeneration = this.cacheGeneration;
    this.activeCourseId = Number(course.id);
    this.results.delete(Number(course.id));
    this.error = "";
    this.progress = "正在核对最新完成要求…";
    this.stopRequested = false;
    this.render();
    try {
      const student = await this.api.getCurrentStudent();
      this.onAuthenticated(student);
      if (this.stopRequested) return;
      const result = await this.runner.run(course, {
        internalUserId: student.internalUserId,
        onProgress: ({ index, total, phase }) => {
          this.progress = phase === "verifying" ? "正在核对平台结果…" : `正在读取 ${index + 1}/${total}`;
          this.renderProgress();
        }
      });
      this.snapshots.set(Number(course.id), result.snapshot);
      this.results.set(Number(course.id), result);
      if (!result.verificationFailed) this.refreshedAt = result.snapshot.refreshedAt;
      if (result.error?.name === "AuthError") this.onAuthError(result.error.message);
      if (!result.verificationFailed) await this.onManualRead();
      await this.save(cacheGeneration);
    } catch (error) {
      this.error = `${error.message || "处理失败"}。当前数据已保留。`;
      if (error.name === "AuthError") this.onAuthError(error.message);
    } finally {
      this.activeCourseId = null;
      this.progress = "";
      this.render();
    }
  }
  stop() {
    this.stopRequested = true;
    this.runner.stop();
    this.progress = "正在停止，保留已完成的读取…";
    this.renderProgress();
    const button = this.dom.completionList.querySelector('[data-completion-stop]');
    if (button) button.disabled = true;
  }
  async save(cacheGeneration) {
    const storage = globalThis.chrome?.storage?.local;
    if (!storage || cacheGeneration !== this.cacheGeneration) return;
    try {
      await storage.set({ [COMPLETION_CACHE_KEY]: createCompletionCache({
        courses: this.getContext().courses.length ? this.getContext().courses : this.cacheCourses,
        snapshots: [...this.snapshots.values()], refreshedAt: this.refreshedAt
      }) });
    } catch { this.onNotice("完成度已读取，但本地缓存保存失败", true); }
  }
  renderStatus() {
    const courses = this.courses();
    this.dom.completionTerm.textContent = courses[0]?.semesterName || "当前学期";
    const completed = courses.filter(c => this.snapshots.get(Number(c.id))?.percent === 100).length;
    this.dom.completionSummary.textContent = `${courses.length} 门课程 · ${completed} 门完成`;
    this.dom.completionMeta.textContent = this.loading ? this.progress
      : this.refreshedAt ? `上次读取 ${formatDateTime(this.refreshedAt)}` : "尚未读取";
    this.dom.completionRefreshButton.disabled = this.loading || this.activeCourseId !== null;
    this.dom.completionRefreshButton.textContent = this.loading ? "读取中…" : "刷新完成度";
    this.dom.completionList.setAttribute("aria-busy", String(this.loading));
    this.dom.completionError.textContent = this.error;
    this.dom.completionError.classList.toggle("is-hidden", !this.error);
  }
  renderProgress() {
    const node = this.dom.completionList.querySelector('[data-completion-progress]');
    if (node) node.textContent = this.progress;
  }
  render() {
    this.renderStatus();
    const courses = this.courses();
    this.dom.completionState.classList.toggle("is-hidden", courses.length > 0);
    this.dom.completionState.textContent = this.loading ? "正在读取当前学期课程…" : this.refreshedAt
      ? "当前学期暂无课程。" : "暂无完成度缓存，点击“刷新完成度”读取当前学期。";
    const ordered = courses.map((course, index) => ({ course, index, snapshot: this.snapshots.get(Number(course.id)) }))
      .sort((a, b) => rank(a.snapshot) - rank(b.snapshot) || a.index - b.index);
    this.dom.completionList.replaceChildren(...ordered.map(({ course, snapshot }) => this.card(course, snapshot)));
  }
  card(course, snapshot) {
    const card = el("article", "completion-card");
    card.dataset.courseId = String(course.id);
    const heading = el("div", "completion-course-heading");
    heading.append(el("h3", "", course.name), el("strong", "completion-percent", snapshot?.percent == null ? "未获取" : `${snapshot.percent}%`));
    const progress = el("progress", "completion-meter");
    progress.max = 100;
    progress.value = snapshot?.percent ?? 0;
    progress.setAttribute("aria-label", `${course.name}完成度${snapshot?.percent == null ? "未获取" : `${snapshot.percent}%`}`);
    card.append(heading, progress);
    if (!snapshot) {
      card.append(el("p", "completion-note", this.loading ? "正在读取完成要求…" : "尚未读取此课程的完成要求，请刷新完成度。"));
      return card;
    }
    const summary = summarizeCompletion(snapshot);
    const materials = summary.readable.filter(i => i.type !== "bulletin").length;
    const bulletins = summary.readable.filter(i => i.type === "bulletin").length;
    card.append(el("p", "completion-note", `可一键查看：资料 ${materials} 项${bulletins ? `、公告 ${bulletins} 条` : ""}`));
    const manualGroups = new Map();
    for (const item of summary.manual) {
      const label = COMPLETION_TYPE_LABELS[item.type] || "其他";
      manualGroups.set(label, (manualGroups.get(label) || 0) + 1);
    }
    card.append(el("p", "completion-note", !summary.countsReliable ? "部分活动与平台统计尚未对应，请展开核对。" : summary.manual.length
      ? `${summary.exact ? "还需手动完成" : "已确认需手动完成至少"}：${[...manualGroups].map(([label, count]) => `${label} ${count} 项`).join("、")}`
      : summary.exact ? "暂无已确认的手动事项。" : "完成明细尚不完整，剩余要求需继续核对。"));
    if (summary.unknown.length) card.append(el("p", "completion-note", `另有 ${summary.unknown.length} 项完成要求待核实，不会一键处理。`));
    if (summary.bulletinRemaining !== null) card.append(el("p", "completion-note completion-subtle", `公告另计：${summary.bulletinRemaining} 条未读${bulletins && summary.bulletinRemaining < bulletins ? "；平台未返回逐条状态，本次将逐条读取" : ""}`));
    else if (bulletins) card.append(el("p", "completion-note completion-subtle", "公告未返回已读数量，本次将逐条读取并核对。"));
    if (snapshot.stale) card.append(el("p", "completion-warning", "本次未取得最新状态，当前显示上次数据。"));
    const actions = el("div", "completion-actions");
    const active = this.activeCourseId === Number(course.id);
    const result = this.results.get(Number(course.id));
    const action = el("button", active ? "button button-secondary button-small" : "button button-primary button-small",
      active ? "停止" : result?.failures.length ? "重试未完成项" : "一键查看");
    action.type = "button";
    action.setAttribute("aria-label", `${course.name} · ${active ? "停止读取" : "一键查看"}`);
    action.disabled = active ? this.stopRequested : this.loading || this.activeCourseId !== null || !summary.readable.length || snapshot.stale;
    if (active) action.dataset.completionStop = "";
    action.addEventListener("click", () => active ? this.stop() : void this.run(course));
    actions.append(action);
    if (!summary.readable.length) actions.append(el("span", "completion-note", "暂无可一键查看的项目"));
    card.append(actions);
    if (active) {
      const status = el("p", "completion-result", this.progress);
      status.dataset.completionProgress = "";
      status.setAttribute("role", "status");
      card.append(status);
    } else if (result) {
      const status = el("p", "completion-result", completionResultText(result));
      status.setAttribute("role", "status");
      card.append(status);
    }
    const details = el("details", "completion-details");
    details.open = this.expanded.has(Number(course.id));
    details.addEventListener("toggle", () => details.open ? this.expanded.add(Number(course.id)) : this.expanded.delete(Number(course.id)));
    details.append(el("summary", "", `剩余事项${!summary.countsReliable ? "（数量待核对）" : summary.remaining.length ? `（${summary.exact ? "" : "至少 "}${summary.remaining.length} 项）` : ""}`));
    const list = el("ul", "completion-remaining");
    const display = [...summary.manual, ...summary.remaining.filter(i => completionEligibility(i).allowed), ...summary.unknown];
    for (const item of display) {
      const row = el("li", "");
      const eligibility = completionEligibility(item);
      const requirement = item.blockedReason || (eligibility.allowed ? manualRequirement(item) : eligibility.reason);
      row.append(el("strong", "", `${COMPLETION_TYPE_LABELS[item.type] || "活动"} · ${item.title}`),
        el("span", "", requirement));
      list.append(row);
    }
    if (!display.length) list.append(el("li", "completion-note", summary.exact ? "平台未返回剩余必需学习活动。" : "尚无法确认全部剩余活动，请刷新后核对。"));
    for (const error of snapshot.errors || []) list.append(el("li", "completion-warning", `${error.section}未能读取，请稍后刷新。`));
    for (const failure of result?.failures || []) list.append(el("li", "completion-warning", `${failure.title}：${failure.message}`));
    details.append(list);
    card.append(details);
    return card;
  }
}

function rank(snapshot) { return snapshot?.percent === 100 ? 2 : snapshot?.percent == null ? 1 : 0; }
function el(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
