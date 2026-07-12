import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Overridable so automated tests (and power users who want state elsewhere)
// never have to touch a real ~/.claude/eta.
const ROOT = process.env.CLAUDE_ETA_HOME || path.join(os.homedir(), ".claude", "eta");
const STATE_DIR = path.join(ROOT, "state");
const HISTORY_FILE = path.join(ROOT, "history.jsonl");
const STALE_MS = 6 * 60 * 60 * 1000; // 6h: a session state older than this is dead, not slow

function ensureDirs() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
}

function stateFile(sid) {
  return path.join(STATE_DIR, `${sid}.json`);
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
    try {
      const stat = fs.statSync(full);
      if (now - stat.mtimeMs > STALE_MS) fs.unlinkSync(full);
    } catch {
      // race with another process clearing it; ignore
    }
  }
}
