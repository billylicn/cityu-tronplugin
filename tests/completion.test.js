import test from "node:test";
import assert from "node:assert/strict";
import { AuthError, TronClassApi } from "../lib/api.js";
import { CompletionRunner, completionEligibility, completionNumber, completionResultText, isViewOnlyActivity, normalizeCompletionSnapshot, summarizeCompletion } from "../lib/completion.js";
import { createCompletionCache, readCompletionCache } from "../lib/cache.js";
import { normalizeCourse } from "../lib/normalizers.js";

const course = { id: 1, name: "课程", semesterId: 2, semesterName: "测试学期" };
const now = new Date("2026-11-09T08:00:00Z");
const upload = { id: 30, reference_id: 40, name: "资料.pdf", type: "document", status: "ready", deleted: false, allow_download: false };
const material = { id: 10, course_id: 1, type: "material", title: "参考资料", completion_criterion: "觀看或下載所有參考文件附件", completion_criterion_key: "view", completion_criterion_value: "0", published: true, is_started: true, is_in_progress: true, prerequisites: [], uploads: [upload] };
const homework = { ...material, id: 20, type: "homework", title: "报告", completion_criterion: "繳交作業", completion_criterion_key: "submitted" };
function snapshot({ done = [], activities = [material, homework], ...rest } = {}) {
  return normalizeCompletionSnapshot(course, {
    summary: { study_completeness: done.length * 50, completed_result: { total_activities: 2, total_completed: done.length, completed: { learning_activity: done } } },
    activities, exams: [], reads: [], bulletins: [], bulletinStats: { should_viewed_bulletin_count: 0, complete_bulletin_count: 0 }, ...rest
  }, now);
}
const json = value => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });

function fixture({ activity = material, readRecords = [], onWrite, failWrite = false, fileType = "application/pdf" } = {}) {
  const calls = [];
  const api = new TronClassApi({ now: () => now, fetchImpl: async (url, options) => {
    const path = new URL(url).pathname;
    calls.push({ path, method: options.method, body: options.body });
    if (options.method === "POST") {
      onWrite?.({ path, body: options.body });
      return failWrite ? new Response("failed", { status: 500 }) : json({});
    }
    if (path === "/api/activities/10") return json(activity);
    if (path === "/api/course/1/activity-reads-for-user") return json({ activity_reads: readRecords });
    if (path === "/api/uploads/reference/document/40/url") return json({ status: "ready", url: "https://tcmedia.cityu.edu.mo/download/file/fixture?token=test-only" });
    if (path === "/download/file/fixture" || path === "/api/uploads/reference/40/blob") return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": fileType } });
    if (path === "/api/courses/1/bulletins") return json({ bulletins: [{ id: 50, title: "公告", content: "通知正文" }] });
    throw new Error(`Unexpected request ${path}`);
  } });
  return { api, calls };
}

test("完成度保留明确 0；空值不会变成 0%，也不会按比例猜测", () => {
  assert.equal(completionNumber(0), 0);
  assert.equal(completionNumber(null), null);
  assert.equal(completionNumber(""), null);
  assert.equal(completionNumber(false), null);
  assert.equal(completionNumber("   "), null);
  assert.equal(completionNumber([]), null);
  assert.equal(normalizeCourse({ id: 1, study_completeness: null }).completeness, null);
  assert.equal(snapshot().percent, 0);
  assert.equal(snapshot({ summary: { study_completeness: 1 } }).percent, 1);
});

test("完成状态只按平台已完成集合判断，提交和发帖信息不替代完成指标", () => {
  const s = snapshot({ activities: [material, { ...homework, submitted: true, user_submit_count: 3 }] });
  assert.equal(s.items[1].completed, false);
  assert.equal(s.detailsComplete, true);
  assert.equal(summarizeCompletion(s).manual.length, 1);
  assert.equal(snapshot({ done: [10, 20] }).percent, 100);
  assert.equal(summarizeCompletion(snapshot({ done: [10, 20] })).remaining.length, 0);
});

test("活动按活动 ID 和读取类型去重，重复附件不增加活动数量", () => {
  const s = snapshot({ activities: [material, material, homework] });
  assert.equal(s.items.length, 2);
  assert.equal(s.detailsComplete, true);
});

