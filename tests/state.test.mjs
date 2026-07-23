import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.CLAUDE_ETA_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "claude-eta-test-"));

const { readRepoCache, writeRepoCache, writePendingGuess, takePendingGuess } = await import("../lib/state.mjs");

test("repo cache round-trips and misses cleanly for an unknown session", () => {
  assert.equal(readRepoCache("no-such-session"), null);
  const repo = { repo_id: "abc123", file_count: 42, loc: 1000, primary_language: "TypeScript", test_suite_present: true, git_dirty: false };
  writeRepoCache("sess-1", repo);
  assert.deepEqual(readRepoCache("sess-1"), repo);
});

test("pending guess is consumed exactly once", () => {
  writePendingGuess("sess-2", 90);
  assert.equal(takePendingGuess("sess-2"), 90);
  assert.equal(takePendingGuess("sess-2"), null);
});

test("pending guess rejects non-positive or missing values", () => {
  assert.equal(takePendingGuess("sess-never-guessed"), null);
});

test("stale pending guess (older than the handoff TTL) is discarded", () => {
  writePendingGuess("sess-3", 30);
  // Rewrite the file with a timestamp far enough in the past to exceed the
  // 10-minute handoff TTL, simulating a guess the developer never followed
  // up on with a real prompt.
  const file = path.join(process.env.CLAUDE_ETA_HOME, "state", "sess-3.guess.json");
  fs.writeFileSync(file, JSON.stringify({ sec: 30, ts: Date.now() - 20 * 60 * 1000 }));
  assert.equal(takePendingGuess("sess-3"), null);
});
