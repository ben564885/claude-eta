import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { languageFromPath, isTestPath, hashId, summarizeFileList, scanRepo } from "../lib/repo.mjs";

test("languageFromPath maps common source extensions", () => {
  assert.equal(languageFromPath("src/index.ts"), "TypeScript");
  assert.equal(languageFromPath("main.py"), "Python");
  assert.equal(languageFromPath("README.md"), null);
});

test("isTestPath recognizes common test file/dir conventions", () => {
  assert.ok(isTestPath("lib/__tests__/foo.js"));
  assert.ok(isTestPath("src/foo.test.ts"));
  assert.ok(isTestPath("tests/bar.py"));
  assert.ok(!isTestPath("src/foo.ts"));
});

test("hashId is deterministic and does not leak the input", () => {
  const a = hashId("https://github.com/example/private-repo.git");
  const b = hashId("https://github.com/example/private-repo.git");
  assert.equal(a, b);
  assert.equal(a.length, 12);
  assert.ok(!a.includes("private-repo"));
});

test("summarizeFileList picks the majority language and flags a test suite", () => {
  const summary = summarizeFileList(["src/a.ts", "src/b.ts", "src/c.py", "src/c.test.ts"]);
  assert.equal(summary.file_count, 4);
  assert.equal(summary.primary_language, "TypeScript");
  assert.equal(summary.test_suite_present, true);
});

test("summarizeFileList reports no test suite when nothing matches", () => {
  const summary = summarizeFileList(["src/a.ts", "README.md"]);
  assert.equal(summary.test_suite_present, false);
});

test("scanRepo returns null for a nonexistent path", () => {
  assert.equal(scanRepo("/definitely/not/a/real/path/xyz"), null);
});

test("scanRepo returns null for a non-string cwd", () => {
  assert.equal(scanRepo(undefined), null);
});

test("scanRepo scans a real git repo: file count, language, test suite, dirty flag, stable repo_id", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-eta-repo-test-"));
  execSync("git init -q", { cwd: dir });
  execSync('git config user.email "t@example.com" && git config user.name "T"', { cwd: dir });
  fs.mkdirSync(path.join(dir, "src"));
  fs.writeFileSync(path.join(dir, "src", "a.ts"), "export const a = 1;\n");
  fs.writeFileSync(path.join(dir, "src", "a.test.ts"), "test();\n");
  execSync("git add -A && git commit -q -m init", { cwd: dir });

  const clean = scanRepo(dir);
  assert.equal(clean.file_count, 2);
  assert.equal(clean.primary_language, "TypeScript");
  assert.equal(clean.test_suite_present, true);
  assert.equal(clean.git_dirty, false);
  assert.equal(typeof clean.repo_id, "string");
  assert.equal(clean.repo_id.length, 12);
  assert.ok(clean.loc === null || clean.loc >= 2);

  fs.writeFileSync(path.join(dir, "src", "a.ts"), "export const a = 2;\n");
  const dirty = scanRepo(dir);
  assert.equal(dirty.git_dirty, true);
  assert.equal(dirty.repo_id, clean.repo_id, "repo_id should be stable across scans of the same repo");
});

test("scanRepo falls back to a bounded find for a non-git directory", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-eta-nongit-test-"));
  fs.writeFileSync(path.join(dir, "one.txt"), "x");
  fs.writeFileSync(path.join(dir, "two.txt"), "y");

  const result = scanRepo(dir);
  assert.equal(result.file_count, 2);
  assert.equal(result.primary_language, null);
  assert.equal(result.git_dirty, null);
  assert.equal(typeof result.repo_id, "string");
});
