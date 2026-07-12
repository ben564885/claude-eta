// Lognormal survival math for in-flight revision, plus phase-duration
// modifiers learned from history.
//
// The v1 revise() shrank "remaining" toward a floor as time passed, which is
// exactly backwards for heavy-tailed run times: a run that has already blown
// past its median is *more* likely to keep going, not less. v2 instead treats
// the initial estimate as a lognormal prior over total duration T and, at
// each revision, reports quantiles of T conditioned on T > elapsed — the
// textbook survival update, under which expected remaining time grows in the
// tail on its own.

// Abramowitz & Stegun 7.1.26 — max abs error ~1.5e-7, plenty for quantiles.
function erf(x) {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

export function normCdf(z) {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

// Acklam's rational approximation to the inverse normal CDF (~1.15e-9 rel err).
export function normInv(p) {
  if (!(p > 0)) return -Infinity;
  if (!(p < 1)) return Infinity;

  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];

  const pLow = 0.02425;
  let q, r;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= 1 - pLow) {
    q = p - 0.5;
    r = q * q;
    return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

// Deep in the tail F(elapsed) → 1 and conditional quantiles explode; capping
// the conditioning point keeps the countdown finite ("we're way past p99.5,
// hold the band there") instead of quoting hours.
const F_CAP = 0.995;

// q-quantile of total duration T ~ LogNormal(mu, sigma), given T > elapsedSec.
export function conditionalQuantile(mu, sigma, elapsedSec, q) {
  if (!(elapsedSec > 0)) return Math.exp(mu + sigma * normInv(q));
  const fElapsed = Math.min(normCdf((Math.log(elapsedSec) - mu) / sigma), F_CAP);
  const z = normInv(fElapsed + q * (1 - fElapsed));
  return Math.max(elapsedSec, Math.exp(mu + sigma * z));
}

export function conditionalBand(mu, sigma, elapsedSec) {
  return {
    p10: Math.round(conditionalQuantile(mu, sigma, elapsedSec, 0.1)),
    p50: Math.round(conditionalQuantile(mu, sigma, elapsedSec, 0.5)),
    p90: Math.round(conditionalQuantile(mu, sigma, elapsedSec, 0.9)),
  };
}

// ---- phase modifiers ----

// Seeds matching v1's hardcoded behavior; replaced by fitPhaseMods() output
// once history is deep enough.
export const DEFAULT_PHASE_MODS = { explore: 1, edit: 1, test: 1.25, debug: 1.25, other: 1 };

const PHASES = Object.keys(DEFAULT_PHASE_MODS);
const MIN_RUNS_FOR_MODS = 12;
const MIN_PHASE_SAMPLES = 5;
const MOD_MIN = 0.5;
const MOD_MAX = 3;

// A phase counts as "featured" in a run if it took a meaningful slice of it.
function featured(row, phase) {
  const times = row.phase_times ?? {};
  const spent = times[phase] ?? 0;
  if (spent <= 0) return false;
  const total = Object.values(times).reduce((a, b) => a + (b > 0 ? b : 0), 0);
  return spent >= 10_000 || (total > 0 && spent / total >= 0.15);
}

// Learn, from aggregate phase_times, how much longer runs that feature a
// phase tend to be than runs overall (geometric-mean ratio in log space).
// revise() multiplies its total-duration estimate by the current phase's mod.
export function fitPhaseMods(rows) {
  const mods = { ...DEFAULT_PHASE_MODS };
  const valid = (rows ?? []).filter((r) => r.actual_sec > 0 && r.phase_times);
  if (valid.length < MIN_RUNS_FOR_MODS) return mods;

  const logTotals = valid.map((r) => Math.log(r.actual_sec));
  const overallMean = logTotals.reduce((a, b) => a + b, 0) / logTotals.length;

  for (const phase of PHASES) {
    const present = valid.filter((r) => featured(r, phase));
    if (present.length < MIN_PHASE_SAMPLES) continue;
    const mean = present.reduce((a, r) => a + Math.log(r.actual_sec), 0) / present.length;
    mods[phase] = Math.min(MOD_MAX, Math.max(MOD_MIN, Math.exp(mean - overallMean)));
  }
  return mods;
}
