#!/usr/bin/env node
// Stop hook. Closes out the run: appends one content-free row to the local
// history log, then clears session state.

import { readStdin, sidOf } from "../lib/util.mjs";
import { readState, clearState, appendHistory } from "../lib/state.mjs";

const input = await readStdin();
const sid = sidOf(input);

const state = readState(sid);
if (!state) process.exit(0);

const now = Date.now();
const phaseTimes = { ...(state.phase_times ?? {}) };
const finalPhase = state.phase ?? "explore";
phaseTimes[finalPhase] = (phaseTimes[finalPhase] ?? 0) + (now - (state.phase_start ?? now));

const actualSec = Math.round((now - state.t_start) / 1000);

appendHistory({
  ts: new Date(now).toISOString(),
  features: state.features,
  tools: state.tools ?? 0,
  issues: state.issues ?? 0,
  phase_times: phaseTimes,
  predicted_p50: state.p50_prior,
  actual_sec: actualSec,
});

clearState(sid);
