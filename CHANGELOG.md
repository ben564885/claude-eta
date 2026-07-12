# Changelog

## 2.1.0

- **`/eta-dashboard`** — new slash command that generates a self-contained
  local HTML report (`~/.claude/eta/dashboard.html`) and opens it in your
  default browser: stat tiles, a diverging bar chart of per-bucket
  calibration bias, a v1-vs-v2 backtest comparison, and a log-scale
  predicted-vs-actual scatter colored by band hit/miss. Hand-rolled inline
  SVG, no charting library, no network requests — same zero-dependency,
  nothing-leaves-your-machine invariant as everything else. `/eta-reset`
  now also clears the last generated dashboard so it can't show stale
  numbers after a reset.
- **Fixed:** `/eta-stats` was printing `NaN` for every calibration line
  (global and per-bucket) once v2's Bayesian calibration had recorded
  anything — it read the on-disk file's raw `{mean, m2}` shape as if it
  were v1's `{bias, n}` shape. Fixed by adding `describe()` to
  `lib/calibration.mjs`, which returns the exact shrinkage-blended factors
  the estimator actually applies (not raw stored means), so display and
  behavior can never drift apart again.
- `lib/backtest.mjs` extracted from `scripts/backtest.mjs` so the CLI
  backtester and the new dashboard score identically off one
  implementation instead of two copies of the replay logic.

## 2.0.0

v2: the estimator now trains on your own run history. Still zero
dependencies, zero network calls; all learning is local math over
`~/.claude/eta/history.jsonl`.

- **Model tag actually captured.** The hook payload never carried a model
  field (every run landed in `unknown:normal`); the model is now read from
  the session transcript's newest assistant entry — sticky guess at submit
  time, authoritative re-resolve at Stop time before anything is learned.
  Recognizes the `fable`/`mythos` family alongside opus/sonnet/haiku.
- **Hierarchical Bayesian calibration** replaces the v1 EMA: per-bucket
  posterior over log-bias, shrunk toward a global posterior, with
  variance-aware weights estimated from your own runs. The initial p10–p90
  band width now comes from the posterior instead of a hardcoded constant —
  it tightens as evidence accumulates. v1 calibration files migrate in place.
- **Trained quantile regression** (`lib/qreg.mjs`): once 50+ runs are logged,
  three linear quantile models on log-duration (fit by pinball-loss gradient
  descent, dependency-free, deterministic) take over the initial estimate
  entirely. Retrains automatically in the Stop hook as history grows
  (`model.json`).
- **Survival-analysis revise()** (`lib/survival.mjs`): the mid-run countdown
  now reports quantiles of total duration *conditioned on the run still
  going* under a lognormal prior. Expected remaining time correctly grows
  when a run outlives its estimate — v1 instead shrank remaining toward a
  floor, which is why 30s predictions died silently inside 3-minute runs.
  Phase modifiers (how much longer debug-heavy runs tend to be) are learned
  from your history, with v1's hardcoded values as seeds.
- **Backtesting** (`scripts/backtest.mjs`): chronological replay of your
  history — train on everything before each run, predict, score — comparing
  the frozen v1 heuristic against the v2 pipeline on pinball loss, band
  coverage, and median error. "More accurate" is now a measured claim.
- **/eta-stats** additionally reports band coverage (target ~80%), trained
  model status, and learned phase modifiers. History rows now log the full
  predicted band (p10/p90), and `/eta-reset` also clears `model.json`.

## 1.1.0

- **Self-calibration**: every finished run now teaches the estimator.
  `lib/calibration.mjs` tracks a running log-space bias per `model:mode`
  bucket (plus a shrinkage-damped global fallback) from each run's
  predicted-vs-actual outcome, and `estimateInitial()` applies it going
  forward. Purely local, still zero network calls.
- **`/eta-stats`** — new slash command showing median estimate error and the
  calibration learned so far, per bucket.
- **`/eta-reset`** — new slash command to clear learned calibration/history
  and start fresh.
- Statusline now shows a short phase tag (`exp`/`edit`/`tst`/`dbg`/`oth`)
  alongside the countdown and warning count.
- `CLAUDE_ETA_HOME` env var to relocate `~/.claude/eta/` (also what makes the
  test suite safe to run without touching real user state).
- Added a zero-dependency test suite (`node --test`) and CI.

## 1.0.0

Initial release: instant estimate at submit (`UserPromptSubmit`), mid-run
revision via tool-call phase tracking (`PostToolUse`), content-free history
log (`Stop`), and an optional statusline countdown.
