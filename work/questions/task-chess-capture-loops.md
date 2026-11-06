<!-- dorfl-sidecar: item=task:chess-capture-loops type=task slug=chess-capture-loops allAnswered=false -->

## Q1

**'task:chess-capture-loops' was bounced — how should we proceed?**

> agent failed: MCP: Failed to connect to miro: OAuth authentication required. Run /mcp-auth miro.
> Response was truncated: the model reached its output token limit.

<!-- q1 fields: id=q1 kind=stuck -->

**Your answer** (write below this line):
keep. Retry the build. The previous attempt died on "Response was truncated: the model reached its output token limit": one reply spent all 16,384 output tokens on reasoning before acting (the miro MCP OAuth line is harness noise). Nothing was saved. Work in small steps: settle ONE question at a time and act on it (write a failing test, edit, run that test file) before reasoning about the next; never try to design the whole rotation in a single reply. Grow files with edits of at most about 300 lines each, and keep the final report short.
