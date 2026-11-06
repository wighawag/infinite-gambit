<!-- dorfl-sidecar: item=task:chess-exits-redeem type=task slug=chess-exits-redeem allAnswered=false -->

## Q1

**'task:chess-exits-redeem' was bounced — how should we proceed?**

> agent failed: MCP: Failed to connect to miro: OAuth authentication required. Run /mcp-auth miro.
> Response was truncated: the model reached its output token limit.

<!-- q1 fields: id=q1 kind=stuck -->

**Your answer** (write below this line):
keep. Retry: the previous attempt died on the 16,384-token output limit (one reply spent everything on reasoning) and nothing was saved. The design is decided above (C-prime). Start by writing the ADR file (short), then build in small slices, each ending in a written file and a test run: (1) StakeSale redeem + only-the-sale-mints + guarded setters + test helpers; (2) the deployment-reveal route split; (3) reserve move-up in _foldCapture; (4) exit resolution with rocks; (5) the payout and collect; (6) client. Never reason about more than one slice in a single reply.
