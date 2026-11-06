---
title: 'Lean rules, the board: a square army, pawns that move every way, spawn points 9 apart and 2 by 2 exits'
slug: lean-rules-square-army-on-a-9-grid
spec: lean-rules
blockedBy: [lean-rules-captures-on-the-client]
covers: [13, 14, 15, 16, 17, 18, 19, 24]
---

## What to build

The third slice of the `lean-rules` spec, and the decision in `docs/adr/0015-a-square-army-with-pawns-that-move-every-way-on-a-9-grid.md`: change the board the game is played on, end to end (contract, client, bot, tests, words). Captures were already rewritten (`lean-rules-captures-without-merges-and-stones`, `lean-rules-captures-on-the-client`: no merges, promotion, stones, no rocks or capture loops), so the tests to port onto the new board are the remaining ones.

- **The army is 5 by 5 without its corners**: 12 pawns around a 3 by 3 core, the king in the centre, one core square EMPTY. Centred on its spawn point (offsets -2 to +2 on both axes):

  ```
   .  P  P  P  .      y = sy + 2
   P  R  N  B  P
   P  Q  K  .  P      y = sy      (the king on the spawn point)
   P  B  N  R  P
   .  P  P  P  .      y = sy - 2
  ```

  Every army has this one layout: there is no facing any more.