test("只有普通教材和页面的明确纯查看规则允许处理", () => {
  assert.equal(isViewOnlyActivity(material), true);
  for (const type of ["homework", "forum", "exam", "online_video", "questionnaire", "interaction", "classroom", "unknown"]) {
    assert.equal(isViewOnlyActivity({ ...material, type }), false, type);
    const item = { ...snapshot().items[0], type, viewOnly: true };
    assert.equal(completionEligibility(item).allowed, false, type);
  }
  for (const change of [
    { completion_criterion_key: "watch" }, { completion_criterion_key: null },
    { completion_criterion: "查看并提交作业" }, { completion_criterion: "观看 30 分钟" },
    { completion_criterion_value: "60" }, { completion_criterion: ["view", "submit"] },
    { data: { material_type: "PPT" } }, { interaction_activity_attributes: { quiz: true } }
  ]) assert.equal(isViewOnlyActivity({ ...material, ...change }), false, JSON.stringify(change));
});

test("未开放、已关闭、未发布的活动不进入执行队列", () => {
  for (const flag of [{ is_started: false }, { is_closed: true }, { is_in_progress: false }, { published: false }]) {
    assert.equal(summarizeCompletion(snapshot({ activities: [{ ...material, ...flag }] })).readable.length, 0);
  }
});

test("平台总数与明细不一致或要求未知时只报告已确认数量", () => {
  const partial = snapshot({ activities: [homework] });
  assert.equal(summarizeCompletion(partial).exact, false);
  assert.match(completionResultText({ snapshot: partial, readCount: 0 }), /已确认至少 1 项需要手动完成/);
  assert.equal(snapshot({ activities: [{ id: 3, type: "unknown", published: true }] }).items[0].required, null);
  assert.equal(completionEligibility({ ...snapshot().items[0], completed: null }).allowed, false);
  const inconsistent = snapshot({ activities: [material, homework, { ...homework, id: 90 }] });
  assert.equal(summarizeCompletion(inconsistent).countsReliable, false);
  assert.match(completionResultText({ snapshot: inconsistent, readCount: 0 }), /数量尚待核实/);
});

test("平台 none 明确代表未设置完成指标，不进入剩余或手动事项", () => {
  const s = snapshot({ activities: [material, homework, { ...material, id: 90, completion_criterion: "", completion_criterion_key: "none" }] });
  assert.equal(s.items.at(-1).required, false);
  assert.equal(summarizeCompletion(s).manual.length, 1);
  assert.equal(summarizeCompletion(s).readable.length, 1);
  assert.equal(s.detailsComplete, true);
});

test("完成度预览支持原站转换后的 Office PDF，但不扩大其他域名或路径", async () => {
  const api = new TronClassApi();
  api.requestJson = async () => ({ status: "ready", url: "https://tcmedia.cityu.edu.mo/download/processed/office_fixture.pdf?token=test-only" });
  assert.match(await api.resolveCompletionPreviewUrl(40, 10), /download\/processed/);
  for (const url of ["https://example.com/download/processed/a.pdf?token=test-only", "https://tcmedia.cityu.edu.mo/private/a.pdf?token=test-only", "https://tcmedia.cityu.edu.mo/download/processed/a.pdf"]) {
    api.requestJson = async () => ({ status: "ready", url });
    await assert.rejects(api.resolveCompletionPreviewUrl(40, 10), /尚未提供/);
  }
});

test("公告按平台阅读总数单独统计，不伪造逐条已读状态", () => {
  const s = snapshot({ bulletins: [{ id: 50, title: "公告" }], bulletinStats: { should_viewed_bulletin_count: 1, complete_bulletin_count: 0 } });
  const item = s.items.find(i => i.type === "bulletin");
  assert.equal(item.completed, null);
  assert.equal(item.required, false);
  assert.equal(summarizeCompletion(s).remaining.length, 2);
  assert.equal(summarizeCompletion(s).bulletinRemaining, 1);
  const allRead = snapshot({ bulletins: [{ id: 50 }], bulletinStats: { should_viewed_bulletin_count: 1, complete_bulletin_count: 1 } });
  assert.equal(allRead.items.at(-1).completed, true);
});

test("缓存只保存完成度白名单元数据，不保存正文、身份和签名地址", () => {
  const cache = createCompletionCache({ courses: [{ ...course, student_id: "PRIVATE_ID" }], snapshots: [{ ...snapshot(), content: "PRIVATE_CONTENT", items: [{ ...snapshot().items[0], content: "PRIVATE_CONTENT", uploads: [upload], student_id: "PRIVATE_ID", signedUrl: "PRIVATE_URL" }] }] });
  const serialized = JSON.stringify(cache);
  for (const forbidden of ["PRIVATE_ID", "PRIVATE_CONTENT", "PRIVATE_URL", "uploads", "student_id"]) assert.equal(serialized.includes(forbidden), false);
  assert.equal(readCompletionCache(cache).snapshots[0].percent, 0);
  assert.equal(readCompletionCache({ version: 999, snapshots: [] }), null);
});

