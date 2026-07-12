#!/usr/bin/env node
// UserPromptSubmit hook. MUST be near-instant: pure local computation, no
// network/LLM calls — this blocks the turn and has a 30s timeout upstream.

import { readStdin, sidOf, fmt, modelFromTranscript } from "../lib/util.mjs";
import { writeState, sweepStale } from "../lib/state.mjs";
import { extractFeatures } from "../lib/features.mjs";
import { estimateInitial } from "../lib/model.mjs";

const input = await readStdin();
const sid = sidOf(input);

const prompt = input.prompt ?? input.user_prompt ?? input.userPrompt ?? "";
// The hook payload has no model field; the transcript's last assistant entry
// does. At submit time that's the *previous* turn's model, but the model is
// sticky within a session, so it's almost always right — and finalize.mjs
// re-resolves it authoritatively before anything is learned from the run.
const model =
  input.model ??
  input.model_id ??
  modelFromTranscript(input.transcript_path ?? input.transcriptPath) ??
  process.env.ANTHROPIC_MODEL;
const mode = input.permission_mode ?? input.permissionMode;

const features = extractFeatures(prompt, { model, mode });
const { p10, p50, p90, sigma } = estimateInitial(features);

const now = Date.now();
writeState(sid, {
  t_start: now,
  features,
  p50_prior: p50,
  p10_prior: p10,
  p90_prior: p90,
  sigma_prior: sigma,
  p10,
  p50,
  p90,
  phase: "explore",
  phase_start: now,
  phase_times: {},
  tools: 0,
  issues: 0,
});

sweepStale();

process.stdout.write(
  JSON.stringify({
    systemMessage: `⏱ est. ~${fmt(p10)}–${fmt(p90)}`,
  })
);
