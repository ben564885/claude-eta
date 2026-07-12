# claude-eta

**A live ETA for your Claude Code runs.** The moment you submit a prompt you
get an instant range. As Claude works, a statusline countdown ticks down —
and revises itself the second the run hits traffic: an error surfaces, a test
fails, a debug spiral starts.

No more staring at a spinner wondering if this is a 30-second fix or a
20-minute rabbit hole.

<img src="assets/demo.svg" alt="claude-eta demo: an instant estimate at submit time, then a live statusline countdown that widens after a failing test" width="900" />

## Why

Agent runs are heavy-tailed. Most of what decides how long a run takes is
work that doesn't exist yet at the moment you hit enter — you can't know
there's a failing test three tool calls out. So claude-eta never shows you a
fake-precise number. It shows a **range** up front, then sharpens that range
as real evidence comes in: which phase Claude is in (exploring, editing,
testing, debugging), how many tool calls it's made, and how many errors it's
hit along the way. Treat it as a sense of scale, not a stopwatch.

## Install

```
/plugin marketplace add ben564885/claude-eta
/plugin install claude-eta@claude-eta
```

That's it for the instant estimate — the moment you submit a prompt you'll
see a message like `⏱ est. ~1m–6m`.

## Get the live countdown (one extra step)

Claude Code doesn't currently let a plugin auto-install a statusline, so this
part is a one-time manual step. Add this to your own `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node \"$CLAUDE_PLUGIN_ROOT/scripts/statusline.mjs\""
  }
}
```

If `$CLAUDE_PLUGIN_ROOT` doesn't expand in your settings context, replace it
with the absolute path to where the plugin got installed. Without this step
claude-eta still works fine — you just get the instant estimate at submit
time, not the ticking countdown.

## What you'll see

- **At submit** — an instant range based on your prompt's length, file
  references, and intent (`fix`, `build`, `refactor`, `explain`, ...), plus
  the model and mode you're running.
- **While Claude works** — a statusline countdown that shrinks as time
  passes, and jumps back *up* when the run hits trouble:

  ```
  ⏱ ~3m10s left ███░░░░░ +2⚠
  ```

  `+2⚠` means two issues (errors, failed tests, tracebacks) have shown up
  since submit — that's what just widened your ETA.

## How it works

Three lightweight hooks and one small state file per session
(`~/.claude/eta/state/<session_id>.json`):

- **`UserPromptSubmit`** — computes the instant estimate and writes fresh
  session state. Pure local computation, no network calls.
- **`PostToolUse`** — fires after every tool call, classifies it into a phase
  (`explore → edit → test → debug → other`), and revises the estimate as
  issues and phase time accumulate.
- **`Stop`** — closes out the run and appends one row to
  `~/.claude/eta/history.jsonl` for future versions to learn from.

Zero runtime dependencies, zero network calls — it's all plain Node.js
reading and writing local JSON.

## Privacy

Only the **shape** of a run is ever recorded — model, mode, prompt length,
file-reference count, phase timings, tool/issue counts, durations.
**Prompt text and tool output are never stored, anywhere.** Everything lives
locally under `~/.claude/eta/`; nothing leaves your machine.

## Roadmap

v1 (this release) is a heuristic estimator — reasonable seeds, not a trained
model. `lib/model.mjs` is the entire seam: v2 will train on your own
`history.jsonl` and do real Bayesian updating over the phase sequence, with
no other file needing to change.

## License

MIT
