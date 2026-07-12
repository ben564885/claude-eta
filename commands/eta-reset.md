---
description: Clear claude-eta's learned calibration and run history (local only), so it starts estimating fresh.
---

This deletes local files under `~/.claude/eta/` — `calibration.json` (the learned correction factors) and `history.jsonl` (predicted-vs-actual timing records; no prompt text or tool output, only run-shape stats). It does not touch any in-progress session.

Confirm with me that I actually want to do this before running anything (it's a good idea to run `/eta-stats` first so I know what I'd be losing). Once confirmed, run:

    node "$CLAUDE_PLUGIN_ROOT/scripts/reset.mjs"

and show me the output.