test("普通 PDF 真正读取内容后才记录附件阅读，不下载、不打开页面", async () => {
  const { api, calls } = fixture();
  await api.readCompletionResource(course, snapshot().items[0]);
  assert.deepEqual(calls.filter(c => c.method === "POST"), [{ path: "/api/course/activities-read/10", method: "POST", body: '{"upload_id":30}' }]);
  assert.ok(calls.findIndex(c => c.path === "/download/file/fixture") < calls.findIndex(c => c.method === "POST"));
});

test("缓存伪造普通教材、跨课程 ID 和最新规则变化均不能触发写请求", async () => {
  for (const activity of [{ ...homework, id: 10 }, { ...material, type: "online_video" }, { ...material, course_id: 999 }, { ...material, completion_criterion: "查看并提交作业" }, { ...material, prerequisites: [{ completion_criterion: { has_completed: false } }] }]) {
    const { api, calls } = fixture({ activity });
    await assert.rejects(api.readCompletionResource(course, snapshot().items[0]), /不允许/);
    assert.equal(calls.filter(c => c.method === "POST").length, 0);
  }
  const { api, calls } = fixture();
  await assert.rejects(api.readCompletionResource(course, { ...snapshot().items[0], courseId: 999 }));
  assert.equal(calls.length, 0);
});

test("视频附件和互动教材不产生播放记录或提交请求", async () => {
  const { api, calls } = fixture({ activity: { ...material, uploads: [{ ...upload, type: "video", name: "lesson.mp4" }] } });
  await assert.rejects(api.readCompletionResource(course, snapshot().items[0]), /影音/);
  assert.equal(calls.filter(c => c.method === "POST").length, 0);
});

test("重复附件只读取一次，重试会跳过平台已确认的附件", async () => {
  const { api, calls } = fixture({ activity: { ...material, uploads: [upload, upload] } });
  await api.readCompletionResource(course, snapshot().items[0]);
  assert.equal(calls.filter(c => c.method === "POST").length, 1);
  const readFixture = fixture({ readRecords: [{ activity_id: 10, activity_type: "learning_activity", completeness: "part", data: { upload_ids: [30] } }] });
  await readFixture.api.readCompletionResource(course, snapshot().items[0]);
  assert.equal(readFixture.calls.filter(c => c.method === "POST").length, 0);
});

test("附件返回登录页或错误内容时不记录阅读，阅读 POST 不自动重试", async () => {
  const bad = fixture({ fileType: "text/html" });
  await assert.rejects(bad.api.readCompletionResource(course, snapshot().items[0]), /未记录阅读/);
  assert.equal(bad.calls.filter(c => c.method === "POST").length, 0);
  const failed = fixture({ failWrite: true });
  await assert.rejects(failed.api.readCompletionResource(course, snapshot().items[0]), /HTTP 500/);
  assert.equal(failed.calls.filter(c => c.method === "POST").length, 1);
});

test("停止发生在附件读取过程中时，不再写入阅读记录", async () => {
  let stopped = false;
  const { api, calls } = fixture();
  const original = api.fetchImpl;
  api.fetchImpl = async (...args) => { const response = await original(...args); if (new URL(args[0]).pathname === "/download/file/fixture") stopped = true; return response; };
  await assert.rejects(api.readCompletionResource(course, snapshot().items[0], { shouldStop: () => stopped }), { name: "AbortError" });
  assert.equal(calls.filter(c => c.method === "POST").length, 0);
});

test("公告只读取此课程的实际内容并调用已读接口，不调用任何发布接口", async () => {
  const { api, calls } = fixture();
  await api.readCompletionResource(course, { courseId: 1, id: 50, type: "bulletin", available: true, completed: null });
  assert.deepEqual(calls.filter(c => c.method === "POST").map(c => c.path), ["/api/bulletins/50/read"]);
  const absent = fixture();
  await assert.rejects(absent.api.readCompletionResource(course, { courseId: 1, id: 999, type: "bulletin", available: true }), /无法确认/);
  assert.equal(absent.calls.filter(c => c.method === "POST").length, 0);
});

test("执行器先刷新再执行，结果只接受平台回读并提示手动事项", async () => {
  let reads = 0;
  const called = [];
  const api = { loadCourseCompletion: async () => { called.push("refresh"); return snapshot({ done: reads ? [10] : [] }); }, readCompletionResource: async (_course, item) => { called.push(item.type); reads += 1; } };
  const result = await new CompletionRunner(api).run(course);
  assert.deepEqual(called, ["refresh", "material", "refresh"]);
  assert.equal(result.snapshot.percent, 50);
  assert.match(completionResultText(result), /已读取 1 项；还有 1 项需要手动完成/);
});

