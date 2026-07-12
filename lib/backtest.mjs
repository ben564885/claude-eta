// Chronological replay of logged history: for each run, train on everything
// strictly before it, predict, score. Compares the frozen v1 heuristic (no
// learning) against the full v2 pipeline (Bayesian calibration, switching to
// quantile regression once enough history exists) — so "v2 is more accurate"
// is a measured claim. Pure function of `rows`; no file I/O, so both
// scripts/backtest.mjs (text) and scripts/dashboard.mjs (HTML) score
// identically off the one implementation.
//
// Metrics:
//   pinball    — mean pinball (quantile) loss over p10/p50/p90; lower is better
//   coverage   — how often the actual landed inside the p10–p90 band (target ~80%)
//   median err — median |actual - p50| / actual

import { emptyStats, addOutcome, biasOf, sigmaOf } from "./calibration.mjs";
import { heuristicP50, band, SIGMA_PRIOR } from "./model.mjs";
import { fitQreg, predictQuantiles, QREG_MIN_RUNS } from "./qreg.mjs";

const QREG_REFIT_EVERY = 10; // refit cadence during replay; keeps the backtest fast

function pinball(tau, actual, pred) {
  return actual >= pred ? tau * (actual - pred) : (1 - tau) * (pred - actual);
}

function makeAcc() {
  return { pinball: 0, covered: 0, errs: [], n: 0 };
}

function score(acc, est, actual) {
  acc.pinball += (pinball(0.1, actual, est.p10) + pinball(0.5, actual, est.p50) + pinball(0.9, actual, est.p90)) / 3;
  acc.covered += est.p10 <= actual && actual <= est.p90 ? 1 : 0;
  acc.errs.push(Math.abs(actual - est.p50) / actual);
  acc.n += 1;
}

export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function summarize(acc) {
  return {
    pinball: acc.pinball / acc.n,
    coveragePct: (acc.covered / acc.n) * 100,
    medianErrPct: median(acc.errs) * 100,
  };
}

// rows: history.jsonl entries (already read). Returns null when there's not
// enough data (<2 valid rows) to say anything.
export function runBacktest(rows) {
  const valid = (rows ?? []).filter((r) => r.actual_sec > 0 && r.features);
  if (valid.length < 2) return null;

  const stats = emptyStats();
  let qmodel = null;
  let qTrainedAt = -1;
  let qregUsed = 0;

  const v1 = makeAcc();
  const v2 = makeAcc();
  const points = [];

  valid.forEach((row, i) => {
    const f = row.features;
    const actual = row.actual_sec;

    const v1Est = band(heuristicP50(f), SIGMA_PRIOR);
    score(v1, v1Est, actual);

    if (i >= QREG_MIN_RUNS && (qmodel === null || i - qTrainedAt >= QREG_REFIT_EVERY)) {
      const fitted = fitQreg(valid.slice(0, i));
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

    points.push({
      index: i,
      actual,
      v1_p50: v1Est.p50,
      p10: est.p10,
      p50: est.p50,
      p90: est.p90,
      usedQreg: !!qmodel,
      covered: est.p10 <= actual && actual <= est.p90,
    });

    // Same feedback loop production uses: learn from the miss after predicting.
    addOutcome(stats, f, est.p50, actual);
  });

  return {
    n: valid.length,
    v1: summarize(v1),
    v2: summarize(v2),
    qregUsed,
    points,
  };
}
