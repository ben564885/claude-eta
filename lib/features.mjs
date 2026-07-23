// Extract a compact feature vector from the submitted prompt + hook context.
// Nothing here keys off model *size* — only observable proxies (model family,
// mode) that actually shape the output-length distribution.

const RE_HEAVY = /\b(refactor|rewrite|migrate|redesign|overhaul|port)\b/i;
const RE_BUILD = /\b(add|implement|build|create|write|generate)\b/i;
const RE_FIX = /\b(fix|bug|error|debug|patch)\b/i;
const RE_EXPLAIN = /\b(explain|what|why|how|describe|summar\w*)\b/i;
const RE_MULTI_STEP = /\b(then|after that|next,|step \d|and then|followed by)\b/i;

// File-path-looking tokens (has a slash or a dot-extension) and @mentions.
const RE_FILE_REF = /(@\S+)|(\b[\w.-]+\/[\w./-]+\b)|(\b[\w-]+\.\w{1,5}\b)/g;

// Crude proxy for how many distinct subtasks a prompt is asking for — a
// bag-of-verbs count, not a parse. Counts occurrences, not just presence.
const RE_IMPERATIVE_VERB =
  /\b(add|fix|remove|delete|update|create|build|implement|refactor|rewrite|rename|move|write|generate|change|check|verify|ensure|make|run|test|debug|investigate|migrate|configure|install|deploy|revert|undo)\b/gi;

export function extractFeatures(prompt, ctx = {}) {
  const text = typeof prompt === "string" ? prompt : "";
  const words = text.trim().split(/\s+/).filter(Boolean);
  const fileRefs = (text.match(RE_FILE_REF) || []).length;
  const imperativeVerbs = (text.match(RE_IMPERATIVE_VERB) || []).length;

  return {
    len_words: words.length,
    file_refs: fileRefs,
    imperative_verbs: imperativeVerbs,
    heavy: RE_HEAVY.test(text),
    build: RE_BUILD.test(text),
    fix: RE_FIX.test(text),
    explain: RE_EXPLAIN.test(text),
    multi_step: RE_MULTI_STEP.test(text),
    model: normalizeModel(ctx.model),
    mode: normalizeMode(ctx.mode),
  };
}

export function normalizeModel(model) {
  const m = String(model ?? "").toLowerCase();
  if (m.includes("fable") || m.includes("mythos")) return "fable";
  if (m.includes("opus")) return "opus";
  if (m.includes("sonnet")) return "sonnet";
  if (m.includes("haiku")) return "haiku";
  return "unknown";
}

function normalizeMode(mode) {
  const m = String(mode ?? "").toLowerCase();
  if (m.includes("plan")) return "plan";
  if (m.includes("think")) return "thinking";
  return "normal";
}
