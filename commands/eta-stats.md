---
description: Show how well claude-eta's estimates have tracked reality, and the calibration it has learned from your own runs.
---

Run this exact command with the Bash tool and show me its output verbatim (it's already formatted for terminal display):

    node "$CLAUDE_PLUGIN_ROOT/scripts/stats.mjs"

After showing the output, add one or two sentences of your own commentary — e.g. call out any bucket with a large correction factor or very few samples, or note if there isn't enough history yet to say much.

If I ask how v2 compares to v1 (or ask to "backtest"), also run:

    node "$CLAUDE_PLUGIN_ROOT/scripts/backtest.mjs"

and show that output verbatim too.

If I ask for a dashboard, charts, or something visual, run `/eta-dashboard` instead.
