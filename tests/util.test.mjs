import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { fmt, sidOf, readStdin } from "../lib/util.mjs";

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
