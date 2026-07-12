// Online self-calibration: after every run, finalize.mjs reports
// {features, predicted_p50, actual_sec} here. We track a running log-space
// bias per (model:mode) bucket plus a global fallback, and estimateInitial()
// multiplies its heuristic estimate by exp(bias) going forward. This is
// intentionally simple (an EMA, not a real posterior) — it's what lets v1
// "learn" from its own misses without waiting for v2's trained model.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const ROOT = path.join(os.homedir(), ".claude", "eta");
const CALIBRATION_FILE = path.join(ROOT, "calibration.json");

const ALPHA = 0.2; // EMA weight on each new observation — recent runs matter more, but noise stays smoothed
const PSEUDO_COUNT = 5; // shrinkage: bucket bias needs ~this many samples before it outweighs the global one
const GLOBAL_PSEUDO_COUNT = 20; // global bias itself needs ~this many total runs before it's trusted at full strength

function ensureDir() {
  fs.mkdirSync(ROOT, { recursive: true });
}

function bucketKey(features) {
  return `${features?.model ?? "unknown"}:${features?.mode ?? "normal"}`;
}

function empty() {
  return { global: { bias: 0, n: 0 }, buckets: {} };
}

function read() {
  try {
    const cal = JSON.parse(fs.readFileSync(CALIBRATION_FILE, "utf8"));
    if (!cal.global) cal.global = { bias: 0, n: 0 };
    if (!cal.buckets) cal.buckets = {};
    return cal;
  } catch {
    return empty();
  }
}

function write(cal) {
  ensureDir();
  const tmp = CALIBRATION_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(cal));
  fs.renameSync(tmp, CALIBRATION_FILE);
}

function updateEntry(entry, logRatio) {
  const n = (entry?.n ?? 0) + 1;
  const prevBias = entry?.n ? entry.bias : logRatio;
  const bias = entry?.n ? prevBias + ALPHA * (logRatio - prevBias) : logRatio;
  return { bias, n };
}

// Call once a run finishes: teaches the estimator from its own miss.
export function recordOutcome(features, predictedSec, actualSec) {
  if (!(predictedSec > 0) || !(actualSec > 0)) return;

  const logRatio = Math.log(actualSec / predictedSec);
  const cal = read();
  cal.global = updateEntry(cal.global, logRatio);
  cal.buckets[bucketKey(features)] = updateEntry(cal.buckets[bucketKey(features)], logRatio);
  write(cal);
}

// Call at estimate time: how much to multiply the heuristic p50 by, given
// everything learned so far for this model/mode (blended with the global
// bias, shrunk toward it until the bucket has enough of its own samples).
export function getBiasFactor(features) {
  const cal = read();
  const bucket = cal.buckets[bucketKey(features)];
  const global = cal.global;

  // The global bias is itself shrunk toward "no correction" until enough
  // total runs have landed — otherwise a handful of noisy samples in one
  // bucket would fully transfer their correction onto every other bucket.
  const globalWeight = global.n / (global.n + GLOBAL_PSEUDO_COUNT);
  const effectiveGlobalBias = global.bias * globalWeight;

  const bucketBias = bucket?.bias ?? 0;
  const bucketN = bucket?.n ?? 0;
  const bucketWeight = bucketN / (bucketN + PSEUDO_COUNT);
  const blended = bucketWeight * bucketBias + (1 - bucketWeight) * effectiveGlobalBias;

  return Math.exp(blended);
}
