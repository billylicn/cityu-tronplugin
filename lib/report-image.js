import { buildBattlePersona } from "./battle-persona.js";

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
  const persona = buildBattlePersona(report);
  const background = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  background.addColorStop(0, "#101a31");
  background.addColorStop(0.48, "#17294c");
  background.addColorStop(1, "#0b1427");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  glow(ctx, 150, 110, 390, colors[0], 0.24);
  glow(ctx, 955, 330, 440, colors[1], 0.22);
  glow(ctx, 560, 1340, 500, "#2a9e91", 0.12);

  ctx.fillStyle = "rgba(255,255,255,.72)";
  setFont(ctx, 28, 700);
  ctx.fillText("CITYU TRONCLASS · 城大战绩", 70, 82);
  ctx.fillStyle = "rgba(255,255,255,.48)";
  setFont(ctx, 20, 500);
  ctx.textAlign = "right";
  ctx.fillText("匿名学习报告", 1010, 82);
  ctx.textAlign = "left";

  drawGradePill(ctx, report.grade, colors);

  ctx.fillStyle = "rgba(255,255,255,.56)";
  ctx.textAlign = "center";
  setFont(ctx, 21, 700);
  ctx.fillText("本次记录人格称号", WIDTH / 2, 190);

  ctx.fillStyle = "#fff";
  const title = report.title || "暂无等级";
  const titleSize = fitFontSize(ctx, title, 78, 50, 870, 900);
  setFont(ctx, titleSize, 900);
  drawCenteredWrappedText(ctx, title, WIDTH / 2, 278, 880, titleSize * 1.16, 2);

  if (report.incomplete) {
    roundedRect(ctx, 388, 388, 304, 38, 19);
    ctx.fillStyle = "rgba(255,183,77,.15)";
    ctx.fill();
    ctx.fillStyle = "#ffd28b";
    setFont(ctx, 17, 700);
    ctx.fillText("数据可能不完整", WIDTH / 2, 414);
  }

  ctx.fillStyle = "rgba(255,255,255,.78)";
  setFont(ctx, 29, 650);
  drawCenteredWrappedText(ctx, `“${persona.quip}”`, WIDTH / 2, 486, 870, 43, 2);

  drawKeywordRow(ctx, persona.keywords, 574, colors);

  drawDivider(ctx, 70, 650, 1010);
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(255,255,255,.46)";
  setFont(ctx, 18, 700);
  ctx.fillText("本次记录累计", 70, 698);

  const stats = [
    ["已提交作业", report.homework?.submitted],
    ["拍卡次数", report.attendance?.punched],
    ["缺勤次数", report.attendance?.absenceTotal],
    ["缺交作业", report.homework?.missing]
  ];
  stats.forEach(([label, value], index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const x = 70 + column * 490;
    const y = 752 + row * 132;
    ctx.fillStyle = "#fff";
    setFont(ctx, 50, 850);
    ctx.fillText(String(value ?? 0), x, y);
    ctx.fillStyle = "rgba(255,255,255,.5)";
    setFont(ctx, 19, 600);
    ctx.fillText(label, x + 82, y - 7);
    if (column === 0) {
      ctx.fillStyle = "rgba(255,255,255,.11)";
      ctx.fillRect(520, y - 56, 1.5, 72);
    }
  });

  drawDivider(ctx, 70, 970, 1010);
  drawRateMetric(ctx, 70, 1020, 940, "出勤稳定度", persona.attendanceStability, colors);
  drawRateMetric(ctx, 70, 1138, 940, "作业缺交率", persona.homeworkMissingRate, ["#ffb35c", "#e65263"]);

  ctx.fillStyle = "rgba(255,255,255,.52)";
  setFont(ctx, 18, 600);
  ctx.fillText(`覆盖 ${Number(report.courseCount) || 0} 门课程 · 仅展示匿名汇总`, 70, 1315);
  ctx.fillStyle = "rgba(255,255,255,.36)";
  setFont(ctx, 16, 500);
  ctx.fillText("结果仅供辅助，请以 TronClass 原页面与教师要求为准", 70, 1350);

  roundedRect(ctx, 806, 1260, 204, 120, 18);
  ctx.strokeStyle = "rgba(255,255,255,.35)";
  ctx.lineWidth = 2;
  ctx.setLineDash([9, 8]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(255,255,255,.6)";
  ctx.textAlign = "center";
  setFont(ctx, 17, 700);
  ctx.fillText("项目二维码", 908, 1310);
  setFont(ctx, 15, 500);
  ctx.fillText("即将上线", 908, 1340);
  ctx.textAlign = "left";
}

