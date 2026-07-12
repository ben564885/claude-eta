// v2 estimator. Same two entry points as v1 (estimateInitial, revise), new
// internals:
//
//   estimateInitial — quantile regression trained on your own history once
//     it's deep enough (QREG_MIN_RUNS), else the v1 heuristic corrected by
//     the hierarchical Bayesian calibration, with the band width coming from
//     the calibration posterior instead of a hardcoded constant.
//
//   revise — lognormal survival update: quantiles of total duration
//     conditioned on the run still going at `elapsed`, with the location
//     shifted by observed issues and by phase modifiers learned from
//     history. Expected remaining time grows in the tail, as it should for
//     heavy-tailed runs — no more snapping toward a floor.
//
// Both accept an optional `deps` argument ({stats, artifacts}) so
// scripts/backtest.mjs can inject replayed state instead of reading files.

import { getBiasFactor, getPredictiveSigma, biasOf, sigmaOf } from "./calibration.mjs";
import { predictQuantiles, QREG_MIN_RUNS } from "./qreg.mjs";
import { conditionalBand, DEFAULT_PHASE_MODS } from "./survival.mjs";
import { loadArtifacts } from "./train.mjs";

const BASE_SEC = 40; // baseline single-turn cost with no signal either way
export const SIGMA_PRIOR = 0.75; // log-space std dev fallback when nothing is learned yet
const SIGMA_FLOOR = 0.15; // runs are heavy-tailed; band never collapses to a point
const Z10 = 1.2816; // standard-normal z for the 10th/90th percentile

// Condition on model FAMILY + MODE, not size: output-length distribution is
// shaped by post-training / system prompt, not parameter count.
function modelFactor(model) {
  switch (model) {
    case "fable":
      return 1.2;
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

export function band(p50, sigma) {
  return {
    p10: Math.round(p50 * Math.exp(-Z10 * sigma)),
    p50: Math.round(p50),
    p90: Math.round(p50 * Math.exp(Z10 * sigma)),
    sigma,
  };
}

// The uncalibrated v1 heuristic — kept as the cold-start prior and as the
// frozen baseline the backtester scores v2 against.
export function heuristicP50(features) {
  const lenTerm = Math.sqrt(Math.max(0, features.len_words ?? 0)) * 3;
  const fileTerm = (features.file_refs ?? 0) * 12;
  const raw = BASE_SEC + lenTerm + fileTerm;
  return raw * flagFactor(features) * modelFactor(features.model) * modeFactor(features.mode);
}

export function estimateInitial(features, deps = {}) {
  const artifacts = deps.artifacts !== undefined ? deps.artifacts : loadArtifacts();
  if (artifacts?.qreg && artifacts.qreg.n >= QREG_MIN_RUNS) {
    // Trained on actuals directly — no bias factor on top (double-correction).
    return predictQuantiles(artifacts.qreg, features);
  }

  const bias = deps.stats ? Math.exp(biasOf(deps.stats, features)) : getBiasFactor(features);
  const sigma = deps.stats ? sigmaOf(deps.stats, features) : getPredictiveSigma(features);
  return band(heuristicP50(features) * bias, sigma);
}

// Issues push the whole-run size estimate up; capped so a pathological run
// can't inflate the countdown without bound.
function issueFactor(state) {
  return 1 + 0.1 * Math.min(state.issues ?? 0, 10);
}

export function revise(state, deps = {}) {
  const artifacts = deps.artifacts !== undefined ? deps.artifacts : loadArtifacts();
  const phaseMods = artifacts?.phase_mods ?? DEFAULT_PHASE_MODS;

  const elapsedSec = Math.max(0, (Date.now() - state.t_start) / 1000);
  const prior = state.p50_prior ?? elapsedSec + BASE_SEC;
  const phaseFactor = phaseMods[state.phase] ?? 1;
  const mu = Math.log(Math.max(1, prior * issueFactor(state) * phaseFactor));

  // Every observed tool call narrows the band a little.
  const sigma0 = state.sigma_prior ?? SIGMA_PRIOR;
  const toolsObserved = state.tools ?? 0;
  const sigma = Math.max(SIGMA_FLOOR, sigma0 / (1 + 0.1 * toolsObserved));

  return conditionalBand(mu, sigma, elapsedSec);
}
