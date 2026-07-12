import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { fmt, sidOf, readStdin, modelFromTranscript } from "../lib/util.mjs";

test("fmt formats seconds humanely", () => {
  assert.equal(fmt(5), "5s");
  assert.equal(fmt(59), "59s");
  assert.equal(fmt(65), "1m5s");
  assert.equal(fmt(120), "2m");
  assert.equal(fmt(3660), "1h1m");
  assert.equal(fmt(-5), "0s");
});

test("sidOf falls back across field name variants", () => {
  assert.equal(sidOf({ session_id: "a" }), "a");
  assert.equal(sidOf({ sessionId: "b" }), "b");
  assert.equal(sidOf({ session: "c" }), "c");
  assert.equal(sidOf({}), "unknown");
});

test("readStdin parses well-formed JSON", async () => {
  const stream = Readable.from([Buffer.from('{"session_id":"abc"}')]);
  const result = await readStdin(stream);
  assert.equal(result.session_id, "abc");
});

test("readStdin recovers from a raw control character breaking strict JSON", async () => {
  // A literal newline byte inside a string value is invalid per strict JSON.
  const raw = Buffer.from('{"a":"line one\nline two"}');
  const stream = Readable.from([raw]);
  const result = await readStdin(stream);
  assert.equal(result.a, "line oneline two");
});

test("readStdin returns {} for input that stays unparseable even after cleanup", async () => {
  const stream = Readable.from([Buffer.from("not json at all")]);
  const result = await readStdin(stream);
  assert.deepEqual(result, {});
});

test("readStdin returns {} for empty input", async () => {
  const stream = Readable.from([]);
  const result = await readStdin(stream);
  assert.deepEqual(result, {});
});

test("modelFromTranscript finds the newest assistant model in the tail", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "claude-eta-transcript-")), "t.jsonl");
  const lines = [
    JSON.stringify({ type: "user", message: { content: 'talking about "model":"decoy" in text' } }),
    JSON.stringify({ type: "assistant", message: { model: "claude-sonnet-5", content: [] } }),
    JSON.stringify({ type: "assistant", message: { model: "claude-fable-5", content: [] } }),
  ];
  fs.writeFileSync(file, lines.join("\n") + "\n");
  assert.equal(modelFromTranscript(file), "claude-fable-5");
});

test("modelFromTranscript is defensive about missing/garbage files", () => {
  assert.equal(modelFromTranscript(undefined), null);
  assert.equal(modelFromTranscript("/nonexistent/path.jsonl"), null);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "claude-eta-transcript-")), "bad.jsonl");
  fs.writeFileSync(file, "not json\nstill not json\n");
  assert.equal(modelFromTranscript(file), null);
});
