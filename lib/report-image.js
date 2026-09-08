const WIDTH = 1080;
const HEIGHT = 1440;
const FONT = '"PingFang SC", "Microsoft YaHei", system-ui, sans-serif';

const GRADE_COLORS = Object.freeze({
  SSS: ["#43d9b1", "#4f7cff"],
  SS: ["#42d7f5", "#5966ff"],
  S: ["#55d68b", "#18a06e"],
  A: ["#ffd56a", "#ff9b4a"],
  B: ["#ffb35c", "#f17848"],
  C: ["#ff8b68", "#e65263"],
  D: ["#f06f78", "#b64066"],
  F: ["#ff5d6c", "#792653"]
});

export async function createBattleReportPng(report) {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("当前浏览器无法生成分享图");
  drawReport(ctx, report);
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error("分享图生成失败")), "image/png");
  });
  return { blob, filename: `城大战绩-${report.grade || "暂无等级"}.png` };
}

export function drawReport(ctx, report) {
  const colors = GRADE_COLORS[report.grade] || ["#60728d", "#29394f"];
  const background = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  background.addColorStop(0, "#101a31");
  background.addColorStop(0.48, "#17294c");
  background.addColorStop(1, "#0b1427");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  glow(ctx, 160, 90, 360, colors[0], 0.24);
  glow(ctx, 940, 350, 420, colors[1], 0.22);
  glow(ctx, 580, 1320, 480, "#2a9e91", 0.12);

  ctx.fillStyle = "rgba(255,255,255,.72)";
  setFont(ctx, 28, 700);
  ctx.fillText("CITYU TRONCLASS · 城大战绩", 70, 82);
  ctx.fillStyle = "rgba(255,255,255,.48)";
  setFont(ctx, 20, 500);
  ctx.textAlign = "right";
  ctx.fillText("匿名学习报告", 1010, 82);
  ctx.textAlign = "left";

  roundedRect(ctx, 70, 124, 940, 338, 36);
  const hero = ctx.createLinearGradient(70, 124, 1010, 462);
  hero.addColorStop(0, "rgba(255,255,255,.14)");
  hero.addColorStop(1, "rgba(255,255,255,.055)");
  ctx.fillStyle = hero;
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,.16)";
  ctx.lineWidth = 2;
  ctx.stroke();

  const badgeGradient = ctx.createLinearGradient(110, 176, 360, 424);
  badgeGradient.addColorStop(0, colors[0]);
  badgeGradient.addColorStop(1, colors[1]);
  roundedRect(ctx, 110, 174, 246, 246, 66);
  ctx.fillStyle = badgeGradient;
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,.2)";
  ctx.beginPath();
  ctx.arc(314, 214, 96, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  setFont(ctx, report.grade === "SSS" ? 84 : 102, 900);
  ctx.fillText(report.grade || "—", 233, 327);
  ctx.textAlign = "left";

  ctx.fillStyle = "rgba(255,255,255,.58)";
  setFont(ctx, 21, 700);
  ctx.fillText("综合等级", 405, 214);
  ctx.fillStyle = "#fff";
  setFont(ctx, 48, 850);
  drawWrappedText(ctx, report.title || "暂无等级", 405, 282, 535, 58, 2);

  if (report.incomplete) {
    roundedRect(ctx, 405, 389, 505, 38, 19);
    ctx.fillStyle = "rgba(255,183,77,.16)";
    ctx.fill();
    ctx.fillStyle = "#ffd28b";
    setFont(ctx, 17, 700);
    ctx.fillText("数据可能不完整：部分课程或接口读取失败", 425, 415);
  }

  const stats = [
    ["已提交作业", report.homework.submitted],
    ["拍卡次数", report.attendance.punched],
    ["缺勤次数", report.attendance.absenceTotal],
    ["缺交作业", report.homework.missing]
  ];
  stats.forEach(([label, value], index) => {
    const x = 70 + index * 235;
    roundedRect(ctx, x, 492, 212, 142, 24);
    ctx.fillStyle = "rgba(255,255,255,.075)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,.1)";
    ctx.stroke();
    ctx.fillStyle = "#fff";
    setFont(ctx, 48, 850);
    ctx.fillText(String(value ?? 0), x + 24, 552);
    ctx.fillStyle = "rgba(255,255,255,.55)";
    setFont(ctx, 20, 600);
    ctx.fillText(label, x + 24, 596);
  });

  drawRateCard(ctx, 70, 668, 455, "缺勤率", report.attendance.absenceRate, colors);
  drawRateCard(ctx, 555, 668, 455, "缺交率", report.homework.missingRate, colors);

  roundedRect(ctx, 70, 856, 940, 392, 30);
  ctx.fillStyle = "rgba(255,255,255,.07)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,.1)";
  ctx.stroke();
  ctx.fillStyle = "#fff";
  setFont(ctx, 27, 800);
  ctx.fillText("需要留意的记录", 102, 906);
  ctx.fillStyle = "rgba(255,255,255,.5)";
  setFont(ctx, 17, 500);
  ctx.textAlign = "right";
  ctx.fillText(`覆盖 ${report.courseCount} 门课程 · 成功 ${report.successfulCourseCount} 门`, 978, 906);
  ctx.textAlign = "left";

  drawRecordColumn(ctx, {
    x: 102,
    y: 954,
    width: 414,
    title: `缺勤记录 ${report.attendance.absenceTotal}`,
    records: report.attendance.absenceRecords,
    label: (record) => `${shortDate(record.time)}  ${record.courseName}`,
    detail: (record) => record.detail || attendanceText(record.category)
  });
  ctx.fillStyle = "rgba(255,255,255,.1)";
  ctx.fillRect(539, 948, 2, 256);
  drawRecordColumn(ctx, {
    x: 568,
    y: 954,
    width: 410,
    title: `缺交作业 ${report.homework.missing}`,
    records: report.homework.missingRecords,
    label: (record) => `${shortDate(record.deadlineAt)}  ${record.courseName}`,
    detail: (record) => record.title
  });

  ctx.fillStyle = "rgba(255,255,255,.42)";
  setFont(ctx, 17, 500);
  ctx.fillText(`生成于 ${new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(report.generatedAt))}`, 70, 1323);
  ctx.fillText("数据来自当前登录账号可访问的 TronClass 内容", 70, 1355);

  roundedRect(ctx, 796, 1274, 214, 116, 18);
  ctx.strokeStyle = "rgba(255,255,255,.35)";
  ctx.lineWidth = 2;
  ctx.setLineDash([9, 8]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(255,255,255,.6)";
  ctx.textAlign = "center";
  setFont(ctx, 17, 700);
  ctx.fillText("项目二维码", 903, 1322);
  setFont(ctx, 15, 500);
  ctx.fillText("即将上线", 903, 1352);
  ctx.textAlign = "left";
}

function drawRateCard(ctx, x, y, width, label, rate, colors) {
  roundedRect(ctx, x, y, width, 154, 26);
  ctx.fillStyle = "rgba(255,255,255,.075)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,.1)";
  ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,.58)";
  setFont(ctx, 20, 700);
  ctx.fillText(label, x + 27, y + 43);
  ctx.fillStyle = "#fff";
  setFont(ctx, 43, 850);
  ctx.fillText(formatPercent(rate), x + 27, y + 94);
  roundedRect(ctx, x + 190, y + 67, width - 220, 15, 8);
  ctx.fillStyle = "rgba(255,255,255,.12)";
  ctx.fill();
  const fillWidth = Number.isFinite(rate) ? Math.max(0, Math.min(1, rate / 0.2)) * (width - 220) : 0;
  if (fillWidth > 0) {
    roundedRect(ctx, x + 190, y + 67, fillWidth, 15, 8);
    const gradient = ctx.createLinearGradient(x + 190, y, x + width, y);
    gradient.addColorStop(0, colors[0]);
    gradient.addColorStop(1, colors[1]);
    ctx.fillStyle = gradient;
    ctx.fill();
  }
  ctx.fillStyle = "rgba(255,255,255,.38)";
  setFont(ctx, 15, 500);
  ctx.fillText(Number.isFinite(rate) ? "20% 为 F 级警戒线" : "当前没有有效分母", x + 190, y + 111);
}

