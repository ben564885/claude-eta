import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.CLAUDE_ETA_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "claude-eta-test-"));

const { recordOutcome, getBiasFactor } = await import("../lib/calibration.mjs");

test("starts at neutral (1x) bias with no history", () => {
  assert.equal(getBiasFactor({ model: "sonnet", mode: "normal" }), 1);
});

test("learns an upward correction from systematic underestimates", () => {
  const features = { model: "opus", mode: "normal" };
  for (let i = 0; i < 10; i++) recordOutcome(features, 100, 200); // always ran 2x prediction
  const factor = getBiasFactor(features);
  assert.ok(factor > 1.5, `expected a strong upward correction, got ${factor}`);
});

test("does not fully transfer one bucket's correction onto an unrelated bucket", () => {
  const hot = { model: "opus", mode: "thinking" };
  const cold = { model: "haiku", mode: "plan" };
  for (let i = 0; i < 5; i++) recordOutcome(hot, 100, 200);
  const coldFactor = getBiasFactor(cold);
  assert.ok(coldFactor > 1, "some mild global nudge is expected");
  assert.ok(coldFactor < 1.5, `expected damped transfer to an unrelated bucket, got ${coldFactor}`);
});

test("ignores invalid predicted/actual values instead of corrupting state", () => {
  // Use a bucket untouched by earlier tests in this file, and compare
  // before/after rather than assuming a global-neutral baseline — other
  // tests sharing this file's isolated CLAUDE_ETA_HOME may have already
  // nudged the global bias, which is expected, not a bug.
  const features = { model: "sonnet", mode: "thinking-untouched-bucket" };
  const before = getBiasFactor(features);
  recordOutcome(features, 0, 100);
  recordOutcome(features, 100, 0);
  recordOutcome(features, -5, 100);
  assert.equal(getBiasFactor(features), before);
});
