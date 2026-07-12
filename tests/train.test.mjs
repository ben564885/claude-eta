import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.CLAUDE_ETA_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "claude-eta-train-test-"));

const { appendHistory } = await import("../lib/state.mjs");
const { maybeRetrain, loadArtifacts } = await import("../lib/train.mjs");
const { estimateInitial } = await import("../lib/model.mjs");
const { QREG_MIN_RUNS } = await import("../lib/qreg.mjs");

function logRun(actualSec, phase_times, features = {}) {
  appendHistory({
    ts: new Date().toISOString(),
    features: { len_words: 10, file_refs: 0, model: "sonnet", mode: "normal", ...features },
    tools: 3,
    issues: 0,
    phase_times,
    predicted_p50: 40,
    actual_sec: actualSec,
  });
}

test("no artifacts are trained on thin history", () => {
  for (let i = 0; i < 5; i++) logRun(30, { explore: 30_000 });
  assert.equal(maybeRetrain(), null);
  assert.equal(loadArtifacts(), null);
});

test("phase mods train once history crosses the threshold, before qreg does", () => {
  for (let i = 0; i < 10; i++) logRun(25 + i, { explore: (25 + i) * 1000 });
  const artifacts = maybeRetrain();
  assert.ok(artifacts, "expected artifacts at 15 runs");
  assert.ok(artifacts.phase_mods);
  assert.equal(artifacts.qreg, null, "qreg must stay inactive below QREG_MIN_RUNS");
  assert.ok(fs.existsSync(path.join(process.env.CLAUDE_ETA_HOME, "model.json")));
});

test("retraining is skipped until history grows enough, then picks up qreg", () => {
  const before = loadArtifacts();
  logRun(30, { explore: 30_000 });
  assert.equal(maybeRetrain().trained_at, before.trained_at, "one extra run must not retrain");

  const remaining = QREG_MIN_RUNS + 5 - 16;
  for (let i = 0; i < remaining; i++) {
    logRun(i % 2 === 0 ? 200 : 30, { explore: 20_000, edit: i % 2 === 0 ? 180_000 : 10_000 }, { heavy: i % 2 === 0 });
  }
  const artifacts = maybeRetrain();
  assert.ok(artifacts.qreg, `expected qreg to activate at ${QREG_MIN_RUNS}+ runs, n=${artifacts.n}`);
  assert.ok(artifacts.qreg.n >= QREG_MIN_RUNS);
});

test("estimateInitial uses the trained qreg once available", () => {
  const artifacts = loadArtifacts();
  assert.ok(artifacts?.qreg, "precondition: qreg trained by earlier test");
  const est = estimateInitial({ len_words: 10, heavy: true, model: "sonnet", mode: "normal" }, { artifacts });
  const heuristic = estimateInitial({ len_words: 10, heavy: true, model: "sonnet", mode: "normal" }, { artifacts: null });
  assert.ok(est.p10 <= est.p50 && est.p50 <= est.p90);
  // The two paths are different estimators; just confirm the qreg path is
  // actually being taken (deterministic, so equality would mean fallthrough).
  assert.notDeepEqual({ p10: est.p10, p50: est.p50, p90: est.p90 }, { p10: heuristic.p10, p50: heuristic.p50, p90: heuristic.p90 });
});