function drawRecordColumn(ctx, { x, y, width, title, records, label, detail }) {
  ctx.fillStyle = "rgba(255,255,255,.72)";
  setFont(ctx, 19, 750);
  ctx.fillText(title, x, y);
  const shown = (records || []).slice(0, 3);
  if (!shown.length) {
    ctx.fillStyle = "rgba(255,255,255,.38)";
    setFont(ctx, 17, 500);
    ctx.fillText("暂无记录", x, y + 48);
    return;
  }
  shown.forEach((record, index) => {
    const rowY = y + 39 + index * 70;
    ctx.fillStyle = "rgba(255,255,255,.62)";
    setFont(ctx, 16, 650);
    ctx.fillText(truncate(ctx, label(record), width), x, rowY);
    ctx.fillStyle = "rgba(255,255,255,.38)";
    setFont(ctx, 15, 500);
    ctx.fillText(truncate(ctx, detail(record), width), x, rowY + 26);
  });
  if (records.length > 3) {
    ctx.fillStyle = "rgba(255,255,255,.42)";
    setFont(ctx, 15, 600);
    ctx.fillText(`另有 ${records.length - 3} 条`, x, y + 267);
  }
}

function drawWrappedText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
  const chars = [...String(text || "")];
  let line = "";
  const lines = [];
  for (const char of chars) {
    const next = line + char;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = char;
      if (lines.length === maxLines) break;
    } else line = next;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines && chars.join("").length > lines.join("").length) {
    lines[maxLines - 1] = truncate(ctx, `${lines[maxLines - 1]}…`, maxWidth);
  }
  lines.forEach((value, index) => ctx.fillText(value, x, y + index * lineHeight));
}

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function glow(ctx, x, y, radius, color, opacity) {
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, hexToRgba(color, opacity));
  gradient.addColorStop(1, hexToRgba(color, 0));
  ctx.fillStyle = gradient;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
}

function hexToRgba(hex, alpha) {
  const value = hex.replace("#", "");
  const number = Number.parseInt(value, 16);
  return `rgba(${number >> 16},${(number >> 8) & 255},${number & 255},${alpha})`;
}

function truncate(ctx, value, width) {
  const text = String(value || "");
  if (ctx.measureText(text).width <= width) return text;
  let output = text;
  while (output && ctx.measureText(`${output}…`).width > width) output = output.slice(0, -1);
  return `${output}…`;
}

function setFont(ctx, size, weight) {
  ctx.font = `${weight} ${size}px ${FONT}`;
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "暂无数据";
}

function shortDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(date);
}

function attendanceText(category) {
  return ({ absent: "缺席", personalLeave: "事假", sickLeave: "病假" })[category] || "异常";
}