test("平台尚未更新时只延迟核对一次，不把请求成功当作完成", async () => {
  let loads = 0, waits = 0;
  const api = { loadCourseCompletion: async () => { loads += 1; return snapshot(); }, readCompletionResource: async () => {} };
  const result = await new CompletionRunner(api, { wait: async () => { waits += 1; } }).run(course);
  assert.equal(loads, 3);
  assert.equal(waits, 1);
  assert.equal(result.snapshot.percent, 0);
  assert.match(completionResultText(result), /1 项等待平台更新/);
});

test("课程执行锁阻止重复任务，停止后保留结果且不执行下一项", async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const api = { loadCourseCompletion: async () => { await gate; return snapshot(); }, readCompletionResource: async () => assert.fail("stopped job must not read") };
  const runner = new CompletionRunner(api);
  const first = runner.run(course);
  await assert.rejects(runner.run(course), /已有课程/);
  runner.stop();
  release();
  const result = await first;
  assert.equal(result.cancelled, true);
  assert.equal(result.readCount, 0);
  assert.match(completionResultText(result), /另有 1 项尚未读取/);
  assert.equal(runner.running, false);
});

test("认证失效立即终止，回读失败时不冒充已确认状态", async () => {
  const api = { loadCourseCompletion: async () => snapshot(), readCompletionResource: async () => { throw new AuthError(); } };
  const result = await new CompletionRunner(api).run(course);
  assert.equal(result.error.name, "AuthError");
  assert.equal(result.verificationFailed, true);
  assert.equal(result.snapshot.stale, true);
  assert.equal(result.readCount, 0);
});

test("不支持的教材变为手动事项，网络失败可重试且不阻止其他项目", async () => {
  const api = { loadCourseCompletion: async () => snapshot(), readCompletionResource: async () => { const e = new Error("需手动查看互动教材"); e.name = "CompletionUnsupportedError"; throw e; } };
  const result = await new CompletionRunner(api).run(course);
  assert.equal(result.failures.length, 0);
  assert.equal(summarizeCompletion(result.snapshot).manual.length, 2);
  assert.match(completionResultText(result), /还有 2 项需要手动完成/);
  api.readCompletionResource = async () => { throw new Error("网络错误"); };
  const failed = await new CompletionRunner(api).run(course);
  assert.equal(failed.failures.length, 1);
  assert.match(completionResultText(failed), /1 项读取失败，可重试/);
});

test("完成度分页失败不返回伪装完整的空列表，查询接口不会触发阅读写入", async () => {
  const api = new TronClassApi({ now: () => now });
  const paths = [];
  api.requestJson = async path => {
    paths.push(path);
    if (path.includes("my-completeness")) return { study_completeness: 0, completed_result: { total_activities: 2, total_completed: 0, completed: {} } };
    if (path.includes("/activities?")) return { activities: [material, homework] };
    if (path.includes("/exams?")) return { exams: [] };
    if (path.includes("activity-reads-for-user")) return { activity_reads: [] };
    if (path.includes("bulletins")) return { unexpected: [] };
    return { student_stats: { should_viewed_bulletin_count: 0, complete_bulletin_count: 0 } };
  };
  api.request = async () => assert.fail("query must not write a view");
  const s = await api.loadCourseCompletion(course, { internalUserId: 99 });
  assert.equal(s.percent, 0);
  assert.equal(s.errors[0].section, "课程公告");
  assert.equal(paths.some(p => p.includes("/activities-read/")), false);
});

test("学期完成度最多并发两门课程，认证失效后不再启动后续课程", async () => {
  const api = new TronClassApi();
  let active = 0, peak = 0;
  api.loadCourseCompletion = async course => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 2));
    active -= 1;
    return { courseId: course.id };
  };
  const courses = [1, 2, 3, 4, 5].map(id => ({ id }));
  const results = await api.loadCompletionCourses(courses, { internalUserId: 99 });
  assert.deepEqual(results.map(s => s.courseId), [1, 2, 3, 4, 5]);
  assert.equal(peak, 2);
  const calls = [];
  api.loadCourseCompletion = async course => {
    calls.push(course.id);
    if (course.id === 1) throw new AuthError();
    await new Promise(resolve => setTimeout(resolve, 2));
    return { courseId: course.id };
  };
  await assert.rejects(api.loadCompletionCourses(courses, { internalUserId: 99 }), { name: "AuthError" });
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.deepEqual(calls, [1, 2]);
});
