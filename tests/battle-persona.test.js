import test from "node:test";
import assert from "node:assert/strict";
import { buildBattlePersona } from "../lib/battle-persona.js";

function report(overrides = {}) {
  return {
    courseCount: 10,
    attendance: {
      validTotal: 20,
      punched: 19,
      late: 1,
      absenceTotal: 1,
      absenceRate: 0.05
    },
    homework: {
      due: 10,
      submitted: 9,
      missing: 1,
      missingRate: 0.1
    },
    ...overrides
  };
}

test("人格内容只生成考勤与作业关键词，不生成学期行为关键词", () => {
  const persona = buildBattlePersona(report({
    courseCount: 99,
    attendance: { validTotal: 40, punched: 40, late: 10, absenceTotal: 0, absenceRate: 0 },
    homework: { due: 25, submitted: 25, missing: 0, missingRate: 0 }
  }));

  assert.deepEqual(persona.keywords, ["#打卡机器", "#作业清零"]);
  assert.equal(persona.keywords.length, 2);
  assert.doesNotMatch(persona.keywords.join(" "), /踩点选手|作业永动机|高频打卡|校园常驻|多线程修课|课堂摸鱼/);
});

test("人格正向考勤指标与作业缺交率保持原始统计口径", () => {
  const persona = buildBattlePersona(report());
  assert.equal(persona.attendanceStability, 0.95);
  assert.equal(persona.homeworkMissingRate, 0.1);
  assert.equal(persona.keywords.length, 2);
  assert.ok(persona.quip.length > 0);
  assert.deepEqual(persona, buildBattlePersona(report()));
});

test("无有效分母时不虚构百分比，仍提供两个数据维度关键词", () => {
  const persona = buildBattlePersona(report({
    attendance: { validTotal: 0, punched: 0, late: 0, absenceTotal: 0, absenceRate: null },
    homework: { due: 0, submitted: 0, missing: 0, missingRate: null }
  }));
  assert.equal(persona.attendanceStability, null);
  assert.equal(persona.homeworkMissingRate, null);
  assert.deepEqual(persona.keywords, ["#考勤未解锁", "#作业未解锁"]);
  assert.ok(persona.quip.length > 0);
});
