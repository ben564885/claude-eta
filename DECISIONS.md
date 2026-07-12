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
