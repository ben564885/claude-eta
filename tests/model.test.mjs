import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Isolate from any real ~/.claude/eta before lib/model.mjs (which reads
// calibration state) gets imported.
process.env.CLAUDE_ETA_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "claude-eta-test-"));

const { estimateInitial, revise } = await import("../lib/model.mjs");

test("estimateInitial returns an ordered, positive band", () => {
  const { p10, p50, p90 } = estimateInitial({
    len_words: 9,
    file_refs: 1,
    heavy: true,
    build: true,
    model: "opus",
    mode: "normal",
  });
  assert.ok(p10 > 0);
  assert.ok(p10 < p50);
  assert.ok(p50 < p90);
});

test("heavier/build prompts estimate longer than a plain explain prompt", () => {
  const heavy = estimateInitial({ len_words: 20, file_refs: 3, heavy: true, build: true, model: "sonnet", mode: "normal" });
  const light = estimateInitial({ len_words: 5, file_refs: 0, explain: true, model: "sonnet", mode: "normal" });
  assert.ok(heavy.p50 > light.p50);
});

test("plan mode estimates shorter than thinking mode, all else equal", () => {
  const base = { len_words: 10, file_refs: 1, model: "sonnet" };
  const plan = estimateInitial({ ...base, mode: "plan" });
  const thinking = estimateInitial({ ...base, mode: "thinking" });
  assert.ok(plan.p50 < thinking.p50);
});

test("revise widens the p50 when issues pile up mid-run (the traffic effect)", () => {
  const base = { t_start: Date.now() - 5000, p50_prior: 200, tools: 1, issues: 0, phase: "explore" };
  const calm = revise(base);
  const rough = revise({ ...base, issues: 4, phase: "debug" });
  assert.ok(rough.p50 > calm.p50, `expected traffic to raise p50: calm=${calm.p50} rough=${rough.p50}`);
});

test("revise's band narrows as more tool calls are observed", () => {
  const state = { t_start: Date.now() - 1000, p50_prior: 300, issues: 0, phase: "explore" };
  const early = revise({ ...state, tools: 0 });
  const later = revise({ ...state, tools: 10 });
  assert.ok(later.p90 - later.p10 < early.p90 - early.p10);
});
