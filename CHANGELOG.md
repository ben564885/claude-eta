# Changelog

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
