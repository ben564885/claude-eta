// v2: replace this file only — train on ~/.claude/eta/history.jsonl, do real
// Bayesian updating over the semi-Markov phases. Signatures stay identical:
//   estimateInitial(features) -> {p10,p50,p90}
//   revise(state)             -> {p10,p50,p90}

const BASE_SEC = 40; // baseline single-turn cost with no signal either way
const SIGMA_PRIOR = 0.75; // log-space std dev at t=0: wide, we know almost nothing
const SIGMA_FLOOR = 0.15; // runs are heavy-tailed; band never collapses to a point
const Z10 = 1.2816; // standard-normal z for the 10th/90th percentile

// Condition on model FAMILY + MODE, not size: output-length distribution is
// shaped by post-training / system prompt, not parameter count.
function modelFactor(model) {
  switch (model) {
    case "opus":
      return 1.35;
    case "sonnet":
      return 1.0;
    case "haiku":
      return 0.7;
    default:
      return 1.0;
  }
}

function modeFactor(mode) {
  switch (mode) {
    case "plan":
      return 0.6;
    case "thinking":
      return 1.4;
    default:
      return 1.0;
  }
}

function flagFactor(features) {
  let f = 1;
  if (features.heavy) f *= 1.8;
  if (features.build) f *= 1.3;
  if (features.fix) f *= 1.2;
  if (features.explain) f *= 0.6;
  if (features.multi_step) f *= 1.4;
  return f;
}

function band(p50, sigma) {
  const p10 = p50 * Math.exp(-Z10 * sigma);
  const p90 = p50 * Math.exp(Z10 * sigma);
  return {
    p10: Math.round(p10),
    p50: Math.round(p50),
    p90: Math.round(p90),
  };
}

export function estimateInitial(features) {
  const lenTerm = Math.sqrt(Math.max(0, features.len_words ?? 0)) * 3;
  const fileTerm = (features.file_refs ?? 0) * 12;
  const raw = BASE_SEC + lenTerm + fileTerm;

  const p50 =
    raw *
    flagFactor(features) *
    modelFactor(features.model) *
    modeFactor(features.mode);

  return band(p50, SIGMA_PRIOR);
}

// Evidence grows the *remaining* work estimate when the run hits traffic:
// errors surfacing, or time spent in test/debug phases.
function evidenceFactor(state) {
  const issues = state.issues ?? 0;
  let factor = 1 + 0.15 * issues;
  if (state.phase === "test" || state.phase === "debug") factor *= 1.25;
  return factor;
}

export function revise(state) {
  const elapsedSec = Math.max(0, (Date.now() - state.t_start) / 1000);
  const prior = state.p50_prior ?? elapsedSec + BASE_SEC;

  // Floor the remaining budget at 10% of the original prior so a long run
  // doesn't snap straight to zero remaining right as it's still working.
  const baseRemaining = Math.max(prior - elapsedSec, prior * 0.1);
  const remaining = baseRemaining * evidenceFactor(state);

  const toolsObserved = state.tools ?? 0;
  const sigma = Math.max(SIGMA_FLOOR, SIGMA_PRIOR / (1 + 0.15 * toolsObserved));

  const p50 = elapsedSec + remaining;
  const remLow = remaining * Math.exp(-Z10 * sigma);
  const remHigh = remaining * Math.exp(Z10 * sigma);

  return {
    p10: Math.round(elapsedSec + remLow),
    p50: Math.round(p50),
    p90: Math.round(elapsedSec + remHigh),
  };
}
