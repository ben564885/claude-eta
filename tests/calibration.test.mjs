import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.CLAUDE_ETA_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "claude-eta-test-"));

const { recordOutcome, getBiasFactor, getPredictiveSigma, emptyStats, addOutcome, biasOf, sigmaOf } =
  await import("../lib/calibration.mjs");

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
  // v2 semantics: unanimous evidence (every run 2x the prediction, zero
  // spread) is *allowed* to transfer strongly — that's correct Bayesian
  // behavior. What must never happen is full transfer of the 2x correction.
  const hot = { model: "opus", mode: "thinking" };
  const cold = { model: "haiku", mode: "plan" };
  for (let i = 0; i < 5; i++) recordOutcome(hot, 100, 200);
  const coldFactor = getBiasFactor(cold);
  assert.ok(coldFactor > 1, "some global nudge is expected");
  assert.ok(coldFactor < 2, `expected damped transfer to an unrelated bucket, got ${coldFactor}`);
});

test("transfer from few, noisy samples stays close to neutral", () => {
  // The shrinkage guard is about small/noisy evidence: three wildly
  // conflicting runs should barely move an unrelated bucket.
  const stats = emptyStats();
  const hot = { model: "opus", mode: "normal" };
  addOutcome(stats, hot, 100, 300);
  addOutcome(stats, hot, 100, 40);
  addOutcome(stats, hot, 100, 180);
  const coldBias = Math.exp(biasOf(stats, { model: "haiku", mode: "plan" }));
  assert.ok(coldBias > 0.85 && coldBias < 1.35, `expected near-neutral transfer, got ${coldBias}`);
});

test("predictive sigma narrows as consistent evidence accumulates", () => {
  const stats = emptyStats();
  const features = { model: "sonnet", mode: "normal" };
  const before = sigmaOf(stats, features);
  // Consistent outcomes: predictions off by a steady 1.1x, low spread.
  for (let i = 0; i < 30; i++) addOutcome(stats, features, 100, 108 + (i % 5));
  const after = sigmaOf(stats, features);
  assert.ok(after < before, `expected sigma to shrink with evidence: before=${before} after=${after}`);
});

test("file-backed sigma is available and sane", () => {
  const sigma = getPredictiveSigma({ model: "sonnet", mode: "normal" });
  assert.ok(sigma >= 0.25 && sigma <= 1.25, `sigma out of range: ${sigma}`);
});

test("migrates v1 {bias,n} calibration files instead of discarding them", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "claude-eta-migrate-"));
  fs.writeFileSync(
    path.join(home, "calibration.json"),
    JSON.stringify({ global: { bias: 0.5, n: 12 }, buckets: { "opus:normal": { bias: 0.5, n: 12 } } })
  );
  // Fresh import with its own home so this test sees only the v1 file.
  process.env.CLAUDE_ETA_HOME = home;
  const fresh = await import(`../lib/calibration.mjs?migrate=${Date.now()}`);
  const factor = fresh.getBiasFactor({ model: "opus", mode: "normal" });
  assert.ok(factor > 1.2, `expected the v1 learned bias to survive migration, got ${factor}`);
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
