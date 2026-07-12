---
description: Generate and open a local HTML dashboard visualizing claude-eta's calibration, trained model, and backtest results.
---

Run this exact command with the Bash tool:

    node "$CLAUDE_PLUGIN_ROOT/scripts/dashboard.mjs"

It writes a self-contained HTML report to `~/.claude/eta/dashboard.html` (no
external requests — everything is inlined) and opens it in the default
browser. Tell me the file path it printed. If opening the browser fails on
this machine, tell me to open that path manually.

If there isn't much history yet, say so briefly — the dashboard still
renders, it just won't have much to show until more runs are logged.
