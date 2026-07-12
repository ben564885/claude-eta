import { test } from "node:test";
import assert from "node:assert/strict";
import { extractFeatures } from "../lib/features.mjs";

test("detects intent flags and file refs", () => {
  const f = extractFeatures("refactor auth.ts and fix the login bug @src/index.ts", {
    model: "claude-opus-4",
    mode: "plan-mode",
  });
  assert.equal(f.heavy, true);
  assert.equal(f.fix, true);
  assert.equal(f.model, "opus");
  assert.equal(f.mode, "plan");
  assert.ok(f.file_refs >= 2, `expected >=2 file refs, got ${f.file_refs}`);
});

test("defaults model/mode to sane fallbacks", () => {
  const f = extractFeatures("hello", {});
  assert.equal(f.model, "unknown");
  assert.equal(f.mode, "normal");
});

test("recognizes thinking mode and sonnet/haiku model families", () => {
  assert.equal(extractFeatures("x", { model: "claude-sonnet-4-5", mode: "normal" }).model, "sonnet");
  assert.equal(extractFeatures("x", { model: "claude-haiku-4-5", mode: "extended-thinking" }).model, "haiku");
  assert.equal(extractFeatures("x", { model: "claude-haiku-4-5", mode: "extended-thinking" }).mode, "thinking");
});

test("handles a non-string prompt without throwing", () => {
  const f = extractFeatures(undefined, {});
  assert.equal(f.len_words, 0);
  assert.equal(f.file_refs, 0);
});
