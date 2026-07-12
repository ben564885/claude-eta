// Renders the report data model (lib/report.mjs) to a single self-contained
// HTML string: inline CSS, inline SVG, a small vanilla-JS hover layer, no
// external requests of any kind. Kept separate from scripts/dashboard.mjs so
// the render function is testable without touching the filesystem or a
// browser.
//
// Palette: the gstack dataviz skill's validated default instance
// (references/palette.md) — diverging blue/red for calibration bias (a
// measure with a real zero point: 1.0x, "no correction"), the status pair
// (good/critical) for scatter in-band/out-of-band, and a single accent hue
// (blue, slot 1) + de-emphasis gray for the v1-vs-v2 backtest comparison
// (the story is "v2 improved on v1", which is the emphasis pattern, not a
// multi-series categorical one). Both palette pairs were run through
// validate_palette.js — see DECISIONS.md.

import { fmt } from "./util.mjs";

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function fmtFactor(x) {
  return `${x.toFixed(2)}x`;
}

function fmtPct(x) {
  return x === null || x === undefined ? "—" : `${x.toFixed(0)}%`;
}

// ---- stat tiles ----

function statTile(label, value, sub) {
  return `<div class="tile">
    <div class="tile-label">${esc(label)}</div>
    <div class="tile-value">${esc(value)}</div>
    ${sub ? `<div class="tile-sub">${esc(sub)}</div>` : ""}
  </div>`;
}

function renderStatTiles(report) {
  const coverageSub =
    report.bandCoveragePct === null
      ? "no banded runs logged yet"
      : `target ~80% · ${report.bandedN} run${report.bandedN === 1 ? "" : "s"}`;
  const qregSub = report.qreg.active
    ? `trained on ${report.qreg.n} runs`
    : `activates at ${report.qreg.minRuns} runs (${report.n} logged)`;

  return `<div class="tiles">
    ${statTile("Runs logged", report.n)}
    ${statTile("Median error", fmtPct(report.medianErrPct))}
    ${statTile("Band coverage", fmtPct(report.bandCoveragePct), coverageSub)}
    ${statTile("Trained model", report.qreg.active ? "quantile regression" : "heuristic + Bayesian", qregSub)}
  </div>`;
}

// ---- diverging bucket-calibration bars ----

function renderCalibrationChart(report) {
  const buckets = report.calibration.buckets;
  if (buckets.length === 0) {
    return `<section class="card">
      <h2>Calibration by model:mode bucket</h2>
      <p class="empty">No bucket data yet — every finished run adds one.</p>
    </section>`;
  }

  const W = 640;
  const rowH = 30;
  const padTop = 8;
  // Fixed name column + a reserved label gutter on each side of the diverging
  // zero-line, so a bar's own value label can never collide with the row's
  // name text — the bar length is capped to the gutter-adjusted half-span,
  // not the raw midpoint, so the worst-case (largest |log bias|) bucket's
  // label lands exactly at the gutter edge, never past it.
  const nameColW = 172;
  const labelGutter = 92;
  const rightEdge = W - 16;
  const midX = nameColW + labelGutter + (rightEdge - nameColW - 2 * labelGutter) / 2;
  const halfSpan = Math.max(20, midX - (nameColW + labelGutter));
  const maxLogAbs = Math.max(0.15, ...buckets.map((b) => Math.abs(Math.log(b.factor))));
  const scaleX = halfSpan / maxLogAbs;

  const bars = buckets
    .map((b, i) => {
      const y = padTop + i * rowH;
      const logBias = Math.log(b.factor);
      const barLen = Math.min(halfSpan, Math.abs(logBias) * scaleX);
      const isHigh = logBias >= 0;
      const x = isHigh ? midX + 2 : midX - 2 - barLen;
      const w = Math.max(1, barLen - 2);
      const cls = isHigh ? "bar-high" : "bar-low";
      const labelX = isHigh ? midX + 2 + barLen + 8 : midX - 2 - barLen - 8;
      const anchor = isHigh ? "start" : "end";
      return `<g class="bucket-row" data-tip="${esc(b.key)}: ${esc(fmtFactor(b.factor))} (n=${b.n})">
        <text x="8" y="${y + 13}" class="bar-name">${esc(b.key)}</text>
        <rect x="${x.toFixed(1)}" y="${y}" width="${w.toFixed(1)}" height="18" rx="4" class="${cls}" />
        <text x="${labelX.toFixed(1)}" y="${y + 13}" text-anchor="${anchor}" class="bar-value">${esc(fmtFactor(b.factor))} (n=${b.n})</text>
      </g>`;
    })
    .join("\n");

  const H = padTop + buckets.length * rowH + 8;
  const hasUnknown = buckets.some((b) => b.key.startsWith("unknown:"));

  return `<section class="card">
    <h2>Calibration by model:mode bucket</h2>
    <p class="caption">How much each bucket's estimate is scaled before showing you a range. <span class="key key-low">◀ below 1x</span> means runs came in faster than the raw heuristic guessed; <span class="key key-high">above 1x ▶</span> means slower.
      ${hasUnknown ? " An <code>unknown:</code> bucket predates the model-tag fix (see CHANGELOG) — it's stale, harmless clutter, not a live correction." : ""}</p>
    <div class="chart-wrap">
      <svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Calibration bias factor per bucket, diverging around 1x">
        <line x1="${midX}" y1="0" x2="${midX}" y2="${H}" class="baseline" />
        ${bars}
      </svg>
    </div>
    <details class="table-view">
      <summary>Table view</summary>
      <table>
        <thead><tr><th>Bucket</th><th>Factor</th><th>Runs</th></tr></thead>
        <tbody>
          ${buckets.map((b) => `<tr><td>${esc(b.key)}</td><td>${esc(fmtFactor(b.factor))}</td><td>${b.n}</td></tr>`).join("\n")}
        </tbody>
      </table>
    </details>
  </section>`;
}

