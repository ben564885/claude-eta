#!/usr/bin/env node
// CLI wrapper around lib/backtest.mjs. See that file for the actual replay
// logic — this script only reads history and formats the result as text.
// Invoked via the /eta-stats follow-up or directly; safe to run any time,
// read-only.

import { readHistory } from "../lib/state.mjs";
import { runBacktest } from "../lib/backtest.mjs";
import { QREG_MIN_RUNS } from "../lib/qreg.mjs";

const rows = readHistory();
const result = runBacktest(rows);

if (!result) {
  console.log("Not enough history to backtest yet — need at least 2 completed runs.");
  process.exit(0);
}

function line(label, summary) {
  const cov = summary.coveragePct.toFixed(0);
  const err = summary.medianErrPct.toFixed(0);
  console.log(
    `  ${label.padEnd(22)} pinball ${summary.pinball < 100 ? " " : ""}${summary.pinball.toFixed(1).padStart(6)}   band coverage ${cov.padStart(3)}%   median |err| ${err.padStart(3)}%`
  );
}

console.log(`claude-eta backtest — ${result.n} runs replayed chronologically\n`);
line("v1 frozen heuristic", result.v1);
line("v2 learned pipeline", result.v2);

console.log(
  result.qregUsed > 0
    ? `\n  quantile regression predicted ${result.qregUsed}/${result.n} runs (active after run ${QREG_MIN_RUNS}).`
    : `\n  quantile regression inactive (needs ${QREG_MIN_RUNS}+ prior runs); v2 used Bayesian-calibrated heuristics throughout.`
);
if (result.n < 30) {
  console.log(`  caution: ${result.n} runs is a small sample — differences here are noisy.`);
}
