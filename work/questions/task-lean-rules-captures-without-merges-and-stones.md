<!-- dorfl-sidecar: item=task:lean-rules-captures-without-merges-and-stones type=task slug=lean-rules-captures-without-merges-and-stones allAnswered=false -->

## Q1

**'task:lean-rules-captures-without-merges-and-stones' was bounced — how should we proceed?**

> agent failed: MCP: Failed to connect to miro: OAuth authentication required. Run /mcp-auth miro.
> Response was truncated: the model reached its output token limit.

<!-- q1 fields: id=q1 kind=stuck -->

**Your answer** (write below this line):
keep. Retry after raising the build model's output limit from 16,384 to 64,000 tokens (both earlier runs died on hidden reasoning in one reply before writing any file). The small-steps handoff applied earlier still stands: act early, keep each reply's edits small, and `git commit -am "wip: <step>"` after each step so a truncation never loses work.
