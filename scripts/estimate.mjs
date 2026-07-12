#!/usr/bin/env node
// UserPromptSubmit hook. MUST be near-instant: pure local computation, no
// network/LLM calls — this blocks the turn and has a 30s timeout upstream.

import { readStdin, sidOf, fmt } from "../lib/util.mjs";
import { writeState, sweepStale } from "../lib/state.mjs";
import { extractFeatures } from "../lib/features.mjs";
import { estimateInitial } from "../lib/model.mjs";

const input = await readStdin();
const sid = sidOf(input);

const prompt = input.prompt ?? input.user_prompt ?? input.userPrompt ?? "";
const model = input.model ?? input.model_id ?? process.env.ANTHROPIC_MODEL;
const mode = input.permission_mode ?? input.permissionMode;

const features = extractFeatures(prompt, { model, mode });
const { p10, p50, p90 } = estimateInitial(features);

const now = Date.now();
writeState(sid, {
  t_start: now,
  features,
  p50_prior: p50,
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
