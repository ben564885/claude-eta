// Linear quantile regression on log(actual_sec) — the "actual model" that
// takes over from the heuristic-plus-calibration path once history is deep
// enough (QREG_MIN_RUNS). Three tiny linear models, one per quantile, fit by
// full-batch subgradient descent on pinball loss. Deterministic, dependency-
// free, and fits a few hundred rows in milliseconds inside the Stop hook.
//
// Predictions come straight from observed run times, so the calibration bias
// factor must NOT be applied on top — that would double-correct.

export const QREG_MIN_RUNS = 50;

const TAUS = { p10: 0.1, p50: 0.5, p90: 0.9 };
const EPOCHS = 300;
const LR0 = 0.5;
const L2 = 1e-3;
const FILE_REFS_CAP = 10;

// One-hot baselines: sonnet / normal.
export function featureVector(features = {}) {
  const f = features;
  return [
    Math.log1p(f.len_words ?? 0),
    Math.min(f.file_refs ?? 0, FILE_REFS_CAP),
    f.heavy ? 1 : 0,
    f.build ? 1 : 0,
    f.fix ? 1 : 0,
    f.explain ? 1 : 0,
    f.multi_step ? 1 : 0,
    f.model === "opus" ? 1 : 0,
    f.model === "haiku" ? 1 : 0,
    f.model === "fable" ? 1 : 0,
    f.model === "unknown" || f.model === undefined ? 1 : 0,
    f.mode === "plan" ? 1 : 0,
    f.mode === "thinking" ? 1 : 0,
  ];
}

function quantileOf(sorted, tau) {
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(tau * sorted.length)));
  return sorted[idx];
}

function fitOne(X, y, tau, means, sds) {
  const n = X.length;
  const d = X[0].length;
  const w = new Array(d).fill(0);
  let b = quantileOf([...y].sort((a, c) => a - c), tau);

  for (let epoch = 0; epoch < EPOCHS; epoch++) {
    const lr = LR0 / (1 + (5 * epoch) / EPOCHS);
    let gb = 0;
    const gw = new Array(d).fill(0);
    for (let i = 0; i < n; i++) {
      let pred = b;
      for (let j = 0; j < d; j++) pred += w[j] * ((X[i][j] - means[j]) / sds[j]);
      // Pinball subgradient wrt the prediction.
      const g = y[i] > pred ? -tau : 1 - tau;
      gb += g;
      for (let j = 0; j < d; j++) gw[j] += g * ((X[i][j] - means[j]) / sds[j]);
    }
    b -= (lr * gb) / n;
    for (let j = 0; j < d; j++) w[j] -= lr * (gw[j] / n + L2 * w[j]);
  }
  return { w, b };
}

// rows: history.jsonl entries. Returns null when there's not enough data.
export function fitQreg(rows) {
  const data = (rows ?? []).filter((r) => r.actual_sec > 0 && r.features);
  if (data.length < QREG_MIN_RUNS) return null;

  const X = data.map((r) => featureVector(r.features));
  const y = data.map((r) => Math.log(r.actual_sec));
  const d = X[0].length;

  const means = new Array(d).fill(0);
  const sds = new Array(d).fill(0);
  for (let j = 0; j < d; j++) {
    for (const x of X) means[j] += x[j];
    means[j] /= X.length;
    for (const x of X) sds[j] += (x[j] - means[j]) ** 2;
    sds[j] = Math.sqrt(sds[j] / X.length);
    if (sds[j] < 1e-9) sds[j] = 1; // constant column: standardization is a no-op
  }

  const models = {};
  for (const [name, tau] of Object.entries(TAUS)) {
    models[name] = fitOne(X, y, tau, means, sds);
  }
  return { n: data.length, means, sds, models };
}

const Z10 = 1.2816;

export function predictQuantiles(model, features) {
  const x = featureVector(features);
  const preds = {};
  for (const [name, { w, b }] of Object.entries(model.models)) {
    let pred = b;
    for (let j = 0; j < x.length; j++) pred += w[j] * ((x[j] - model.means[j]) / model.sds[j]);
    preds[name] = Math.exp(pred);
  }
  // Independently-fit quantiles can cross on unusual inputs; sorting restores order.
  const [p10, p50, p90] = [preds.p10, preds.p50, preds.p90].sort((a, b) => a - b);
  return {
    p10: Math.round(Math.max(1, p10)),
    p50: Math.round(Math.max(2, p50)),
    p90: Math.round(Math.max(3, p90)),
    // Equivalent log-space sd, so revise() can keep doing survival math on it.
    sigma: Math.log(Math.max(p90, 2) / Math.max(p10, 1)) / (2 * Z10),
  };
}