// ---- v1 vs v2 backtest comparison (emphasis: v1 gray context, v2 accent) ----

function renderBacktestChart(report) {
  const bt = report.backtest;
  if (!bt) {
    return `<section class="card">
      <h2>v1 vs v2 backtest</h2>
      <p class="empty">Need at least 2 completed runs to backtest.</p>
    </section>`;
  }

  const metrics = [
    { key: "pinball", label: "Pinball loss (lower better)", v1: bt.v1.pinball, v2: bt.v2.pinball, fmt: (x) => x.toFixed(1) },
    { key: "coverage", label: "Band coverage (target ~80%)", v1: bt.v1.coveragePct, v2: bt.v2.coveragePct, fmt: (x) => `${x.toFixed(0)}%`, target: 80 },
    { key: "err", label: "Median |error| (lower better)", v1: bt.v1.medianErrPct, v2: bt.v2.medianErrPct, fmt: (x) => `${x.toFixed(0)}%` },
  ];

  const W = 640;
  const groupH = 64;
  const barH = 20;
  const gap = 4;
  const padLeft = 210;
  const plotW = W - padLeft - 60;

  // Each metric gets its OWN x-scale (small multiples, not one shared axis) —
  // pinball loss (seconds, ~10s magnitude) and the two percentage metrics
  // (0-100 range) are different units entirely. A shared scale would squash
  // the pinball-loss bars next to the percentage ones, understating v2's
  // actual improvement on it — the same failure mode as a dual-axis chart.
  const groups = metrics
    .map((m, i) => {
      const y = i * groupH;
      const maxVal = Math.max(m.v1, m.v2, m.target ?? 0) * 1.15 || 1;
      const scaleX = plotW / maxVal;
      const v1w = Math.max(1, m.v1 * scaleX);
      const v2w = Math.max(1, m.v2 * scaleX);
      const targetLine =
        m.target !== undefined
          ? `<line x1="${(padLeft + m.target * scaleX).toFixed(1)}" y1="${y}" x2="${(padLeft + m.target * scaleX).toFixed(1)}" y2="${y + barH * 2 + gap}" class="target-line" />
             <text x="${(padLeft + m.target * scaleX).toFixed(1)}" y="${y - 4}" class="target-label" text-anchor="middle">target ${m.target}%</text>`
          : "";
      return `<g class="metric-group">
        <text x="0" y="${y + barH + gap / 2 + 4}" class="metric-label">${esc(m.label)}</text>
        ${targetLine}
        <g data-tip="v1 frozen heuristic: ${esc(m.fmt(m.v1))}">
          <rect x="${padLeft}" y="${y}" width="${v1w.toFixed(1)}" height="${barH}" rx="4" class="bar-v1" />
          <text x="${(padLeft + v1w + 6).toFixed(1)}" y="${y + barH - 6}" class="bar-value">${esc(m.fmt(m.v1))}</text>
        </g>
        <g data-tip="v2 learned pipeline: ${esc(m.fmt(m.v2))}">
          <rect x="${padLeft}" y="${y + barH + gap}" width="${v2w.toFixed(1)}" height="${barH}" rx="4" class="bar-v2" />
          <text x="${(padLeft + v2w + 6).toFixed(1)}" y="${y + barH + gap + barH - 6}" class="bar-value">${esc(m.fmt(m.v2))}</text>
        </g>
      </g>`;
    })
    .join("\n");

  const H = metrics.length * groupH + 10;

  return `<section class="card">
    <h2>v1 (frozen) vs v2 (learned) — replayed on your own history</h2>
    <p class="caption">${bt.n} run${bt.n === 1 ? "" : "s"} replayed chronologically, training only on runs before each prediction.
      ${bt.qregUsed > 0 ? `Quantile regression predicted ${bt.qregUsed}/${bt.n} of them.` : "Quantile regression hasn't activated yet — v2 ran on Bayesian-calibrated heuristics throughout."}
      ${bt.n < 30 ? " Small sample — treat the gap as directional, not exact." : ""}
      Each metric has its own scale (seconds vs. percent) — compare v1 to v2 within a row, not bar length across rows.</p>
    <div class="legend">
      <span class="key key-v1">v1 frozen heuristic</span>
      <span class="key key-v2">v2 learned pipeline</span>
    </div>
    <div class="chart-wrap">
      <svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="v1 versus v2 backtest metrics">
        ${groups}
      </svg>
    </div>
    <details class="table-view">
      <summary>Table view</summary>
      <table>
        <thead><tr><th>Metric</th><th>v1</th><th>v2</th></tr></thead>
        <tbody>
          ${metrics.map((m) => `<tr><td>${esc(m.label)}</td><td>${esc(m.fmt(m.v1))}</td><td>${esc(m.fmt(m.v2))}</td></tr>`).join("\n")}
        </tbody>
      </table>
    </details>
  </section>`;
}

