import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Overridable so automated tests (and power users who want state elsewhere)
// never have to touch a real ~/.claude/eta.
const ROOT = process.env.CLAUDE_ETA_HOME || path.join(os.homedir(), ".claude", "eta");
const STATE_DIR = path.join(ROOT, "state");
const HISTORY_FILE = path.join(ROOT, "history.jsonl");
const STALE_MS = 6 * 60 * 60 * 1000; // 6h: a session state older than this is dead, not slow
// Repo-shape scan is expensive-ish (shells out to git); cache it per session
// so it runs once on the session's first turn rather than every submit. TTL
// is longer than turn-state's since a session can run all day.
const REPO_CACHE_STALE_MS = 24 * 60 * 60 * 1000;
// A /eta-guess logged well before the next real prompt almost certainly
// belonged to a different intent, not this turn — don't misattribute it.
const GUESS_STALE_MS = 10 * 60 * 1000;

function ensureDirs() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
}

function stateFile(sid) {
  return path.join(STATE_DIR, `${sid}.json`);
}

function repoCacheFile(sid) {
  return path.join(STATE_DIR, `${sid}.repo.json`);
}

function guessFile(sid) {
  return path.join(STATE_DIR, `${sid}.guess.json`);
}

export function readState(sid) {
  try {
    const raw = fs.readFileSync(stateFile(sid), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function writeState(sid, state) {
  ensureDirs();
  const tmp = stateFile(sid) + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, stateFile(sid));
}

export function clearState(sid) {
  try {
    fs.unlinkSync(stateFile(sid));
  } catch {
    // already gone
  }
}

// Repo-shape cache: survives across turns within a session (unlike turn
// state, which finalize.mjs clears every Stop). Not touched by clearState.
export function readRepoCache(sid) {
  try {
    const raw = fs.readFileSync(repoCacheFile(sid), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function writeRepoCache(sid, repo) {
  ensureDirs();
  const tmp = repoCacheFile(sid) + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(repo));
  fs.renameSync(tmp, repoCacheFile(sid));
}

// Pending developer duration-estimate handoff for /eta-guess: written by
// guess.mjs, consumed (read + cleared) by the very next estimate.mjs call in
// the same session so it attaches to the next real prompt only.
export function writePendingGuess(sid, sec) {
  ensureDirs();
  const tmp = guessFile(sid) + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify({ sec, ts: Date.now() }));
  fs.renameSync(tmp, guessFile(sid));
}

export function takePendingGuess(sid) {
  let raw;
  try {
    raw = fs.readFileSync(guessFile(sid), "utf8");
  } catch {
    return null;
  }
  try {
    fs.unlinkSync(guessFile(sid));
  } catch {
    // race with another process consuming it; fine either way
  }
  try {
    const { sec, ts } = JSON.parse(raw);
    if (typeof sec !== "number" || !(sec > 0)) return null;
    if (Date.now() - ts > GUESS_STALE_MS) return null;
    return sec;
  } catch {
    return null;
  }
}

export function appendHistory(row) {
  ensureDirs();
  fs.appendFileSync(HISTORY_FILE, JSON.stringify(row) + "\n");
}

export function readHistory() {
  let raw;
  try {
    raw = fs.readFileSync(HISTORY_FILE, "utf8");
  } catch {
    return [];
  }
  const rows = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      // one malformed line shouldn't take down the whole read
    }
  }
  return rows;
}

export function etaRoot() {
  return ROOT;
}

export function sweepStale() {
  ensureDirs();
  let entries;
  try {
    entries = fs.readdirSync(STATE_DIR);
  } catch {
    return;
  }
  const now = Date.now();
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    const full = path.join(STATE_DIR, name);
    const staleMs = name.endsWith(".repo.json") ? REPO_CACHE_STALE_MS : name.endsWith(".guess.json") ? GUESS_STALE_MS : STALE_MS;
    try {
      const stat = fs.statSync(full);
      if (now - stat.mtimeMs > staleMs) fs.unlinkSync(full);
    } catch {
      // race with another process clearing it; ignore
    }
  }
}
