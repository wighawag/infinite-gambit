---
title: 'Three piece-moves, the simulation route: the contract judges a whole move, so the client never copies the rules'
slug: three-piece-moves-simulation-route
spec: three-piece-moves
blockedBy: [three-piece-moves-in-the-contract]
covers: [5]
needsAnswers: false
---

## What to build

> FORWARD-NOTE (conductor, after `three-piece-moves-in-the-contract` merged as PR #30): the rule landed as `ChessRules.MAX_PIECE_MOVES = 3` (the cap constant), `ChessRules.vacate(squares, contents, army, vacated)` (the legality-only mask, in place, a no-op for fewer than two piece-moves), and the cap plus the repeated-from / repeated-to refusals written INLINE in `UsingGameInternal.sol`'s per-move check (reverting `OneMovePerCycle`). To share rule code rather than duplicate it, reuse `vacate` and `MAX_PIECE_MOVES`, and move the cap and duplicate checks into a pure `ChessRules` function that both the reveal and this route call. Mind the code size: the unoptimised `Reveal` route is 24,518 of 24,576 bytes (`work/notes/observations/reveal-route-at-the-code-size-limit.md`), so any change to the reveal side must not grow it past the limit; `RouteSizes.test.ts` will tell you.

`GameSimulation.legalMoves(board, from)` answers for one piece. Add, NEXT TO IT (keep its signature: `planning.ts`, `strategy.ts`, `attacked.ts`, `context.ts` and `offline.ts` call it), a route that judges a WHOLE move of up to three piece-moves on exactly the reveal's rules from `three-piece-moves-in-the-contract`: the cap, the refusals (two to one square, two by one piece), and "own movers count as gone". It also answers, for one piece, its legal destinations given the squares the move's other piece-moves vacate, so a planner can offer them. Rules live only in the contract (`docs/adr/0007-rules-live-only-in-the-contract.md`).

**The route reads no storage**, as `GameSimulation` today, which is what lets the client's sandbox run it, also at a table (the sandbox runs the lobby implementation's route, `web/src/lib/chess/table.ts`, with no per-table state). So the move's CAP is a PARAMETER of the route (3, or 1), not read from `gameOptions`: `three-piece-moves-table-toggle` adds the getter the client reads it from. Share the rule code with the reveal rather than duplicating it, so the two cannot drift.

Add the route to the client's ABI decoding only (`$lib/chess` wherever the simulation ABI is declared); no client behaviour changes here.

## Acceptance criteria

- [ ] The new route accepts exactly the whole moves the reveal accepts, at cap 3 and at cap 1: a property test in the style of `Moves.test.ts`'s "reveals exactly the moves the simulation route calls legal", over whole moves (including swaps, moves onto own-vacated squares, and every refusal).
- [ ] Its per-piece answer, given vacated squares, matches what the reveal would allow.
- [ ] `legalMoves` and its signature are unchanged; the web tests pass.
- [ ] `RouteSizes.test.ts` and `DeterministicDeploys.test.ts` stay green.

## Blocked by

- `three-piece-moves-in-the-contract` (the rule this route answers for).

## Prompt

Goal: build the task above. The "What to build" and "Acceptance criteria" sections are the brief; "done" is every criterion met with the `verify` gate in `dorfl.json` green.

Read first: `AGENTS.md`, `docs/adr/0007` and `0016`, the done record `work/tasks/done/three-piece-moves-in-the-contract.md`, `contracts/src/game/routes/GameSimulation.sol` with `IGame.sol`, `ChessRules.sol`, `contracts/test/js/Simulation.test.ts`, `contracts/test/js/RouteSizes.test.ts`, and `web/src/lib/chess/table.ts` (how the sandbox runs the route at a table).

Work in small steps, and `git commit -am "wip: <step>"` after each one. RECORD non-obvious in-scope decisions in a `## Decisions` block at the end of your FINAL REPORT. Do not write the done record, commit message or PR body yourself, and do not edit this task body.

