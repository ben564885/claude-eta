#!/usr/bin/env node
// Prints a human-readable report of how well estimates have tracked reality,
// and the calibration claude-eta has learned from it so far. Invoked via the
// /eta-stats slash command; safe to run any time — read-only.

import { readHistory } from "../lib/state.mjs";
import { fmt } from "../lib/util.mjs";
import { loadArtifacts } from "../lib/train.mjs";
import { QREG_MIN_RUNS } from "../lib/qreg.mjs";
import { describe } from "../lib/calibration.mjs";

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
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

// Band coverage — the honest metric for a range estimator: actuals should
// land inside the initial p10–p90 band ~80% of the time. Only rows logged
// by v2+ carry the band.
const banded = rows.filter((r) => r.predicted_p10 > 0 && r.predicted_p90 > 0 && r.actual_sec > 0);
if (banded.length > 0) {
  const covered = banded.filter((r) => r.predicted_p10 <= r.actual_sec && r.actual_sec <= r.predicted_p90).length;
  console.log(
    `  band coverage (target ~80%):   ${((covered / banded.length) * 100).toFixed(0)}% of ${banded.length} run${banded.length === 1 ? "" : "s"}`
  );
}

const cal = describe();
console.log(
  `\n  learned calibration (global): ${cal.global.factor.toFixed(2)}x over ${cal.global.n} run${cal.global.n === 1 ? "" : "s"}`
);

if (cal.buckets.length > 0) {
  console.log("\n  by model:mode bucket:");
  for (const b of cal.buckets) {
    console.log(`    ${b.key.padEnd(18)} ${b.factor.toFixed(2)}x  (n=${b.n})`);
  }
}

const artifacts = loadArtifacts();
if (artifacts) {
  const qreg = artifacts.qreg
    ? `active (trained on ${artifacts.qreg.n} runs)`
    : `inactive (activates at ${QREG_MIN_RUNS} runs; ${rows.length} logged)`;
  console.log(`\n  trained model:  quantile regression ${qreg}`);
  const mods = Object.entries(artifacts.phase_mods ?? {})
    .filter(([, v]) => Math.abs(v - 1) > 0.01)
    .map(([k, v]) => `${k} ${v.toFixed(2)}x`);
  if (mods.length > 0) console.log(`  learned phase modifiers: ${mods.join(", ")}`);
} else {
  console.log(`\n  trained model:  none yet (first training at 12 runs; qreg at ${QREG_MIN_RUNS})`);
}

console.log("\n  last 5 runs:");
for (const r of rows.slice(-5)) {
  console.log(`    predicted ${fmt(r.predicted_p50)}, actual ${fmt(r.actual_sec)}`);
}

console.log('\n  backtest (v1 vs v2 replayed on your own history): node "$CLAUDE_PLUGIN_ROOT/scripts/backtest.mjs"');
