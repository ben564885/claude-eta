// Classify a tool call into one of the semi-Markov phases:
// explore -> edit -> test -> debug -> other
// "debug" is not chosen here directly by classify(); it is inferred by the
// caller (update.mjs) when issues pile up inside a test/explore phase.

const EXPLORE_TOOLS = new Set(["Read", "Grep", "Glob", "LS", "Search", "WebFetch", "WebSearch", "NotebookEdit"]);
const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

const RE_TEST_CMD = /\b(npm test|yarn test|pnpm test|jest|pytest|go test|cargo test|mvn test|rspec|ctest|make test|npm run build|yarn build|pnpm build|tsc\b|eslint|vitest)\b/i;

export function classify(tool, input = {}) {
  const name = tool ?? "";

  if (EDIT_TOOLS.has(name)) return "edit";
  if (EXPLORE_TOOLS.has(name)) return "explore";

  if (name === "Bash") {
    const cmd = String(input.command ?? "");
    if (RE_TEST_CMD.test(cmd)) return "test";
    return "explore";
  }

  return "other";
}

const RE_ISSUE_PATTERNS = [
  /\berrors?\b/i,
  /\bfailed\b|\bfailure(s)?\b/i,
  /\b\d+\s+tests?\s+failed\b/i,
  /\btraceback\b|\bexception\b|\bpanic\b/i,
];

export function countIssues(result) {
  const text = typeof result === "string" ? result : JSON.stringify(result ?? "");
  let count = 0;
  for (const re of RE_ISSUE_PATTERNS) {
    const matches = text.match(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"));
    if (matches) count += matches.length;
  }
  return Math.min(count, 5);
}