## Applied answers 2026-11-06

### q1: 'task:three-piece-moves-simulation-route' was bounced — how should we proceed?

keep. The maintainer decided (2026-11-07): vendor a fixed router here, for now. Steps, in order, each its own wip commit:
1. Your previous implementation is restored on this branch (commit "wip: restore the whole-move route and its tests"): the route in `GameSimulation.sol`, `IGame.sol`, `ChessRules.sol`, `UsingGameInternal.sol`, plus `contracts/test/js/WholeMove.test.ts` and `web/test/lib/chess/whole-move-abi.test.ts` (that web test's folder was a guess by the conductor: move it if it belongs elsewhere). Build on it, do not restart.
2. Vendor `Router10X60.sol` from `solidity-proxy@0.5.2` (`solc_0_8/router/Router10X60.sol`) into `contracts/src/vendor/router/Router10X60.sol` (adjust its imports to the package's other files, which stay in `node_modules`), with exactly the two-line fix: entries 48 to 53 assign `tmp_sigs_08 = tmp_sigs_08 | ...` and entries 54 and up assign `tmp_sigs_09 = tmp_sigs_09 | ...`. A header comment says where it comes from, what the bug was, and that it is TEMPORARY until `solidity-proxy` is fixed and republished (then delete this copy and the option below).
3. Pass `routerContract: {type: 'custom', artifact: <the vendored router artifact>}` to `deployViaRouter` in BOTH `contracts/deploy/010_deploy_game.ts` and `contracts/deploy/030_deploy_lobby.ts` (and any other `deployViaRouter` call, including test fixtures and the LAN/offline deploy path if they deploy routers separately). Keep `deterministic: true`. Every deterministic address changes; nothing is deployed (`git ls-files contracts/deployments` is empty), so that is fine; regenerate whatever the web reads (`scripts/ensure-deployments.mjs`).
4. Add a contract test that a router carrying more than 48 selectors routes every one of them (call each selector of `GameLobbyImplementation`, now about 50, and none reverts `UNKNOWN_METHOD`), so the bug cannot come back silently.
5. Record the vendoring in `work/notes/observations/router-loses-selectors-past-48.md` (append: "worked around by vendoring, see `contracts/src/vendor/router/`").
Then finish the task's own acceptance criteria as written (the property test at cap 3 and cap 1, the per-piece answer, `legalMoves` unchanged, `RouteSizes.test.ts` and `DeterministicDeploys.test.ts` green). Mind the Reveal route: 58 bytes of code-size headroom.

## Decisions

- **Compile the vendored router with the optimizer in every build profile** (a per-file `overrides` entry in `contracts/hardhat.config.ts`, which moves the `default` profile to the `compilers: [...]` form; other contracts' settings are unchanged). Why: the package's artifact was optimised (runs 999999). Compiled unoptimised, every call through the router cost about 1,000 more gas, and three `GasBudget.test.ts` checks dropped under their 10% headroom: the world's worst capture reveal (700,892 against `REVEAL_GAS` 770,000), a table's reveal, and the deployment commit settling a failed one. With the optimizer they all pass and nothing changes for players. Alternative considered: raise `REVEAL_GAS`, `LOBBY_REVEAL_GAS` and `COMMIT_GAS`. I rejected it because it changes what the client budgets with, which players see, only to cover a build setting. This touches the hardhat config and the temporary vendoring (the file header says to remove the override along with the copy).
- **Keep the vendored file exactly as upstream except the fix, and exclude `src/vendor` from prettier** (`contracts/.prettierignore`). Why: a `diff` against the package then shows exactly the two fixed lines, which keeps the eventual "is upstream fixed yet?" check trivial. Alternative: let prettier reformat it, which passes `format:check` but buries the fix in a reformatting diff.
- **Keep the contract name `Router10X60`**, so the custom artifact satisfies `routerContract`'s `Artifact<typeof Router10X60.abi>` type with no cast. The ABI is identical to the package's, and no other artifact in this repo uses that name.
