import { test } from "node:test";
import assert from "node:assert/strict";
import { fitQreg, predictQuantiles, featureVector, QREG_MIN_RUNS } from "../lib/qreg.mjs";

function syntheticRows(n) {
  // Deterministic synthetic history: heavy prompts run ~4x longer than
  // explain prompts, with multiplicative "noise" from a fixed cycle.
  const noise = [0.7, 0.9, 1.0, 1.1, 1.5];
  const rows = [];
  for (let i = 0; i < n; i++) {
    const heavy = i % 2 === 0;
    const base = heavy ? 240 : 60;
    rows.push({
      actual_sec: Math.round(base * noise[i % noise.length]),
      features: {
        len_words: heavy ? 30 : 8,
        file_refs: heavy ? 2 : 0,
        heavy,
        explain: !heavy,
        model: "sonnet",
        mode: "normal",
      },
    });
  }
  return rows;
}

test("refuses to train below the minimum run count", () => {
  assert.equal(fitQreg(syntheticRows(QREG_MIN_RUNS - 1)), null);
  assert.equal(fitQreg([]), null);
});

test("learns the heavy-vs-light distinction from history", () => {
  const model = fitQreg(syntheticRows(100));
  assert.ok(model, "expected a trained model");
  const heavy = predictQuantiles(model, syntheticRows(2)[0].features);
  const light = predictQuantiles(model, syntheticRows(2)[1].features);
  assert.ok(
    heavy.p50 > light.p50 * 2,
    `expected heavy >> light, got heavy=${heavy.p50} light=${light.p50}`
  );
  // And the medians should be in the right neighborhood, not just ordered.
  assert.ok(heavy.p50 > 120 && heavy.p50 < 480, `heavy p50 off: ${heavy.p50}`);
  assert.ok(light.p50 > 30 && light.p50 < 120, `light p50 off: ${light.p50}`);
});

test("quantiles come out ordered with a positive sigma", () => {
  const model = fitQreg(syntheticRows(80));
  const q = predictQuantiles(model, { len_words: 15, file_refs: 1, model: "opus", mode: "thinking" });
  assert.ok(q.p10 <= q.p50 && q.p50 <= q.p90);
  assert.ok(q.p10 >= 1);
  assert.ok(q.sigma > 0);
});

test("training is deterministic", () => {
  const a = fitQreg(syntheticRows(60));
  const b = fitQreg(syntheticRows(60));
  assert.deepEqual(a, b);
});

test("feature vector handles missing fields without NaN", () => {
  const x = featureVector({});
  assert.ok(x.every((v) => Number.isFinite(v)));
});
