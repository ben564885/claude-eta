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

export function extractFeatures(prompt, ctx = {}) {
  const text = typeof prompt === "string" ? prompt : "";
  const words = text.trim().split(/\s+/).filter(Boolean);
  const fileRefs = (text.match(RE_FILE_REF) || []).length;

  return {
    len_words: words.length,
    file_refs: fileRefs,
    heavy: RE_HEAVY.test(text),
    build: RE_BUILD.test(text),
    fix: RE_FIX.test(text),
    explain: RE_EXPLAIN.test(text),
    multi_step: RE_MULTI_STEP.test(text),
    model: normalizeModel(ctx.model),
    mode: normalizeMode(ctx.mode),
  };
}

function normalizeModel(model) {
  const m = String(model ?? "").toLowerCase();
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
