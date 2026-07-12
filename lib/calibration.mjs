// Hierarchical Bayesian self-calibration (v2, replaces the v1 EMA).
//
// Model: each finished run contributes one observation of log(actual/predicted).
// A bucket's true log-bias is Normal(global bias, TAU_BUCKET²); the global
// bias is Normal(0, TAU_GLOBAL²); per-run noise variance is estimated from
// the data itself, stabilized by a prior. Posterior means fall out as the
// classic precision-weighted shrinkage — the same "bucket shrunk toward
// global shrunk toward no-correction" shape v1 had, but with weights that
// come from the observed noise instead of hand-picked pseudo-counts, and
// with a posterior *variance* that lets estimateInitial() size its p10–p90
// band from evidence instead of a hardcoded constant.
//
// The pure functions (emptyStats/addOutcome/biasOf/sigmaOf) operate on a
// plain stats object so scripts/backtest.mjs can replay history without
// touching the real calibration file; the exported recordOutcome/
// getBiasFactor/getPredictiveSigma wrap them with file persistence and keep
// their v1 signatures.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const ROOT = process.env.CLAUDE_ETA_HOME || path.join(os.homedir(), ".claude", "eta");
const CALIBRATION_FILE = path.join(ROOT, "calibration.json");

const TAU_GLOBAL = 0.2; // prior sd of the global log-bias: heuristic assumed within ~1.5x (2sd) overall
const TAU_BUCKET = 0.5; // prior sd of a bucket's deviation from the global bias
const SIGMA_OBS_PRIOR = 0.75; // prior guess at per-run log-space noise…
const SIGMA_OBS_PSEUDO = 8; // …carrying the weight of this many pseudo-runs
const SIGMA_MIN = 0.25; // runs are heavy-tailed; never claim a tighter initial band than ~±1.4x
const SIGMA_MAX = 1.25; // and never a band so wide the countdown is useless

function ensureDir() {
  fs.mkdirSync(ROOT, { recursive: true });
}

function bucketKey(features) {
  return `${features?.model ?? "unknown"}:${features?.mode ?? "normal"}`;
}

export function emptyStats() {
  return { version: 2, global: { n: 0, mean: 0, m2: 0 }, buckets: {} };
}

// Welford's online mean/variance update.
function welfordAdd(entry, x) {
  const n = (entry.n ?? 0) + 1;
  const mean = (entry.mean ?? 0) + (x - (entry.mean ?? 0)) / n;
  const m2 = (entry.m2 ?? 0) + (x - (entry.mean ?? 0)) * (x - mean);
  return { n, mean, m2 };
}

// v1 calibration files stored {bias, n} EMAs; carry them over as a mean with
// no spread (the noise prior supplies the variance until fresh runs land).
function migrateEntry(entry) {
  if (!entry) return { n: 0, mean: 0, m2: 0 };
  if (entry.mean !== undefined) return { n: entry.n ?? 0, mean: entry.mean, m2: entry.m2 ?? 0 };
  return { n: entry.n ?? 0, mean: entry.bias ?? 0, m2: 0 };
}

function read() {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(CALIBRATION_FILE, "utf8"));
  } catch {
    return emptyStats();
  }
  const stats = emptyStats();
  stats.global = migrateEntry(raw.global);
  for (const [key, entry] of Object.entries(raw.buckets ?? {})) {
    stats.buckets[key] = migrateEntry(entry);
  }
  return stats;
}

function write(stats) {
  ensureDir();
  const tmp = CALIBRATION_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(stats));
  fs.renameSync(tmp, CALIBRATION_FILE);
}

// Pooled per-run noise variance: sample variance of all observed log-ratios,
// stabilized by SIGMA_OBS_PSEUDO pseudo-runs at the prior value.
function obsVariance(stats) {
  const g = stats.global;
  return (
    (SIGMA_OBS_PSEUDO * SIGMA_OBS_PRIOR * SIGMA_OBS_PRIOR + (g.m2 ?? 0)) /
    (SIGMA_OBS_PSEUDO + (g.n ?? 0))
  );
}

export function addOutcome(stats, features, predictedSec, actualSec) {
  if (!(predictedSec > 0) || !(actualSec > 0)) return stats;
  const logRatio = Math.log(actualSec / predictedSec);
  stats.global = welfordAdd(stats.global, logRatio);
  const key = bucketKey(features);
  stats.buckets[key] = welfordAdd(stats.buckets[key] ?? { n: 0, mean: 0, m2: 0 }, logRatio);
  return stats;
}

// Posterior mean of the log-bias for this bucket (log-space; callers exp() it).
export function biasOf(stats, features) {
  const varObs = obsVariance(stats);
  const g = stats.global;

  const kGlobal = varObs / (TAU_GLOBAL * TAU_GLOBAL);
  const wGlobal = g.n / (g.n + kGlobal);
  const globalBias = wGlobal * g.mean;

  const bucket = stats.buckets[bucketKey(features)] ?? { n: 0, mean: 0 };
  const kBucket = varObs / (TAU_BUCKET * TAU_BUCKET);
  const wBucket = bucket.n / (bucket.n + kBucket);
  return wBucket * bucket.mean + (1 - wBucket) * globalBias;
}

// Predictive log-space sd for a fresh run in this bucket: per-run noise plus
// what's still unknown about the bucket's true bias. Shrinks as runs land.
export function sigmaOf(stats, features) {
  const varObs = obsVariance(stats);
  const bucket = stats.buckets[bucketKey(features)] ?? { n: 0 };
  const kBucket = varObs / (TAU_BUCKET * TAU_BUCKET);
  const posteriorVar = varObs / (bucket.n + kBucket);
  const sigma = Math.sqrt(varObs + posteriorVar);
  return Math.min(SIGMA_MAX, Math.max(SIGMA_MIN, sigma));
}

// ---- file-backed wrappers (v1 signatures, used by the hook scripts) ----

// Call once a run finishes: teaches the estimator from its own miss.
export function recordOutcome(features, predictedSec, actualSec) {
  if (!(predictedSec > 0) || !(actualSec > 0)) return;
  write(addOutcome(read(), features, predictedSec, actualSec));
}

// Call at estimate time: multiply the heuristic p50 by this.
export function getBiasFactor(features) {
  return Math.exp(biasOf(read(), features));
}

// Call at estimate time: log-space sd for the initial p10–p90 band.
export function getPredictiveSigma(features) {
  return sigmaOf(read(), features);
}
