import { test } from "node:test";
import assert from "node:assert/strict";
import { classify, countIssues, PHASE_LABELS } from "../lib/phases.mjs";

test("classify maps known tools to phases", () => {
  assert.equal(classify("Read"), "explore");
  assert.equal(classify("Grep"), "explore");
  assert.equal(classify("Edit"), "edit");
  assert.equal(classify("Write"), "edit");
  assert.equal(classify("Bash", { command: "npm test" }), "test");
  assert.equal(classify("Bash", { command: "pytest -k foo" }), "test");
  assert.equal(classify("Bash", { command: "ls -la" }), "explore");
  assert.equal(classify("SomeUnknownTool"), "other");
});

test("countIssues counts and caps at 5", () => {
  assert.equal(countIssues("all good, no problems"), 0);
  assert.equal(countIssues("1 error occurred"), 1);
  const many = "error error error error error error error error";
  assert.equal(countIssues(many), 5);
});

test("countIssues handles non-string results", () => {
  assert.equal(countIssues({ ok: true }), 0);
  assert.equal(countIssues(undefined), 0);
});

test("PHASE_LABELS covers every phase classify()/update.mjs can produce", () => {
  for (const phase of ["explore", "edit", "test", "debug", "other"]) {
    assert.ok(PHASE_LABELS[phase], `missing label for phase "${phase}"`);
  }
});
