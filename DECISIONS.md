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

## v2.0.0: trained estimator (2026-07-12, unattended)

Built per the "start on all of it, go 1 by 1, don't ask questions" brief.
Decisions made along the way:

- **Model-tag source**: the hook payloads carry no model field; the session
  transcript (`transcript_path`) does, in each assistant entry. Submit-time
  reads the tail for the previous turn's model (sticky within a session);
  Stop-time re-resolves authoritatively before learning. Tail read capped at
  256KB so the hook stays near-instant on multi-MB transcripts.
- **Calibration test semantics changed intentionally**: the v1 test asserted
  <1.5x transfer to an unrelated bucket after unanimous 2x misses. The
  variance-aware posterior correctly transfers *more* when evidence is
  unanimous (zero spread) — the guard is against few/noisy samples, and a
  new test pins exactly that. Threshold relaxed to "never full transfer".
- **Bayesian constants** (`calibration.mjs`): TAU_GLOBAL=0.2 (heuristic
  believed globally right within ~1.5x at 2sd), TAU_BUCKET=0.5, noise prior
  0.75 carrying 8 pseudo-runs, band sigma clamped to [0.25, 1.25]. Seeds,
  not sacred — same spirit as v1's constants.
- **Quantile regression stays linear** (no boosting/NN): three pinball-loss
  fits over 13 features, full-batch, fixed 300 epochs, no RNG → identical
  retrains on identical history. Activates at 50 runs; retrains in the Stop
  hook every 5 new runs (a few ms for hundreds of rows).
- **revise() applies no bias factor on the qreg path's prior** and qreg
  predictions never get the calibration multiplier — both are trained on
  actuals; stacking the correction would double-count it.
- **Tail cap in survival math** (F_CAP=0.995): deep past the estimate, the
  conditional lognormal quantiles explode; capping the conditioning point
  holds the band finite ("way past p99.5, hold here") instead of quoting
  absurd hours.
- **Phase mods from aggregates**: history logs per-run phase *totals*, not
  transition sequences, so mods are geometric-mean ratios ("runs featuring
  debug run 1.6x longer"), not a true semi-Markov chain. Logging transitions
  is on the roadmap; not retrofitted here to keep history rows content-free
  and small.
- **Backtest feedback loop matches production**: during replay, calibration
  learns from each run's *v2* prediction (as finalize.mjs does), not the
  frozen heuristic's — the comparison measures the pipeline users actually
  get.
- On this machine's real 11-run history the backtest reads: v1 band
  coverage 27% / median |err| 200% vs v2 73% / 86% — qreg still inactive,
  so that's the Bayesian layer alone.

## v2.1.0: dashboard + a real bug found along the way (2026-07-12, unattended)

Built in response to "is there a training dashboard?" Decisions made along
the way:

- **Found and fixed a live bug before building on top of it**: `stats.mjs`
  read `calibration.json` directly and called `Math.exp(entry.bias)`, but
  v2's schema is `{n, mean, m2}` — `.bias` is always `undefined`, so every
  calibration line in `/eta-stats` printed `NaN` on any real machine that
  had actually recorded a v2 outcome (confirmed live on this machine's real
  `~/.claude/eta/`, not just synthetically). Root cause: the schema change
  in v2.0.0 wasn't propagated to the one caller reading the file directly
  instead of through an export. Fix: `lib/calibration.mjs` now exports
  `describe()`, which returns the exact shrinkage-blended factors
  `estimateInitial()` actually applies — display and behavior share one
  source of truth, so they can't drift apart again the way they just did.
- **Extracted `lib/backtest.mjs` from `scripts/backtest.mjs`** before
  writing the dashboard, rather than importing the CLI script or
  duplicating its replay loop — the CLI text output and the dashboard's
  charts now come from one `runBacktest()` call, guaranteeing they always
  agree.
- **Followed the gstack `dataviz` skill's procedure in full** (form before
  color, six-checks validator, marks/anatomy, table-view twin per chart):
  diverging blue/red for calibration bias (a measure with a real zero point,
  1.0x); a single accent hue + de-emphasis gray for the v1-vs-v2 comparison
  (emphasis pattern — the story is "v2 improved on v1," not "compare N
  series"); the status pair (good/critical) for scatter points, since
  in-band/out-of-band is genuinely a state, not an identity. Ran
  `validate_palette.js` on both pairs against both surfaces before using
  them (PASS on all checks).
- **Actually rendered and looked at it** (step 7 of the dataviz procedure,
  easy to skip) — headless-Chrome-screenshotted the dashboard against a
  synthetic 80-run dataset, the real small history, and an empty state, in
  both color schemes, rather than trusting the generated numbers alone.
  This caught two real defects no amount of staring at the code would have:
  (1) the v1-vs-v2 backtest chart originally shared one x-scale across
  pinball loss (seconds, ~10-20 magnitude) and two percentage metrics
  (0-100) — functionally the same misleading-comparison failure as a
  dual-axis chart, just on bar length instead of two y-axes. Fixed by
  giving each metric row its own scale (small multiples), with a caption
  note so readers don't compare bar length *across* rows. (2) An extreme
  bucket bias factor (the real `unknown:normal` legacy bucket on this
  machine, factor ≈0.33x from real accumulated history) pushed its
  diverging bar's value label far enough left to visually collide with the
  bucket-name column. Fixed with a fixed name column + reserved label
  gutter that caps bar length so the worst-case bucket's label can never
  cross into the name column, regardless of how extreme the factor gets —
  and pinned as a regression test that asserts this geometric invariant
  rather than eyeballing one screenshot.
- **`unknown:` buckets get a one-line explanatory note** in the chart
  caption (linking the behavior already documented in the README) rather
  than being hidden or specially sorted — it's real data, just legacy, and
  hiding it would be less honest than a one-line "this predates a bug fix."
- **`/eta-reset` now also clears `dashboard.html`**: leaving a stale
  generated report around after a reset would let it keep showing numbers
  that no longer reflect (now-empty) calibration state — a subtler version
  of the exact NaN-drift bug this session started by fixing.
- **Used a real, current screenshot as the README's dashboard image**
  (`assets/dashboard-demo.png`, from actual local synthetic data run
  through the real renderer) rather than a hand-drawn mockup like
  `assets/demo.svg` — the dashboard is a real artifact with real output to
  show, so there was no need to fake one.
