# Build decisions log (unattended run)

This build ran overnight with no one watching. Per the brief, I made the
following assumptions/decisions instead of stopping to ask. Review and adjust
as needed.

## Placeholder identity — RESOLVED
Originally placeholder (`your-name` / `your-github`); filled in with the real
GitHub account (`ben564885`) once the repo was created and pushed:
- Author: `ben564885` (`.claude-plugin/plugin.json`)
- Repo URL: `https://github.com/ben564885/claude-eta`
- Marketplace owner: `ben564885` (`.claude-plugin/marketplace.json`)
- LICENSE copyright holder: `ben564885`, year 2026

## README hero image
`assets/demo.svg` is a hand-drawn SVG mockup of a terminal session, not a
real screenshot — there's no way to capture an actual Claude Code run from
inside this build environment. It's illustrative: a plausible instant
estimate, a failing-test moment, and the resulting statusline countdown. If
you get a real screenshot/GIF later, swap it in at the same path and the
README needs no other change.

## Design choices not fully pinned down by the brief

- **`fmt()` output format**: `45s` under a minute, `2m10s` under an hour
  (omitting the trailing `s` when it's zero, e.g. `2m`), `1h3m` for an hour or
  more (drops seconds entirely at that scale — a countdown doesn't need
  second-level precision an hour out).

- **Stale state sweep threshold**: 6 hours. A state file older than that is
  almost certainly an abandoned/crashed session, not a genuinely slow run, so
  `sweepStale()` (called from `estimate.mjs` on every submit) deletes it.

- **`debug` phase inference**: `phases.mjs classify()` only returns
  `explore/edit/test/other` from the tool call alone — it has no way to see
  accumulated issues. `update.mjs` escalates the classified phase to `debug`
  once total issues-so-far reach 2 while in `test` or `explore`. This lives in
  the hook script rather than `lib/phases.mjs` since it needs cross-call state
  phases.mjs doesn't have.

- **Model constants** (`lib/model.mjs`): `BASE_SEC=40`, `SIGMA_PRIOR=0.75`
  (log-space std dev at t=0), `SIGMA_FLOOR=0.15`, remaining-budget floor at
  10% of the original prior during revision. These are the "seeds, not
  sacred" values the brief asked for — reasonable heuristic starting points,
  expected to be replaced wholesale by v2's trained model.

- **Band math**: worked in log-space using a normal approximation
  (`z ≈ 1.2816` for the 10th/90th percentile) rather than a literal lognormal
  sampler — simpler, dependency-free, and gives the same "band widens at t=0,
  narrows with progress" shape the brief requires.

- **`revise()` band construction**: the p10/p90 spread is applied only to the
  *remaining* portion of the estimate, not the already-elapsed time (elapsed
  time is certain, not uncertain) — `p10 = elapsed + remaining*e^-zσ`, etc.

- **Test-command detection regex** (`phases.mjs`): matches common test/build
  runners (`npm test`, `pytest`, `go test`, `tsc`, `eslint`, etc.) by
  substring/word match against the Bash command string. Not exhaustive by
  design — extending this list is a cheap, safe v1.x tweak, not a v2 change.

## Things explicitly left undone (correctly, per brief)

- No trained model, no history-log training script.
- No real Bayesian/hazard-rate posterior — `revise()` is a heuristic
  multiplicative update, not a proper posterior.
- No token-level signal anywhere.
- No network calls or telemetry anywhere in the codebase.
- Statusline is not auto-installed (platform limitation, documented in
  README) — ships as a copy-paste snippet instead.

## Testing note

Phase 4 smoke tests were run against a live `~/.claude/eta/` directory (that
path didn't exist before this session). After confirming all five steps
passed, I deleted that directory so the fake smoke-test session doesn't
pollute the real history log the plugin will build up for you.

## v1.1: self-calibration + feature audit (2026-07-12, unattended)

You asked whether the plugin trains on its own predicted-vs-actual data —
it didn't yet (only logged it). Implemented `lib/calibration.mjs`: an online
EMA of log-space bias per `model:mode` bucket plus a shrinkage-damped global
fallback, applied by `estimateInitial()`. Pushed as its own commit first.

You then asked for a full feature audit, implemented without stopping to
ask questions. Decisions made along the way:

- **Kept the zero-network-calls invariant firm** even though "audit +
  implement everything" is broad license — that's a stated privacy promise
  in the README, not just an internal implementation detail, so I treated it
  as out of scope to touch regardless.
- **`/eta-stats` and `/eta-reset` slash commands** (`commands/*.md`) — the
  two most obviously missing pieces once calibration exists: a way to see
  what's been learned, and a way to reset it. `/eta-reset`'s command file
  tells Claude to confirm with the user before running — that's the shipped
  plugin asking its future user, not me asking during this build, so it
  doesn't conflict with "don't ask any questions."
- **Statusline phase tag** (`exp`/`edit`/`tst`/`dbg`/`oth`) — the state
  already tracked `phase`; the statusline just wasn't surfacing it.
- **`CLAUDE_ETA_HOME` env var** on `state.mjs`/`calibration.mjs` — added
  primarily so the test suite never touches a real user's `~/.claude/eta`,
  but also a legitimate feature for anyone who wants state elsewhere.
- **Test suite** (`tests/*.test.mjs`, Node's built-in `node --test` +
  `node:assert/strict` — zero new dependencies) and a GitHub Actions
  workflow running it on push/PR. `readStdin()` gained an optional `stream`
  parameter (default `process.stdin`) purely so it's testable without
  spawning a real subprocess; behavior is unchanged for every existing
  caller.
- **`package.json`** — added despite the original build explicitly noting
  its *absence* as a "zero deps" signal. It carries `"dependencies": {}` /
  `"devDependencies": {}` (still literally zero deps) and exists only to
  hold `npm test` and `engines.node` for CI/contributors — not a shift in
  the zero-dependency stance.
- Bumped to `1.1.0` (`plugin.json`), added `CHANGELOG.md`.
- Did **not** add: a trained model, batch training script, real
  Bayesian/hazard-rate posterior, or token-level signal — those are still
  explicitly v2, and the audit didn't change that boundary.
