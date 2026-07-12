// Pure data model for the dashboard: everything scripts/dashboard.mjs needs
// to render, with no HTML in it — so the numbers are testable on their own
// and the renderer can focus on presentation.

import { readHistory } from "./state.mjs";
import { describe } from "./calibration.mjs";
import { runBacktest, median } from "./backtest.mjs";
import { loadArtifacts } from "./train.mjs";
import { QREG_MIN_RUNS } from "./qreg.mjs";

export function buildReport() {
  const rows = readHistory();
  const cal = describe();
  const artifacts = loadArtifacts();
  const backtest = runBacktest(rows);

  const errors = rows
    .map((r) => ({ predicted: r.predicted_p50, actual: r.actual_sec }))
    .filter((e) => e.predicted > 0 && e.actual > 0)
    .map((e) => Math.abs(e.actual - e.predicted) / e.predicted);

  const banded = rows.filter((r) => r.predicted_p10 > 0 && r.predicted_p90 > 0 && r.actual_sec > 0);
  const covered = banded.filter((r) => r.predicted_p10 <= r.actual_sec && r.actual_sec <= r.predicted_p90);

  const scatter = rows
    .filter((r) => r.predicted_p50 > 0 && r.actual_sec > 0)
    .map((r, i) => ({
      index: i,
      predicted: r.predicted_p50,
      actual: r.actual_sec,
      p10: r.predicted_p10 ?? null,
      p90: r.predicted_p90 ?? null,
      // null = pre-v2 row, no band was logged to judge against
      inBand: r.predicted_p10 > 0 && r.predicted_p90 > 0 ? r.predicted_p10 <= r.actual_sec && r.actual_sec <= r.predicted_p90 : null,
    }));

  return {
    n: rows.length,
    medianErrPct: errors.length > 0 ? median(errors) * 100 : null,
    bandCoveragePct: banded.length > 0 ? (covered.length / banded.length) * 100 : null,
    bandedN: banded.length,
    calibration: cal,
    qreg: {
      active: !!artifacts?.qreg,
      n: artifacts?.qreg?.n ?? 0,
      minRuns: QREG_MIN_RUNS,
    },
    phaseMods: Object.entries(artifacts?.phase_mods ?? {})
      .filter(([, v]) => Math.abs(v - 1) > 0.01)
      .map(([phase, factor]) => ({ phase, factor })),
    backtest,
    scatter,
    recent: rows.slice(-10).map((r) => ({
      predicted: r.predicted_p50,
      p10: r.predicted_p10 ?? null,
      p90: r.predicted_p90 ?? null,
      actual: r.actual_sec,
    })),
  };
}
