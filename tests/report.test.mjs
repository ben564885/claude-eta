import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.CLAUDE_ETA_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "claude-eta-report-test-"));

const { appendHistory } = await import("../lib/state.mjs");
const { recordOutcome } = await import("../lib/calibration.mjs");
const { buildReport } = await import("../lib/report.mjs");

function logRun({ predicted, p10, p90, actual, model = "sonnet", mode = "normal" }) {
  const features = { len_words: 10, file_refs: 0, model, mode };
  appendHistory({
    ts: new Date().toISOString(),
    features,
    tools: 2,
    issues: 0,
    phase_times: { explore: 1000 },
    predicted_p50: predicted,
    predicted_p10: p10,
    predicted_p90: p90,
    actual_sec: actual,
  });
  recordOutcome(features, predicted, actual);
}

test("empty history produces a report with nulls, not crashes", () => {
  const report = buildReport();
  assert.equal(report.n, 0);
  assert.equal(report.medianErrPct, null);
  assert.equal(report.bandCoveragePct, null);
  assert.deepEqual(report.scatter, []);
  assert.equal(report.qreg.active, false);
});

test("band coverage only counts rows that actually logged a band", () => {
  logRun({ predicted: 40, actual: 45 }); // no band (pre-v2 style row)
  logRun({ predicted: 40, p10: 20, p90: 80, actual: 45 }); // in band
  logRun({ predicted: 40, p10: 20, p90: 80, actual: 200 }); // out of band
  const report = buildReport();
  assert.equal(report.n, 3);
  assert.equal(report.bandedN, 2);
  assert.equal(report.bandCoveragePct, 50);
});

test("scatter marks inBand null for rows with no logged band, boolean otherwise", () => {
  const report = buildReport();
  const noBand = report.scatter.find((p) => p.p10 === null);
  assert.equal(noBand.inBand, null);
  const inBand = report.scatter.find((p) => p.p10 === 20 && p.actual === 45);
  assert.equal(inBand.inBand, true);
  const outBand = report.scatter.find((p) => p.actual === 200);
  assert.equal(outBand.inBand, false);
});

test("calibration buckets are populated and sane", () => {
  logRun({ predicted: 50, p10: 25, p90: 100, actual: 60, model: "opus", mode: "thinking" });
  const report = buildReport();
  const bucket = report.calibration.buckets.find((b) => b.key === "opus:thinking");
  assert.ok(bucket);
  assert.ok(Number.isFinite(bucket.factor));
  assert.ok(bucket.n >= 1);
});

test("recent caps at the last 10 runs", () => {
  for (let i = 0; i < 15; i++) logRun({ predicted: 30, p10: 15, p90: 60, actual: 30 + i });
  const report = buildReport();
  assert.equal(report.recent.length, 10);
  assert.equal(report.recent.at(-1).actual, 44);
});