function drawGradePill(ctx, grade, colors) {
  const label = `等级 ${grade || "—"}`;
  setFont(ctx, 20, 800);
  const width = Math.max(118, ctx.measureText(label).width + 38);
  const x = 1010 - width;
  roundedRect(ctx, x, 126, width, 48, 24);
  const gradient = ctx.createLinearGradient(x, 126, x + width, 174);
  gradient.addColorStop(0, hexToRgba(colors[0], 0.78));
  gradient.addColorStop(1, hexToRgba(colors[1], 0.78));
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.fillText(label, x + width / 2, 158);
  ctx.textAlign = "left";
}

function drawKeywordRow(ctx, keywords, y, colors) {
  setFont(ctx, 19, 750);
  const gap = 14;
  const widths = keywords.map((keyword) => ctx.measureText(keyword).width + 38);
  const totalWidth = widths.reduce((sum, width) => sum + width, 0) + gap * (widths.length - 1);
  let x = (WIDTH - totalWidth) / 2;
  keywords.forEach((keyword, index) => {
    roundedRect(ctx, x, y, widths[index], 48, 24);
    ctx.fillStyle = index === 0 ? hexToRgba(colors[0], 0.18) : "rgba(255,255,255,.085)";
    ctx.fill();
    ctx.strokeStyle = index === 0 ? hexToRgba(colors[0], 0.42) : "rgba(255,255,255,.13)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = index === 0 ? "#fff" : "rgba(255,255,255,.72)";
    ctx.textAlign = "center";
    ctx.fillText(keyword, x + widths[index] / 2, y + 31);
    x += widths[index] + gap;
  });
  ctx.textAlign = "left";
}

function drawRateMetric(ctx, x, y, width, label, rate, colors) {
  ctx.fillStyle = "rgba(255,255,255,.58)";
  setFont(ctx, 20, 700);
  ctx.fillText(label, x, y);
  ctx.fillStyle = "#fff";
  ctx.textAlign = "right";
  setFont(ctx, 38, 850);
  ctx.fillText(formatPercent(rate), x + width, y + 2);
  ctx.textAlign = "left";

  roundedRect(ctx, x, y + 34, width, 13, 7);
  ctx.fillStyle = "rgba(255,255,255,.11)";
  ctx.fill();
  const fillWidth = Number.isFinite(rate) ? Math.max(0, Math.min(1, rate)) * width : 0;
  if (fillWidth > 0) {
    roundedRect(ctx, x, y + 34, fillWidth, 13, 7);
    const gradient = ctx.createLinearGradient(x, y, x + width, y);
    gradient.addColorStop(0, colors[0]);
    gradient.addColorStop(1, colors[1]);
    ctx.fillStyle = gradient;
    ctx.fill();
  }
  ctx.fillStyle = "rgba(255,255,255,.36)";
  setFont(ctx, 15, 500);
  ctx.fillText(Number.isFinite(rate) ? "按当前有效记录计算" : "当前没有有效统计分母", x, y + 75);
}

function drawCenteredWrappedText(ctx, text, centerX, y, maxWidth, lineHeight, maxLines) {
  const lines = wrapText(ctx, text, maxWidth, maxLines);
  const previous = ctx.textAlign;
  ctx.textAlign = "center";
  lines.forEach((line, index) => ctx.fillText(line, centerX, y + index * lineHeight));
  ctx.textAlign = previous;
}

function wrapText(ctx, text, maxWidth, maxLines) {
  const chars = [...String(text || "")];
  const lines = [];
  let line = "";
  for (const char of chars) {
    const next = line + char;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = char;
      if (lines.length === maxLines) break;
    } else {
      line = next;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines && chars.join("").length > lines.join("").length) {
    lines[maxLines - 1] = truncate(ctx, `${lines[maxLines - 1]}…`, maxWidth);
  }
  return lines;
}

function fitFontSize(ctx, text, preferred, minimum, maxWidth, weight) {
  let size = preferred;
  while (size > minimum) {
    setFont(ctx, size, weight);
    if (ctx.measureText(text).width <= maxWidth) return size;
    size -= 2;
  }
  return minimum;
}

function drawDivider(ctx, x1, y, x2) {
  const gradient = ctx.createLinearGradient(x1, y, x2, y);
  gradient.addColorStop(0, "rgba(255,255,255,0)");
  gradient.addColorStop(0.12, "rgba(255,255,255,.16)");
  gradient.addColorStop(0.88, "rgba(255,255,255,.16)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(x1, y, x2 - x1, 1.5);
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
