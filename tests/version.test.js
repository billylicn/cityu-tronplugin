import test from "node:test";
import assert from "node:assert/strict";
import { compareVersions, displayVersion, normalizeVersion } from "../lib/version.js";

test("版本号支持 GitHub v 前缀并标准化展示", () => {
  assert.deepEqual(normalizeVersion("v0.3.2"), [0, 3, 2]);
  assert.deepEqual(normalizeVersion("1.10.0"), [1, 10, 0]);
  assert.equal(normalizeVersion("latest"), null);
  assert.equal(displayVersion("0.3.2"), "v0.3.2");
});

test("语义化版本比较按数字段判断更新", () => {
  assert.equal(compareVersions("v0.3.3", "0.3.2"), 1);
  assert.equal(compareVersions("0.3.2", "v0.3.2"), 0);
  assert.equal(compareVersions("0.3.2", "0.4.0"), -1);
  assert.equal(compareVersions("invalid", "0.3.2"), null);
});