- **Pawns step one square orthogonally in any of the four directions, and capture on any of the four diagonals.** No double step, no promotion. A pawn's diagonal onto an empty square stays illegal, as today. Every other piece moves as before (knight, bishop, rook and queen within `SLIDER_RANGE`, king one square, never next to another army's king except onto that king's own square).
- **No facing and no `moved`.** The `forward` field of a piece, the facing of an army and the `moved` flag go, from the contract's types (`Piece`, the square record's `forward`/`arriverForward`/`kingForward`/`moved`), from `ChessRules` (`facing`, `_rotate`, `_canonical`'s directions, the double step), and from the client that decodes them.
- **Spawn points are 9 apart on every grid**: the online world, the offline world (`OFFLINE_DEPLOYMENT` spreads the deploy's data) and tables. That leaves exactly 4 empty squares between any two armies that are side by side or one above the other. `_spawnCovering` (which spawn point's footprint covers a square) reaches 2 squares now.
- **The footprint is the 21 squares** of the 5 by 5 without its corners, the empty core square included, so a deployment's king always has its free square: `_footprintClear`, `_markArrival` (a piece arriving on any of the 21 blocks the deployment), and the table's footprint tally all use it.
- **An exit is the 2 by 2 block at the centre of each spawn-grid cell**: for any spacing S and a spawn point at (sx, sy), the squares at offsets ⌊S/2⌋ and ⌊S/2⌋+1 on each axis; at S = 9 that is (4,4), (4,5), (5,4) and (5,5), two squares diagonally off each army's corner. Test worlds use smaller spacings (`moves-world.ts`, `table-world.ts`, `DeploymentCollisions.test.ts`, `Exits.test.ts`), so `_isExit` and the client's `isExitSquare`/`exitsIn` (`$lib/chess/exits.ts`) implement the general rule. The minimum spacing guard (`spawnSpacing < 6` in `UsingGameStore.sol`) stays at 6: a 5-wide army needs at least 6 for neighbouring footprints not to touch. A king that lands ALONE on any of the four has left the world; two kings landing alone on different squares of one block both leave. Tables still have no exits.
- **The client follows**: the board renderer, the camera/minimap, the deploy preview, `$lib/chess/exits.ts`, the attacked-squares overlay (pawns now attack all four diagonals), the bot (`$lib/chess/strategy.ts`), and anything else that reads a facing or `forward`. Legal moves still come only from the contract's Simulation route (`docs/adr/0007-rules-live-only-in-the-contract.md`).
- **Words**: in `CONTEXT.md` ("This game"), rewrite Spawn point, Footprint (21 squares, 5 by 5), Exit (the 2 by 2 block; keep its merged-army sentence for now, the captures task rewrites it), Table seat ("a tighter grid" is no longer true: the same 9 grid), and Attacked square (a pawn's four diagonals). Mark `docs/adr/0015-...` `status: accepted`.

Capture rules and stakes are NOT changed here. **Gas:** `GasBudget.test.ts` holds each declared figure between the measured worst case plus `MINIMUM_HEADROOM_PERCENT` and `GENEROSITY_CEILING` (3) times it; removing the facing and moving the scenes to spacing 9 moves the measurements, so re-measure and adjust the declared figures in `contracts/rocketh/config.ts` if (and only if) they fall outside that window. The tight figures are `lean-rules-one-slot-square-record-and-tight-gas-limits`.

## Acceptance criteria

- [ ] A deployment lays out the 5 by 5 army above on its spawn point, the same layout everywhere; `layout`, `layoutAt` and `kingOf` agree.
- [ ] A pawn may step to any of its four orthogonal neighbours that is empty, capture on any of its four diagonals, and nothing else (no double step); tested in the contract and through the Simulation route.
- [ ] `forward`, facing and `moved` are gone from the contract's types and storage and from the client.
- [ ] Spawn points are 9 apart in the online world, the offline world and at tables, and neighbouring armies have exactly 4 empty squares between them on both axes (tested).
- [ ] The footprint is 21 squares: a piece on or arriving on the empty core square blocks a deployment like any footprint square (tested).
- [ ] A king landing alone on any of the four squares of a 2 by 2 exit block leaves; two kings landing alone on two squares of one block both leave; nothing exits at a table (tested).
- [ ] The order-independence suite still passes, with a case for each new rule above that a reveal order could touch (a pawn move every way, an exit on each square of a block).
- [ ] The client draws and plays the new board: the offline world test (`web/test/lib/embedded/world.test.ts`) and the boot's every-seat-on-its-own-spawn-point test (`web/test/lib/offline-boot.test.ts`) pass at spacing 9. The e2e suites that draw the board are updated; `verify` does not run them, so run them by hand if the environment allows and say in the report whether you did.
- [ ] `CONTEXT.md` and ADR-0015 are updated as above; `GasBudget.test.ts`, `RouteSizes.test.ts` and `DeterministicDeploys.test.ts` stay green.

## Blocked by

- None: can start immediately.

## Prompt

Goal: build the task above. The "What to build" and "Acceptance criteria" sections are the brief; "done" is every criterion met with the `verify` gate in `dorfl.json` green.

Read first: `AGENTS.md` (the commit-reveal rules, "Deploy every contract with `deterministic: true`", Svelte conventions), `CONTEXT.md` ("This game"), the spec `work/specs/tasked/lean-rules.md` (this task covers its board stories), `docs/adr/0015-...` and `docs/adr/0002-order-free-lazy-resolution.md`, then `contracts/src/game/internal/ChessRules.sol` (the layout block, `_pawnSquares`, `candidateMoves`), `UsingGameBoard.sol` (`_spawnCovering`, `_footprintClear`, `_markArrival`, `_laidAt`, `_isExit`), `UsingGameStore.sol` (the records), `contracts/rocketh/config.ts` (`spawnSpacing` in `Game.localhost`, `Game.default` and `Lobby.default`), `GasBudget.test.ts`, and the client under `web/src/lib/chess/`. `docs/gas.md` explains what each square read and write costs.

FIRST, check this task against current reality: have both captures tasks landed (no merges, rocks or capture loops; stones drawn), is the army still 6 by 4 with a facing, are pawns still one-directional with a double step, and are spawn points still 16 apart (10 at tables)? If not, route the task to needs-attention with the discrepancy (WORK-CONTRACT.md "Drift is a needs-attention signal"). Also run `git ls-files contracts/deployments`: if anything is deployed, the storage change is a wire change and needs a human (AGENTS.md); route to needs-attention.

Work in small steps (one decision, then edit and run a test), and grow files with edits of at most about 300 lines: earlier builds in this repo died on the 16,384-token output limit when a single reply tried to plan everything. Contract first (layout, pawns, spacing, footprint, exits, with tests), then the client, then the words.

RECORD non-obvious in-scope decisions in a `## Decisions` block at the end of your FINAL REPORT (the runner transcribes it into the done record). Do not write the done record, commit message or PR body yourself, and do not edit this task body.
