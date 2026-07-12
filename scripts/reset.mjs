#!/usr/bin/env node
// Clears learned calibration and run history so claude-eta starts fresh.
// Invoked via the /eta-reset slash command. Leaves in-flight session state
// alone — this only resets what's been learned, not a run in progress.

import fs from "node:fs";
import path from "node:path";
import { etaRoot } from "../lib/state.mjs";

const targets = ["calibration.json", "history.jsonl", "model.json"];
const cleared = [];

for (const name of targets) {
  const full = path.join(etaRoot(), name);
  try {
    fs.unlinkSync(full);
    cleared.push(name);
  } catch {
    // wasn't there — nothing to clear
  }
}

console.log(
  cleared.length > 0
    ? `Cleared: ${cleared.join(", ")}. claude-eta will re-learn from scratch.`
    : "Nothing to clear — no calibration or history data yet."
);
