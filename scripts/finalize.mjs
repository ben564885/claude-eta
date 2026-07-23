#!/usr/bin/env node
// Stop hook. Closes out the run: appends one content-free row to the local
// history log, then clears session state.

import { readStdin, sidOf, modelFromTranscript, pluginVersion } from "../lib/util.mjs";
import { readState, clearState, appendHistory } from "../lib/state.mjs";
import { recordOutcome } from "../lib/calibration.mjs";
import { normalizeModel } from "../lib/features.mjs";
import { maybeRetrain } from "../lib/train.mjs";

const input = await readStdin();
const sid = sidOf(input);

const state = readState(sid);
if (!state) process.exit(0);

// By Stop time the transcript contains this turn's own assistant entries, so
// the model read here is authoritative — it overrides whatever estimate.mjs
// guessed (or failed to guess) at submit time, so learning lands in the
// right model bucket even on a session's first turn.
const modelId = modelFromTranscript(input.transcript_path ?? input.transcriptPath);
const features = modelId ? { ...state.features, model: normalizeModel(modelId) } : state.features;

const now = Date.now();
const phaseTimes = { ...(state.phase_times ?? {}) };
const finalPhase = state.phase ?? "explore";
phaseTimes[finalPhase] = (phaseTimes[finalPhase] ?? 0) + (now - (state.phase_start ?? now));

const actualSec = Math.round((now - state.t_start) / 1000);

appendHistory({
  ts: new Date(now).toISOString(),
  session_id: sid,
  plugin_version: pluginVersion(),
  features,
  repo: state.repo ?? null,
  tools: state.tools ?? 0,
  issues: state.issues ?? 0,
  phase_times: phaseTimes,
  predicted_p50: state.p50_prior,
  predicted_p10: state.p10_prior,
  predicted_p90: state.p90_prior,
  actual_sec: actualSec,
  dev_estimate_sec: state.dev_estimate_sec ?? null,
});

recordOutcome(features, state.p50_prior, actualSec);

// Refresh learned artifacts (phase mods, quantile regression) when history
// has grown enough since the last training; a no-op most runs.
maybeRetrain();

clearState(sid);
