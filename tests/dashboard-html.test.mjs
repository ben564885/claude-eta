import { test } from "node:test";
import assert from "node:assert/strict";
import { renderDashboardHTML } from "../lib/dashboard-html.mjs";

function emptyReport() {
  return {
    n: 0,
    medianErrPct: null,
    bandCoveragePct: null,
    bandedN: 0,
    calibration: { global: { factor: 1, n: 0 }, buckets: [] },
    qreg: { active: false, n: 0, minRuns: 50 },
    phaseMods: [],
    backtest: null,
    scatter: [],
    recent: [],
  };
}

test("renders without throwing on a fully empty report", () => {
  const html = renderDashboardHTML(emptyReport());
  assert.match(html, /<!doctype html>/i);
  assert.doesNotMatch(html, /NaN/);
  assert.doesNotMatch(html, />undefined</);
});

test("escapes bucket keys and untrusted-looking strings (no raw HTML injection)", () => {
  const report = emptyReport();
  report.n = 1;
  report.calibration.buckets = [{ key: '<img src=x onerror=alert(1)>:normal', n: 1, factor: 1.1 }];
  const html = renderDashboardHTML(report);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img src=x/);
});

test("does not crash and shows empty-state copy when sections have no data", () => {
  const html = renderDashboardHTML(emptyReport());
  assert.match(html, /No bucket data yet/);
  assert.match(html, /Need at least 2 completed runs to backtest/);
  assert.match(html, /No runs logged yet/);
});

// Regression test for a real bug: an extreme bucket bias factor (the
// legacy "unknown:normal" bucket, which can sit far from 1x) pushed its
// value label far enough left that it visually collided with the fixed
// name column. The fix reserves a label gutter and caps bar length to it;
// this test asserts the invariant holds regardless of how extreme the bias
// factor is, by extracting the actual rendered label x-position.
test("an extreme bucket's value label never encroaches on the name column", () => {
  const report = emptyReport();
  report.n = 2;
  report.calibration.buckets = [
    { key: "unknown:normal", n: 999, factor: 0.02 }, // extreme low bias
    { key: "sonnet:normal", n: 1, factor: 1.05 },
  ];
  const html = renderDashboardHTML(report);

  // Extract every <text ... text-anchor="end" ...>VALUE</text> in the
  // calibration chart (the low/red bars' value labels) and confirm their
  // x is comfortably clear of the name column (172px + a real safety
  // margin for a label as long as "0.02x (n=999)").
  const matches = [...html.matchAll(/<text x="([\d.]+)"[^>]*text-anchor="end" class="bar-value">([^<]+)<\/text>/g)];
  assert.ok(matches.length > 0, "expected at least one low-bar value label");
  for (const [, x] of matches) {
    assert.ok(Number(x) > 172 + 40, `value label x=${x} sits too close to the 172px name column`);
  }
});

test("flags a legacy unknown: bucket with a contextual note", () => {
  const report = emptyReport();
  report.n = 1;
  report.calibration.buckets = [{ key: "unknown:normal", n: 5, factor: 0.5 }];
  const html = renderDashboardHTML(report);
  assert.match(html, /predates the model-tag fix/);
});

test("backtest section renders both v1 and v2 bars with independent per-metric scale", () => {
  const report = emptyReport();
  report.n = 10;
  report.backtest = {
    n: 10,
    v1: { pinball: 16.4, coveragePct: 33, medianErrPct: 200 },
    v2: { pinball: 14.1, coveragePct: 71, medianErrPct: 107 },
    qregUsed: 0,
    points: [],
  };
  const html = renderDashboardHTML(report);
  assert.match(html, /16\.4/);
  assert.match(html, /14\.1/);
  assert.match(html, /71%/);
  assert.match(html, /own scale/);
});

test("scatter renders status colors for in-band/out-of-band and neutral for undated rows", () => {
  const report = emptyReport();
  report.n = 3;
  report.scatter = [
    { index: 0, predicted: 40, actual: 45, p10: 20, p90: 80, inBand: true },
    { index: 1, predicted: 40, actual: 400, p10: 20, p90: 80, inBand: false },
    { index: 2, predicted: 40, actual: 45, p10: null, p90: null, inBand: null },
  ];
  const html = renderDashboardHTML(report);
  assert.match(html, /dot-good/);
  assert.match(html, /dot-critical/);
  assert.match(html, /dot-nodata/);
});

test("table-view twin exists for every populated section", () => {
  const report = emptyReport();
  report.n = 2;
  report.calibration.buckets = [{ key: "sonnet:normal", n: 2, factor: 1.1 }];
  report.backtest = {
    n: 2,
    v1: { pinball: 10, coveragePct: 50, medianErrPct: 50 },
    v2: { pinball: 8, coveragePct: 70, medianErrPct: 30 },
    qregUsed: 0,
    points: [],
  };
  report.scatter = [{ index: 0, predicted: 40, actual: 45, p10: 20, p90: 80, inBand: true }];
  const html = renderDashboardHTML(report);
  const tableViewCount = (html.match(/Table view/g) ?? []).length;
  assert.equal(tableViewCount, 3, "expected a table-view toggle for calibration, backtest, and scatter");
});