// ---- predicted vs actual scatter (log-log, status-colored by band hit) ----

function renderScatterChart(report) {
  const points = report.scatter;
  if (points.length === 0) {
    return `<section class="card">
      <h2>Predicted vs actual</h2>
      <p class="empty">No runs logged yet.</p>
    </section>`;
  }

  const W = 640;
  const H = 420;
  const pad = 48;
  const allVals = points.flatMap((p) => [p.predicted, p.actual]);
  const lo = Math.max(1, Math.min(...allVals) * 0.7);
  const hi = Math.max(...allVals) * 1.4;
  const logLo = Math.log(lo);
  const logHi = Math.log(hi);

  const sx = (v) => pad + ((Math.log(v) - logLo) / (logHi - logLo)) * (W - pad - 16);
  const sy = (v) => H - pad - ((Math.log(v) - logLo) / (logHi - logLo)) * (H - pad - 16);

  const ticks = [5, 30, 60, 300, 900, 1800, 3600, 7200].filter((t) => t >= lo && t <= hi);

  const gridlines = ticks
    .map(
      (t) => `<line x1="${sx(t).toFixed(1)}" y1="${pad - 8}" x2="${sx(t).toFixed(1)}" y2="${H - pad}" class="gridline" />
      <line x1="${pad - 8}" y1="${sy(t).toFixed(1)}" x2="${W - 16}" y2="${sy(t).toFixed(1)}" class="gridline" />
      <text x="${sx(t).toFixed(1)}" y="${H - pad + 16}" class="axis-label" text-anchor="middle">${esc(fmt(t))}</text>
      <text x="${pad - 12}" y="${(sy(t) + 4).toFixed(1)}" class="axis-label" text-anchor="end">${esc(fmt(t))}</text>`
    )
    .join("\n");

  const diagLine = `<line x1="${sx(lo).toFixed(1)}" y1="${sy(lo).toFixed(1)}" x2="${sx(hi).toFixed(1)}" y2="${sy(hi).toFixed(1)}" class="diagonal" />
    <text x="${sx(hi).toFixed(1)}" y="${(sy(hi) - 6).toFixed(1)}" class="diagonal-label" text-anchor="end">perfect calibration</text>`;

  const dots = points
    .map((p) => {
      const cls = p.inBand === null ? "dot-nodata" : p.inBand ? "dot-good" : "dot-critical";
      const tip =
        p.inBand === null
          ? `predicted ${fmt(p.predicted)}, actual ${fmt(p.actual)} (no band logged)`
          : `predicted ${fmt(p.predicted)} [${fmt(p.p10)}–${fmt(p.p90)}], actual ${fmt(p.actual)} — ${p.inBand ? "in band" : "missed band"}`;
      return `<circle cx="${sx(p.actual).toFixed(1)}" cy="${sy(p.predicted).toFixed(1)}" r="5" class="${cls}" data-tip="${esc(tip)}">
        <title>${esc(tip)}</title>
      </circle>`;
    })
    .join("\n");

  const hasNoData = points.some((p) => p.inBand === null);
  const hasBand = points.some((p) => p.inBand !== null);

  return `<section class="card">
    <h2>Predicted vs actual (log scale)</h2>
    <p class="caption">Each dot is one run. Above the diagonal: claude-eta overestimated. Below: underestimated. Color shows whether the run landed inside its own p10–p90 band.</p>
    <div class="legend">
      ${hasBand ? '<span class="key key-good">within band</span><span class="key key-critical">missed band</span>' : ""}
      ${hasNoData ? '<span class="key key-nodata">no band logged (pre-v2)</span>' : ""}
    </div>
    <div class="chart-wrap">
      <svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Predicted versus actual run duration, log scale">
        ${gridlines}
        ${diagLine}
        <text x="${(W / 2).toFixed(1)}" y="${H - 8}" class="axis-title" text-anchor="middle">actual duration</text>
        <text x="14" y="${(H / 2).toFixed(1)}" class="axis-title" text-anchor="middle" transform="rotate(-90 14 ${(H / 2).toFixed(1)})">predicted p50</text>
        ${dots}
      </svg>
    </div>
    <details class="table-view">
      <summary>Table view</summary>
      <table>
        <thead><tr><th>#</th><th>Predicted</th><th>Band</th><th>Actual</th><th>Result</th></tr></thead>
        <tbody>
          ${points
            .map(
              (p) =>
                `<tr><td>${p.index + 1}</td><td>${esc(fmt(p.predicted))}</td><td>${p.p10 !== null ? `${esc(fmt(p.p10))}–${esc(fmt(p.p90))}` : "—"}</td><td>${esc(fmt(p.actual))}</td><td>${p.inBand === null ? "—" : p.inBand ? "in band" : "missed"}</td></tr>`
            )
            .join("\n")}
        </tbody>
      </table>
    </details>
  </section>`;
}

