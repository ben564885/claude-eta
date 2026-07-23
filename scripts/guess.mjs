#!/usr/bin/env node
// Invoked by the /eta-guess slash command. Logs the developer's own duration
// estimate (seconds) so it can be compared to the model's estimate and the
// actual outcome for the *next* prompt only — see lib/state.mjs
// writePendingGuess/takePendingGuess for the handoff and its TTL.

import { writePendingGuess } from "../lib/state.mjs";

const sid = process.env.CLAUDE_CODE_SESSION_ID;
const arg = process.argv[2];
const sec = Number(arg);

if (!sid) {
  console.log("No active Claude Code session id found (CLAUDE_CODE_SESSION_ID unset) — nothing logged.");
  process.exit(0);
}

if (!Number.isFinite(sec) || sec <= 0) {
  console.log(`Usage: /eta-guess <seconds> — got ${JSON.stringify(arg)}, expected a positive number.`);
  process.exit(0);
}

writePendingGuess(sid, sec);
console.log(`Logged your estimate: ${sec}s. It'll be recorded against whatever you send me next.`);
