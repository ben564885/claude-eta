#!/usr/bin/env node
// Chronological replay of ~/.claude/eta/history.jsonl: for each logged run,
// train on everything strictly before it, predict, score. Compares the
// frozen v1 heuristic (no learning) against the full v2 pipeline (Bayesian
// calibration, switching to quantile regression once enough history exists),
// so "v2 is more accurate" is a measured claim, not a vibe. Read-only.
//
// Metrics:
//   pinball    — mean pinball (quantile) loss over p10/p50/p90; lower is better
//   coverage   — how often the actual landed inside the p10–p90 band (target ~80%)
//   median err — median |actual - p50| / actual

import { readHistory } from "../lib/state.mjs";
import { emptyStats, addOutcome, biasOf, sigmaOf } from "../lib/calibration.mjs";
import { heuristicP50, band, SIGMA_PRIOR } from "../lib/model.mjs";
import { fitQreg, predictQuantiles, QREG_MIN_RUNS } from "../lib/qreg.mjs";

const QREG_REFIT_EVERY = 10; // refit cadence during replay; keeps the backtest fast

function pinball(tau, actual, pred) {
  return actual >= pred ? tau * (actual - pred) : (1 - tau) * (pred - actual);
}

function score(acc, est, actual) {
  acc.pinball += (pinball(0.1, actual, est.p10) + pinball(0.5, actual, est.p50) + pinball(0.9, actual, est.p90)) / 3;
  acc.covered += est.p10 <= actual && actual <= est.p90 ? 1 : 0;
  acc.errs.push(Math.abs(actual - est.p50) / actual);
  acc.n += 1;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const rows = readHistory().filter((r) => r.actual_sec > 0 && r.features);

if (rows.length < 2) {
  console.log("Not enough history to backtest yet — need at least 2 completed runs.");
  process.exit(0);
}

const stats = emptyStats();
let qmodel = null;
let qTrainedAt = -1;
let qregUsed = 0;

const v1 = { pinball: 0, covered: 0, errs: [], n: 0 };
const v2 = { pinball: 0, covered: 0, errs: [], n: 0 };

rows.forEach((row, i) => {
  const f = row.features;
  const actual = row.actual_sec;

  score(v1, band(heuristicP50(f), SIGMA_PRIOR), actual);

  if (i >= QREG_MIN_RUNS && (qmodel === null || i - qTrainedAt >= QREG_REFIT_EVERY)) {
    const fitted = fitQreg(rows.slice(0, i));
    if (fitted) {
      qmodel = fitted;
      qTrainedAt = i;
    }
  }
  const est = qmodel
    ? predictQuantiles(qmodel, f)
    : band(heuristicP50(f) * Math.exp(biasOf(stats, f)), sigmaOf(stats, f));
  if (qmodel) qregUsed += 1;
  score(v2, est, actual);

  // Same feedback loop production uses: learn from the miss after predicting.
  addOutcome(stats, f, est.p50, actual);
});

function line(label, acc) {
  const cov = ((acc.covered / acc.n) * 100).toFixed(0);
  const err = (median(acc.errs) * 100).toFixed(0);
  console.log(
    `  ${label.padEnd(22)} pinball ${acc.pinball / acc.n < 100 ? " " : ""}${(acc.pinball / acc.n).toFixed(1).padStart(6)}   band coverage ${cov.padStart(3)}%   median |err| ${err.padStart(3)}%`
  );
}

console.log(`claude-eta backtest — ${rows.length} runs replayed chronologically\n`);
line("v1 frozen heuristic", v1);
line("v2 learned pipeline", v2);

console.log(
  qregUsed > 0
    ? `\n  quantile regression predicted ${qregUsed}/${rows.length} runs (active after run ${QREG_MIN_RUNS}).`
    : `\n  quantile regression inactive (needs ${QREG_MIN_RUNS}+ prior runs); v2 used Bayesian-calibrated heuristics throughout.`
);
if (rows.length < 30) {
  console.log(`  caution: ${rows.length} runs is a small sample — differences here are noisy.`);
}
