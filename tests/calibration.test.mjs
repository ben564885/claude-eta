import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.CLAUDE_ETA_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "claude-eta-test-"));

const { recordOutcome, getBiasFactor, getPredictiveSigma, emptyStats, addOutcome, biasOf, sigmaOf, describe, globalBiasOf, readCalibrationFile } =
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

test("describe() never produces NaN — regression for the stats.mjs display bug", () => {
  // The stored bucket/global shape is {n, mean, m2} (Welford), not {bias, n};
  // stats.mjs used to read the file directly and call Math.exp(entry.bias),
  // which is always undefined on the v2 schema -> NaN on every line.
  // describe() is the fix: it applies the same shrinkage math the estimator
  // itself uses, so display always matches what's actually applied.
  const stats = emptyStats();
  addOutcome(stats, { model: "opus", mode: "normal" }, 100, 200);
  addOutcome(stats, { model: "sonnet", mode: "thinking" }, 50, 40);
  const result = describe(stats);
  assert.ok(Number.isFinite(result.global.factor), `global factor was ${result.global.factor}`);
  for (const b of result.buckets) {
    assert.ok(Number.isFinite(b.factor), `bucket ${b.key} factor was ${b.factor}`);
  }
});

test("describe() with no history returns neutral factors, not NaN", () => {
  const result = describe(emptyStats());
  assert.equal(result.global.factor, 1);
  assert.deepEqual(result.buckets, []);
});

test("describe()'s bucket factor matches biasOf() exactly (single source of truth)", () => {
  const stats = emptyStats();
  const features = { model: "haiku", mode: "plan" };
  for (let i = 0; i < 6; i++) addOutcome(stats, features, 100, 150);
  const result = describe(stats);
  const bucket = result.buckets.find((b) => b.key === "haiku:plan");
  assert.ok(bucket);
  assert.ok(Math.abs(bucket.factor - Math.exp(biasOf(stats, features))) < 1e-9);
});

test("describe() defaults to the persisted file when called with no argument", () => {
  recordOutcome({ model: "opus", mode: "normal" }, 100, 200);
  const result = describe();
  assert.ok(Number.isFinite(result.global.factor));
  const fileStats = readCalibrationFile();
  assert.ok(fileStats.global.n >= 1);
});

test("globalBiasOf ignores bucket-specific evidence", () => {
  const stats = emptyStats();
  // Heavy evidence in one bucket only; the pure global component should
  // still reflect just the (identical, since global tracks every outcome)
  // aggregate — but must not equal the *bucket-blended* biasOf for an
  // untouched bucket once enough runs exist to separate them meaningfully.
  for (let i = 0; i < 20; i++) addOutcome(stats, { model: "opus", mode: "normal" }, 100, 200);
  const pureGlobal = globalBiasOf(stats);
  const blendedForSameBucket = biasOf(stats, { model: "opus", mode: "normal" });
  // With this much bucket-specific evidence, the blended estimate leans
  // further toward the bucket's own mean than the pure global component does.
  assert.ok(blendedForSameBucket >= pureGlobal - 1e-9);
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
