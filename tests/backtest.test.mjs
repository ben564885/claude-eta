import { test } from "node:test";
import assert from "node:assert/strict";
import { runBacktest, median } from "../lib/backtest.mjs";

function row(actual_sec, features = {}) {
  return {
    actual_sec,
    features: { len_words: 10, file_refs: 0, model: "sonnet", mode: "normal", ...features },
  };
}

test("median handles even and odd counts", () => {
  assert.equal(median([1, 2, 3]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
});

test("returns null when there isn't enough history to say anything", () => {
  assert.equal(runBacktest([]), null);
  assert.equal(runBacktest([row(30)]), null);
});

test("filters out rows without actual_sec or features", () => {
  const rows = [row(30), row(40), { actual_sec: 0, features: {} }, { actual_sec: 50 }];
  const result = runBacktest(rows);
  assert.equal(result.n, 2);
});

test("scores both v1 and v2 with ordered, sane summaries", () => {
  const rows = Array.from({ length: 20 }, (_, i) => row(30 + (i % 5) * 5));
  const result = runBacktest(rows);
  assert.equal(result.n, 20);
  for (const summary of [result.v1, result.v2]) {
    assert.ok(summary.pinball >= 0);
    assert.ok(summary.coveragePct >= 0 && summary.coveragePct <= 100);
    assert.ok(summary.medianErrPct >= 0);
  }
  assert.equal(result.points.length, 20);
});

test("qreg stays inactive below QREG_MIN_RUNS and activates above it", () => {
  const below = Array.from({ length: 40 }, (_, i) => row(30 + (i % 3) * 10));
  assert.equal(runBacktest(below).qregUsed, 0);

  const above = Array.from({ length: 70 }, (_, i) => row(30 + (i % 3) * 10, { heavy: i % 2 === 0 }));
  const result = runBacktest(above);
  assert.ok(result.qregUsed > 0, "expected qreg to kick in once history crosses the threshold");
});

test("points carry a coherent, ordered band per run", () => {
  const rows = Array.from({ length: 15 }, (_, i) => row(20 + i * 3));
  const result = runBacktest(rows);
  for (const p of result.points) {
    assert.ok(p.p10 <= p.p50 && p.p50 <= p.p90, `unordered band at index ${p.index}`);
    assert.equal(p.covered, p.p10 <= p.actual && p.actual <= p.p90);
  }
});

test("is deterministic for identical input", () => {
  const rows = Array.from({ length: 25 }, (_, i) => row(30 + (i % 4) * 7, { fix: i % 2 === 0 }));
  assert.deepEqual(runBacktest([...rows]), runBacktest([...rows]));
});
