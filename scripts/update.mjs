#!/usr/bin/env node
// PostToolUse hook. Fires after every tool call — keep it cheap.

import { readStdin, sidOf } from "../lib/util.mjs";
import { readState, writeState } from "../lib/state.mjs";
import { classify, countIssues } from "../lib/phases.mjs";
import { revise } from "../lib/model.mjs";

const input = await readStdin();
const sid = sidOf(input);

const state = readState(sid);
if (!state) process.exit(0);

const tool = input.tool_name ?? input.toolName;
const toolInput = input.tool_input ?? input.toolInput ?? {};
const toolResult = input.tool_response ?? input.tool_result ?? input.toolResult;

const newIssues = countIssues(toolResult);
const totalIssues = (state.issues ?? 0) + newIssues;

let phase = classify(tool, toolInput);
// Escalate to "debug" once issues pile up inside test/explore work — this is
// not something classify() can see from the tool call alone.
if (totalIssues >= 2 && (phase === "test" || phase === "explore")) {
  phase = "debug";
}

const now = Date.now();
const phaseTimes = { ...(state.phase_times ?? {}) };
if (phase !== state.phase) {
  const priorPhase = state.phase ?? "explore";
  const spent = now - (state.phase_start ?? now);
  phaseTimes[priorPhase] = (phaseTimes[priorPhase] ?? 0) + spent;
}

const nextState = {
  ...state,
  phase,
  phase_start: phase !== state.phase ? now : state.phase_start ?? now,
  phase_times: phaseTimes,
  tools: (state.tools ?? 0) + 1,
  issues: totalIssues,
};

const { p10, p50, p90 } = revise(nextState);
nextState.p10 = p10;
nextState.p50 = p50;
nextState.p90 = p90;

writeState(sid, nextState);
