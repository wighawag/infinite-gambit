---
title: 'Build agents on hard contract tasks die on the 16,384-token output limit'
---

Observed 2026-11-05/06 by the drive-tasks conductor over the `infinite-chess` drive. Four `dorfl do` runs failed with `agent failed: ... Response was truncated: the model reached its output token limit` (`chess-moves` once, `chess-king-capture-merge` twice, `chess-capture-loops` once). The pi session of one of them (`~/.pi/agent/sessions/--home-wighawag-.dorfl-work-github-com__wighawag__chess-battleground__chess-king-capture-merge--/`) shows the cause: a single assistant reply spent all 16,384 output tokens on reasoning (`stopReason: length`, `reasoning: 16384`) although the session's thinking level is `off`, about 25 minutes in. The run then ends with nothing saved unless the agent had already written files (one of the four saved a wip commit). Every retry with a "work in small steps" handoff succeeded, so it is recoverable, but each failure costs about half an hour.

The `MCP: Failed to connect to miro: OAuth authentication required` line in the same reason is noise from the harness's MCP config, not the failure.

Possible levers (none applied): a higher max output tokens for the build model (`etherplay/claude-opus-5-5` under pi), a different model for `dorfl` builds, or a per-repo `promptGuidance` nudge to act before planning the whole task.
