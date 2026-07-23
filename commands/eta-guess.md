---
description: Log your own duration estimate (in seconds) for whatever you send me next, before you send it.
argument-hint: <seconds>
---

Run this exact command with the Bash tool and show me its output verbatim:

    node "$CLAUDE_PLUGIN_ROOT/scripts/guess.mjs" $ARGUMENTS

Don't do anything else — no summary, no follow-up questions. This only
applies to the very next prompt I send after this one; if I don't send
another prompt within about 10 minutes, the estimate is discarded rather
than misattributed to something unrelated.
