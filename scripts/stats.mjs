#!/usr/bin/env node
// Prints a human-readable report of how well estimates have tracked reality,
// and the calibration claude-eta has learned from it so far. Invoked via the
// /eta-stats slash command; safe to run any time — read-only.

import fs from "node:fs";
import path from "node:path";
import { readHistory, etaRoot } from "../lib/state.mjs";
import { fmt } from "../lib/util.mjs";

const CALIBRATION_FILE = path.join(etaRoot(), "calibration.json");

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function readCalibration() {
  try {
    return JSON.parse(fs.readFileSync(CALIBRATION_FILE, "utf8"));
  } catch {
    return { global: { bias: 0, n: 0 }, buckets: {} };
  }
}

const rows = readHistory();

if (rows.length === 0) {
  console.log("No completed runs logged yet — claude-eta learns as you use it.");
  process.exit(0);
}

const errors = rows
  .map((r) => ({ predicted: r.predicted_p50, actual: r.actual_sec }))
  .filter((e) => e.predicted > 0 && e.actual > 0)
  .map((e) => ({
    ratio: e.actual / e.predicted,
    absPct: Math.abs(e.actual - e.predicted) / e.predicted,
  }));

console.log(`claude-eta — ${rows.length} run${rows.length === 1 ? "" : "s"} logged\n`);

if (errors.length > 0) {
  console.log(`  median error:                  ${(median(errors.map((e) => e.absPct)) * 100).toFixed(0)}%`);
  console.log(`  median actual/predicted ratio: ${median(errors.map((e) => e.ratio)).toFixed(2)}x`);
}

const cal = readCalibration();
console.log(
  `\n  learned calibration (global): ${Math.exp(cal.global.bias).toFixed(2)}x over ${cal.global.n} run${cal.global.n === 1 ? "" : "s"}`
);

const bucketNames = Object.keys(cal.buckets ?? {});
if (bucketNames.length > 0) {
  console.log("\n  by model:mode bucket:");
  for (const name of bucketNames) {
    const b = cal.buckets[name];
    console.log(`    ${name.padEnd(18)} ${Math.exp(b.bias).toFixed(2)}x  (n=${b.n})`);
  }
}

console.log("\n  last 5 runs:");
for (const r of rows.slice(-5)) {
  console.log(`    predicted ${fmt(r.predicted_p50)}, actual ${fmt(r.actual_sec)}`);
}
