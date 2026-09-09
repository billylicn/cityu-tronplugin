function clampRate(value) {
  return Math.min(1, Math.max(0, value));
}

function finiteRate(value) {
  return Number.isFinite(value) ? clampRate(value) : null;
}

function attendanceKeyword(report, stability) {
  if (stability === null || !report.attendance?.validTotal) return "#考勤未解锁";
  if ((report.attendance.absenceTotal || 0) === 0 && (report.attendance.late || 0) === 0) return "#全勤结界";
  if (stability >= 0.97) return "#打卡机器";
  if (stability >= 0.9) return "#出勤稳健";
  if (stability >= 0.8) return "#偶尔离线";
  return "#间歇性消失";
}

function homeworkKeyword(report, survival) {
  const due = Number(report.homework?.due) || 0;
  const submitted = Number(report.homework?.submitted) || 0;
  const missing = Number(report.homework?.missing) || 0;
  if (!due || survival === null) return submitted > 0 ? "#作业进行时" : "#作业未解锁";
  if (missing === 0) return "#作业清零";
  if (survival >= 0.95) return "#DDL管理局";
  if (survival >= 0.8) return "#极限交付";
  if (survival >= 0.6) return "#间歇性摆烂";
  return "#DDL失踪案";
}

function buildQuip(report, stability, survival) {
  const attendance = report.attendance || {};
  const punched = Number(attendance.punched) || 0;
  const late = Number(attendance.late) || 0;

  if (stability === null && survival === null) return "战绩样本还不够，但校园生存故事已经开始。";
  if (stability === null) return "作业篇章已经展开，考勤轨迹还等数据解锁。";
  if (survival === null) return "打卡轨迹已经留下，作业篇章还等数据解锁。";
  if (stability >= 0.999999 && survival >= 0.999999) return "这段记录里，不是在上课，就是在准时交作业。";
  if (stability >= 0.95 && survival < 0.9) return "人稳稳坐在教室，作业偶尔还在路上。";
  if (survival >= 0.95 && stability < 0.9) return "人可以偶尔消失，作业必须准时出现。";
  if (late >= 2 && punched > 0 && late / punched >= 0.2) return "每次都在和点名倒计时进行极限拉扯。";
  if (stability < 0.8 && survival < 0.8) return "主打一个过程跌宕，结局还在抢救。";
  if (stability - survival >= 0.1) return "打卡状态稳定在线，作业进度偶尔需要催一催。";
  if (survival - stability >= 0.1) return "作业总能准时出现，人偶尔需要重新连接。";
  return "整体发挥在线，偶尔给校园生活留一点剧情。";
}

export function buildBattlePersona(report = {}) {
  const absenceRate = finiteRate(report.attendance?.absenceRate);
  const missingRate = finiteRate(report.homework?.missingRate);
  const attendanceStability = absenceRate === null ? null : clampRate(1 - absenceRate);
  const homeworkSurvival = missingRate === null ? null : clampRate(1 - missingRate);
  const first = attendanceKeyword(report, attendanceStability);
  const second = homeworkKeyword(report, homeworkSurvival);
  return {
    attendanceStability,
    homeworkMissingRate: missingRate,
    keywords: [first, second],
    quip: buildQuip(report, attendanceStability, homeworkSurvival)
  };
}
