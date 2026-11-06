<!-- dorfl-sidecar: item=task:lean-rules-captures-without-merges-and-stones type=task slug=lean-rules-captures-without-merges-and-stones allAnswered=false -->

## Q1

**'task:lean-rules-captures-without-merges-and-stones' was bounced — how should we proceed?**

> agent failed: MCP: Failed to connect to miro: OAuth authentication required. Run /mcp-auth miro.
> Response was truncated: the model reached its output token limit.

<!-- q1 fields: id=q1 kind=stuck -->

**Your answer** (write below this line):
keep. The previous run produced no code: a single reply spent the whole 16,384-token output budget planning. Do NOT plan the whole task up front. Your first reply must be a tool call (read a file), and no reply may contain more than about 300 lines of new code or prose. Work in this order, and after EACH step run the relevant contract test and make a `git commit -am "wip: <step>"` so a truncation never loses work: (1) the pure rule in ChessRules.sol (settle/kingCapture/outcome: promotion to queen, a king taking a king stays a king, the moving-king-meets-one-piece row, the stone kind) with unit tests; (2) the fall cycle + captor written on the army record when a king's square is folded, read one level deep ("two sources, one answer", like _exited), and the vanish check; (3) delete merges, capturedInto, MAX_CHAIN, rocks, _walk/_foldLoop/_loopedSquare/loopedIn and GameTreeHarness, deleting CaptureLoops.test.ts / utils/capture-loops.ts and the merge/rock/chain cases rather than porting them; (4) stakes: _moveReserveUp one capture per cycle, stones noted as _capturesBy candidates, _collect skips stones, a bounded stake view; (5) tables (queen 9, stone 0, stone stakes in the pot); (6) order-replay cases for each new rule listed in the acceptance criteria; (7) re-measure and set REVEAL_GAS / LOBBY_REVEAL_GAS (COMMIT_GAS if needed) inside GasBudget.test.ts's window with stone cases replacing chain/loop cases; (8) the client's ABI decoding only. Keep the final report short.
