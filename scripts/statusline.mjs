#!/usr/bin/env node
// Statusline renderer. Re-runs on every render; must stay cheap.

import { readStdin, sidOf, fmt } from "../lib/util.mjs";
import { readState } from "../lib/state.mjs";

const BAR_CELLS = 8;

const input = await readStdin();
const sid = sidOf(input);

const state = readState(sid);
if (!state) {
  process.stdout.write("");
  process.exit(0);
}

const elapsedSec = Math.max(0, (Date.now() - state.t_start) / 1000);
const p50 = state.p50 ?? state.p50_prior ?? elapsedSec;
const remaining = Math.max(0, Math.round(p50 - elapsedSec));

const progress = p50 > 0 ? Math.min(1, elapsedSec / p50) : 1;
const filled = Math.round(progress * BAR_CELLS);
const bar = "█".repeat(filled) + "░".repeat(BAR_CELLS - filled);

const issues = state.issues ?? 0;
const warn = issues > 0 ? ` +${issues}⚠` : "";

process.stdout.write(`⏱ ~${fmt(remaining)} left ${bar}${warn}`);
