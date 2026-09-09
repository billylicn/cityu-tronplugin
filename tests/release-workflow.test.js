import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

test("Release 工作流只由语义化版本标签触发并保留版本校验", () => {
  assert.match(workflow, /tags:\s*\n\s*- "v\*\.\*\.\*"/);
  assert.match(workflow, /\^v\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+\$/);
  assert.match(workflow, /manifest_version/);
  assert.match(workflow, /package_version/);
});

test("Release 正文包含更新、安装和数据清除提示", () => {
  assert.match(workflow, /RELEASE_NOTES: \|/);
  assert.match(workflow, /## 从旧版本更新/);
  assert.match(workflow, /## 首次安装/);
  assert.match(workflow, /## 本次更新内容/);
  assert.match(workflow, /不能直接加载 ZIP 文件/);
  assert.match(workflow, /`chrome:\/\/extensions\/`/);
  assert.match(workflow, /找到旧版 CityU TronClass Plugin，点击“移除”/);
  assert.match(workflow, /开启右上角“开发者模式”/);
  assert.match(workflow, /加载已解压的扩展程序/);
  assert.match(workflow, /清除插件的本地缓存、页面布局和忽略设置/);
  assert.match(workflow, /不会修改 TronClass 原站中的课程、作业、考勤或文件数据/);
});

test("Release 同时使用固定说明和 GitHub 自动更新说明且只上传 ZIP", () => {
  assert.match(workflow, /--notes "\$\{RELEASE_NOTES\}"/);
  assert.match(workflow, /--generate-notes/);
  assert.match(workflow, /"\$\{\{ steps\.package\.outputs\.archive \}\}"/);
  assert.doesNotMatch(workflow, /sha256|\.sha256/i);
});

test("README 的更新方法与 Release 说明一致", () => {
  assert.match(readme, /移除旧版 CityU TronClass Plugin，再加载新版本目录/);
  assert.match(readme, /清除插件的本地缓存、页面布局和忽略设置/);
  assert.match(readme, /不会修改 TronClass 原站中的课程、作业、考勤或文件数据/);
});
