---
title: 'Lean rules, captures in the contract: no merges, the capturer becomes a queen, a captured army vanishes, and stones'
slug: lean-rules-captures-without-merges-and-stones
spec: lean-rules
blockedBy: []
covers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 22, 23]
needsAnswers: true
---

## What to build

The first slice of the `lean-rules` spec, and the decisions in `docs/adr/0013-no-merges-a-captured-army-vanishes-and-its-captor-is-promoted.md` and `docs/adr/0014-a-capture-whose-captor-falls-the-same-cycle-leaves-a-stone.md`, in the CONTRACT, on today's board (the 6 by 4 army and its spacing stay as they are: the board changes in `lean-rules-square-army-on-a-9-grid`, after this, so it ports fewer tests). Merges, capture loops and stones change together in this one task, because removing capture loops without stones would leave a mutual capture undefined. The client follows in `lean-rules-captures-on-the-client`; this task changes on the client ONLY what the contract's ABI change forces (decoding, and the web tests that break on it).

**The rules.**

- **No merges.** Capturing a king kills its army: from the cycle after the capture, every piece of that army reads as an empty square (lazily, the way an exited army's pieces already do), and its whole stake goes to the army that took it. Stakes snowball: whoever later takes that captor gets both.
- **Promotion.** The piece that took the king lands as a QUEEN. A king that takes a king stays a king. A stone captured gives no promotion.
- **The collision row changes** (ADR-0003): a moving king that meets exactly one other piece on a square dies, and that piece LANDS as a queen with the king's stake, capturing whatever stood there as a lone arrival would. If a king or a stone stood there, that piece takes BOTH victims: both stakes go to its army (each becomes a stone instead if its own king falls that cycle).
- **Stones.** When a king is taken by a piece whose own army's king falls in the same cycle (taken, or leaving through an exit that cycle), the capturing piece disappears with its army and the taken king becomes a STONE on its square: a piece of its own kind, still labelled with the army it was (so it never reads as a vanished piece), holding that army's whole stake. It never moves, blocks like any piece, attacks nothing, and is not a king (a king may stand next to it). Whoever captures it (a lone arrival, a king included; two arrivals follow the collision table as usual) takes its stake, without promotion. The only way "leaving through an exit that cycle" happens with one move per army: a king lands alone on an exit square where a king or a stone stood, takes it and exits in the same move, so what it took stays a stone on the exit; a stone on an exit can only be taken by a piece other than a lone king.
- **Frozen armies** stay on the board with their stake as today, and are captured like any army (their pieces then vanish).

**How, order-free** (`docs/adr/0002-order-free-lazy-resolution.md`):

- "Did the captor's king fall this cycle?" is decided one level deep, never by a walk. A fallen king never moves again, so `_kingAt` locates its square. When a king's square is folded, the fold writes on that army's record the cycle its king fell in (and its captor): "two sources, one answer", as `_exited` reads `kingMovedIn`/`kingTo` before the fold and the `exited` flag after it.
- The vanish check (a piece of an army whose king fell or exited before the cycle being read is empty, except a stone) is two cold reads per distinct army, warm after; it runs on every occupied square a reveal reads.
- Stakes move one capture per cycle: a capture is folded when the victim king's square is next touched (`_moveReserveUp`); a stone's reserve stays with the stone's army until the stone is captured, then folds into its taker's.
- The capture candidate list (`_capturesBy`) is KEPT: an exit payout (`_collect`) finds unfolded victims through it. Note a stone capture as a candidate too (today `_noteCandidate` fires only on a king), and make `_collect` skip a victim that became a stone. Exit collection stays runnable in parts (`collecting`). The read-only stake view (`_treeStake`, `_armyView`), bounded today only by `MAX_CHAIN`, gets a bound of its own (for example a depth cap that reports a lower bound): say which in the Decisions block.

**What goes away:** merges and `capturedInto` chains (ADR-0009), `MAX_CHAIN`, rocks, capture-loop detection and rotation (`_walk`, `_foldLoop`, `_loopedSquare`, `loopedIn`; ADR-0004, ADR-0010), the merged-army part of exits (ADR-0011), the rocks of the table count (ADR-0012), and the test harness that writes `capturedInto` and pushes to `_capturesBy` (`contracts/src/game/test/GameTreeHarness.sol`): delete or rewrite it. Tests that exist only for merges, chains, rocks and loops (`CaptureLoops.test.ts`, `utils/capture-loops.ts`, the `MAX_CHAIN`/rock cases of `Exits.test.ts`, the merge chains of `KingCapture.test.ts`) are replaced by tests of the new rules, not ported.

**Tables.** The cap's material count counts a promoted queen as 9 and a stone as nothing; a stone's stake nobody took is split with the rest at the cap; the last king standing takes every stake at the table, stones' included (the table pot already sums every reserve).

**Gas limits.** `GasBudget.test.ts` holds each declared figure inside a window: at least the measured worst case plus `MINIMUM_HEADROOM_PERCENT`, at most `GENEROSITY_CEILING` (3) times it. Today `REVEAL_GAS` (1,345,000) sits in a window about 1% wide, set by the capture-loop worst (about 1,220,000) and the plain king step (452k). Once loops and chains are gone the worst reveal drops, so RE-MEASURE and LOWER `REVEAL_GAS` and `LOBBY_REVEAL_GAS` (and `COMMIT_GAS` if its window moves) in `contracts/rocketh/config.ts` to sit inside the new window, with the new worst case named in the comments above them. Replace GasBudget's chain and loop cases by stone cases (a stone made, a stone captured, the two-victim square). The tight figures come in `lean-rules-one-slot-square-record-and-tight-gas-limits`.

## Acceptance criteria

- [ ] A lone piece that takes a standing king lands as a queen; a king that takes a king stays a king; the captured army's stake is its captor's, and the captured army's other pieces read as empty from the next cycle (paths, footprints and exits included).
- [ ] A moving king meeting exactly one other piece dies and that piece lands as a queen with its stake; with a king or a stone standing there too, that piece takes both.
- [ ] A capture whose captor's king falls (taken, or exiting) the same cycle leaves a stone holding the victim's stake; a stone never moves, blocks, attacks nothing, may have a king beside it, and gives its stake (no promotion) to whoever captures it; two arrivals on a stone follow the collision table.
- [ ] Two armies of one owner taking each other's king in one cycle gain that owner nothing (two stones).
- [ ] Merges, `capturedInto` chains, `MAX_CHAIN`, rocks, capture-loop folding and `GameTreeHarness`'s use of them are gone; no reveal walks a chain.
- [ ] Exit payout collects every unfolded victim's stake except stones', in parts if needed; the stake view is bounded (the Decisions block says how).
- [ ] At a table: a promoted queen counts 9, a stone 0, an untaken stone's stake is split at the cap, and the last king standing takes every stake, stones' included.
- [ ] The order-independence suite replays each of these in several reveal orders and gets the same board, owners and stakes: promotion, a vanishing army, a stone (taken captor and exiting captor), a stone captured, a stone contested by two arrivals, the two-victim square, the moving-king row, and a king capturing onto an exit.
- [ ] `REVEAL_GAS`, `LOBBY_REVEAL_GAS` (and `COMMIT_GAS` if needed) are re-measured and declared inside `GasBudget.test.ts`'s window, with stone cases replacing the chain and loop cases; `RouteSizes.test.ts`, `DeterministicDeploys.test.ts` and `GasProfile.test.ts` stay green.
- [ ] The client decodes the changed ABI (for example a stone kind, no `capturedInto`/merge fields) and the web tests pass; drawing, the bot and the words are left to `lean-rules-captures-on-the-client`.

## Blocked by

- None: can start immediately.

## Prompt

Goal: build the task above. The "What to build" and "Acceptance criteria" sections are the brief; "done" is every criterion met with the `verify` gate in `dorfl.json` green.

Read first: `AGENTS.md` (the commit-reveal rules: a reveal must not branch on state another reveal of the same cycle could have changed; keep an order-replay test), `CONTEXT.md` ("This game"), the spec `work/specs/tasked/lean-rules.md` (its Solution and stories), `docs/adr/0002`, `0003`, `0004`, `0009`, `0010`, `0011`, `0012`, `0013`, `0014`, then `contracts/src/game/internal/ChessRules.sol` (`settle`, `kingCapture`, `outcome`), `UsingGameBoard.sol` (`_touch`, `_foldCapture`, `_moveReserveUp`, `_exited`, `_revealMove`, `_noteCandidate`, `_kingAt`, `_armyOf`, `_walk`, `_captureOf`, `_pendingCapture`, `_kingCaptureAt`, `_foldLoop`, `_ownerOf`, `_stakeOf`, `_treeStake`), `UsingGameInternal.sol` (`_collect`, `_isDead`, `_playerOf`), `UsingGameTable.sol` (the tally), `contracts/src/game/test/GameTreeHarness.sol`, the order-replay tests under `contracts/test/js/`, `contracts/rocketh/config.ts` (the gas figures) with `contracts/test/js/GasBudget.test.ts`, and `docs/gas.md` (what each read and write costs).

FIRST, check this task against current reality: are merges, rocks and capture loops still in the contract, and is the board still the 6 by 4 army (this task runs BEFORE the board task)? If not, route the task to needs-attention with the discrepancy (WORK-CONTRACT.md "Drift is a needs-attention signal"). Run `git ls-files contracts/deployments`: if anything is deployed, the storage change is a wire change and needs a human; route to needs-attention.

Work in small steps (one decision, then edit and run a test), and grow files with edits of at most about 300 lines: earlier builds in this repo died on the 16,384-token output limit when a single reply tried to plan everything. A workable order: the pure rule (`settle`/`kingCapture`/`outcome` with promotion, the new collision row and stones) with its tests; then the board's folds and the fall cycle; then removing merges, chains, loops and the harness; then stakes, exit collection and tables; then the gas figures; then the client's decoding.

RECORD non-obvious in-scope decisions in a `## Decisions` block at the end of your FINAL REPORT (the runner transcribes it into the done record). Do not write the done record, commit message or PR body yourself, and do not edit this task body.

## Applied answers 2026-11-06

### q1: 'task:lean-rules-captures-without-merges-and-stones' was bounced — how should we proceed?

keep. The previous run produced no code: a single reply spent the whole 16,384-token output budget planning. Do NOT plan the whole task up front. Your first reply must be a tool call (read a file), and no reply may contain more than about 300 lines of new code or prose. Work in this order, and after EACH step run the relevant contract test and make a `git commit -am "wip: <step>"` so a truncation never loses work: (1) the pure rule in ChessRules.sol (settle/kingCapture/outcome: promotion to queen, a king taking a king stays a king, the moving-king-meets-one-piece row, the stone kind) with unit tests; (2) the fall cycle + captor written on the army record when a king's square is folded, read one level deep ("two sources, one answer", like _exited), and the vanish check; (3) delete merges, capturedInto, MAX_CHAIN, rocks, _walk/_foldLoop/_loopedSquare/loopedIn and GameTreeHarness, deleting CaptureLoops.test.ts / utils/capture-loops.ts and the merge/rock/chain cases rather than porting them; (4) stakes: _moveReserveUp one capture per cycle, stones noted as _capturesBy candidates, _collect skips stones, a bounded stake view; (5) tables (queen 9, stone 0, stone stakes in the pot); (6) order-replay cases for each new rule listed in the acceptance criteria; (7) re-measure and set REVEAL_GAS / LOBBY_REVEAL_GAS (COMMIT_GAS if needed) inside GasBudget.test.ts's window with stone cases replacing chain/loop cases; (8) the client's ABI decoding only. Keep the final report short.