function renderPhaseMods(report) {
  if (report.phaseMods.length === 0) return "";
  return `<p class="phase-mods">Learned phase modifiers: ${report.phaseMods
    .map((m) => `<strong>${esc(m.phase)}</strong> ${esc(fmtFactor(m.factor))}`)
    .join(" · ")}</p>`;
}

export function renderDashboardHTML(report) {
  const generated = new Date().toISOString();
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>claude-eta — training dashboard</title>
<style>
  :root {
    --surface-1: #fcfcfb;
    --page: #f9f9f7;
    --ink: #0b0b0b;
    --ink-secondary: #52514e;
    --ink-muted: #898781;
    --gridline: #e1e0d9;
    --baseline: #c3c2b7;
    --border: rgba(11,11,11,0.10);

    --blue: #2a78d6;
    --red: #e34948;
    --gray-fill: #c3c2b7;
    --good: #0ca30c;
    --critical: #d03b3b;
    --nodata: #898781;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --surface-1: #1a1a19;
      --page: #0d0d0d;
      --ink: #ffffff;
      --ink-secondary: #c3c2b7;
      --ink-muted: #898781;
      --gridline: #2c2c2a;
      --baseline: #383835;
      --border: rgba(255,255,255,0.10);

      --blue: #3987e5;
      --red: #e66767;
      --gray-fill: #383835;
      --good: #0ca30c;
      --critical: #d03b3b;
      --nodata: #6f6f66;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--page);
    color: var(--ink);
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    line-height: 1.5;
  }
  main { max-width: 720px; margin: 0 auto; padding: 32px 20px 64px; }
  h1 { font-size: 1.4rem; margin: 0 0 4px; }
  .subtitle { color: var(--ink-muted); font-size: 0.85rem; margin: 0 0 28px; }
  h2 { font-size: 1rem; margin: 0 0 6px; }
  .card {
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 20px;
    margin-bottom: 20px;
  }
  .caption { color: var(--ink-secondary); font-size: 0.85rem; margin: 0 0 14px; }
  .empty { color: var(--ink-muted); font-size: 0.9rem; }
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-bottom: 20px; }
  .tile { background: var(--surface-1); border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; }
  .tile-label { font-size: 0.75rem; color: var(--ink-muted); margin-bottom: 4px; }
  .tile-value { font-size: 1.6rem; font-weight: 600; }
  .tile-sub { font-size: 0.72rem; color: var(--ink-muted); margin-top: 2px; }
  .chart-wrap { width: 100%; overflow-x: auto; }
  .chart { width: 100%; height: auto; display: block; }
  .legend { display: flex; gap: 16px; flex-wrap: wrap; font-size: 0.8rem; color: var(--ink-secondary); margin-bottom: 10px; }
  .key { position: relative; padding-left: 16px; }
  .key::before { content: ""; position: absolute; left: 0; top: 50%; transform: translateY(-50%); width: 10px; height: 10px; border-radius: 3px; }
  .key-low::before, .key-v1::before { background: var(--gray-fill); }
  .key-high::before, .key-v2::before { background: var(--blue); }
  .key-good::before { background: var(--good); }
  .key-critical::before { background: var(--critical); }
  .key-nodata::before { background: var(--nodata); }
  .bar-high { fill: var(--blue); }
  .bar-low { fill: var(--red); }
  .bar-v1 { fill: var(--gray-fill); }
  .bar-v2 { fill: var(--blue); }
  .bar-name { fill: var(--ink-secondary); font-size: 12px; dominant-baseline: middle; }
  .bar-value { fill: var(--ink-secondary); font-size: 12px; dominant-baseline: middle; }
  .metric-label { fill: var(--ink-secondary); font-size: 12px; }
  .baseline { stroke: var(--baseline); stroke-width: 1; }
  .target-line { stroke: var(--ink-muted); stroke-width: 1; }
  .target-label { fill: var(--ink-muted); font-size: 10px; }
  .gridline { stroke: var(--gridline); stroke-width: 1; }
  .axis-label { fill: var(--ink-muted); font-size: 10px; }
  .axis-title { fill: var(--ink-secondary); font-size: 11px; }
  .diagonal { stroke: var(--baseline); stroke-width: 1; }
  .diagonal-label { fill: var(--ink-muted); font-size: 10px; }
  .dot-good { fill: var(--good); }
  .dot-critical { fill: var(--critical); }
  .dot-nodata { fill: var(--nodata); }
  circle { cursor: pointer; }
  .bucket-row rect, .metric-group rect, circle { transition: opacity 0.1s; }
  .bucket-row:hover rect, .metric-group g:hover rect, circle:hover { opacity: 0.75; }
  .phase-mods { font-size: 0.85rem; color: var(--ink-secondary); }
  details.table-view { margin-top: 14px; }
  details.table-view summary { cursor: pointer; font-size: 0.8rem; color: var(--ink-muted); }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 0.82rem; }
  th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--gridline); }
  th { color: var(--ink-muted); font-weight: 500; }
  td:not(:first-child), th:not(:first-child) { font-variant-numeric: tabular-nums; }
  footer { color: var(--ink-muted); font-size: 0.75rem; margin-top: 8px; }
  #tooltip {
    position: fixed; pointer-events: none; z-index: 10;
    background: var(--ink); color: var(--surface-1);
    font-size: 0.78rem; padding: 6px 10px; border-radius: 6px;
    max-width: 280px; opacity: 0; transition: opacity 0.08s;
  }
</style>
</head>
<main>
  <h1>claude-eta — training dashboard</h1>
  <p class="subtitle">Generated ${esc(generated)} from your local ~/.claude/eta/ data. Nothing here left your machine.</p>

  ${renderStatTiles(report)}
  ${renderCalibrationChart(report)}
  ${renderPhaseMods(report)}
  ${renderBacktestChart(report)}
  ${renderScatterChart(report)}

  <footer>Regenerate any time: node "$CLAUDE_PLUGIN_ROOT/scripts/dashboard.mjs" (or /eta-dashboard).</footer>
</main>
<div id="tooltip"></div>
<script>
(function () {
  var tip = document.getElementById("tooltip");
  document.querySelectorAll("[data-tip]").forEach(function (el) {
    el.addEventListener("pointermove", function (e) {
      tip.textContent = el.getAttribute("data-tip");
      tip.style.left = (e.clientX + 14) + "px";
      tip.style.top = (e.clientY + 14) + "px";
      tip.style.opacity = "1";
    });
    el.addEventListener("pointerleave", function () {
      tip.style.opacity = "0";
    });
  });
})();
</script>
</html>`;
}
