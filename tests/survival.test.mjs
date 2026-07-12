import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normCdf,
  normInv,
  conditionalQuantile,
  conditionalBand,
  fitPhaseMods,
  DEFAULT_PHASE_MODS,
} from "../lib/survival.mjs";

test("normCdf/normInv are consistent inverses at standard points", () => {
  assert.ok(Math.abs(normCdf(0) - 0.5) < 1e-6);
  assert.ok(Math.abs(normCdf(1.2816) - 0.9) < 1e-4);
  for (const p of [0.05, 0.1, 0.5, 0.9, 0.95]) {
    assert.ok(Math.abs(normCdf(normInv(p)) - p) < 1e-6, `roundtrip failed at p=${p}`);
  }
});

test("unconditional quantiles reproduce the lognormal prior", () => {
  const mu = Math.log(100);
  const sigma = 0.5;
  assert.ok(Math.abs(conditionalQuantile(mu, sigma, 0, 0.5) - 100) < 1);
});

test("expected total grows once the run outlives its median (the Lindy effect)", () => {
  const mu = Math.log(60);
  const sigma = 0.75;
  // At 3x the median, the conditional median total must exceed elapsed and
  // keep a meaningful remaining budget — v1's "snap to a 10% floor" bug.
  const p50 = conditionalQuantile(mu, sigma, 180, 0.5);
  assert.ok(p50 > 180, `conditional p50 must exceed elapsed, got ${p50}`);
  assert.ok(p50 - 180 > 10, `expected meaningful remaining time deep in the tail, got ${p50 - 180}s`);
  // And it must be monotone in elapsed: further in, larger total.
  const later = conditionalQuantile(mu, sigma, 300, 0.5);
  assert.ok(later > p50);
});

test("conditional band is ordered and never predicts finishing in the past", () => {
  const { p10, p50, p90 } = conditionalBand(Math.log(50), 0.6, 120);
  assert.ok(p10 >= 120);
  assert.ok(p10 <= p50 && p50 <= p90);
});

test("band stays finite even absurdly deep in the tail", () => {
  const { p90 } = conditionalBand(Math.log(30), 0.3, 3600);
  assert.ok(Number.isFinite(p90));
  assert.ok(p90 < 3600 * 50, `tail cap should keep the band sane, got ${p90}`);
});

test("fitPhaseMods returns defaults when history is thin", () => {
  assert.deepEqual(fitPhaseMods([]), DEFAULT_PHASE_MODS);
  assert.deepEqual(fitPhaseMods(undefined), DEFAULT_PHASE_MODS);
});

test("fitPhaseMods learns that debug-featuring runs take longer", () => {
  const rows = [];
  // 10 quick runs that never leave explore, 8 long runs dominated by debug.
  for (let i = 0; i < 10; i++) {
    rows.push({ actual_sec: 20 + i, phase_times: { explore: (20 + i) * 1000 } });
  }
  for (let i = 0; i < 8; i++) {
    rows.push({
      actual_sec: 200 + i * 10,
      phase_times: { explore: 20_000, debug: (180 + i * 10) * 1000 },
    });
  }
  const mods = fitPhaseMods(rows);
  assert.ok(mods.debug > 1.5, `expected a strong debug modifier, got ${mods.debug}`);
  assert.ok(mods.debug <= 3, "modifier must respect the cap");
  assert.ok(mods.explore < mods.debug);
});
