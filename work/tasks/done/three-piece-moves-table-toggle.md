---
title: 'Three piece-moves, tables: a table creator can play one piece-move instead, through one bit of gameOptions'
slug: three-piece-moves-table-toggle
spec: three-piece-moves
blockedBy: [three-piece-moves-gas-limits]
covers: [9]
---

## What to build

> FORWARD-NOTE (conductor, after PRs #30, #31, #32 merged): (1) CODE SIZE: the unoptimised `Reveal` route is 24,544 of 24,576 bytes, 32 left (`work/notes/observations/reveal-route-at-the-code-size-limit.md`). Reading `gameOptions` and passing the cap into `ChessRules.vacatedBy(moves, cap)` in the reveal will very likely push it over, so expect to move code out of the `Reveal` route first (for example the deployment-forwarding branch, or more of the judging into a library) and say what you moved in the Decisions block; `RouteSizes.test.ts` is the judge. (2) GAS WINDOW: `REVEAL_GAS` is 2,020,000 against a required 2,014,907 and a ceiling of 2,028,132 (`docs/gas.md`, "The declared figures"). A cost added to EVERY reveal widens the window (the ceiling is three times the plain reveal), but about 4,600 added to the worst alone closes it; re-measure, and if it cannot close, STOP with the numbers rather than raising `GENEROSITY_CEILING`. (3) ROUTERS: routers are now the vendored `contracts/src/vendor/router/Router10X60.sol`, which really holds 60 selectors (the lobby has about 50), so one more getter is fine; `RouterSelectors.test.ts` covers it. (4) A lobby getter `getGameOptions()` already exists (`CommitRevealLobby.sol`), but only on tables; the cap getter this task adds must also answer in the worlds (3), so put it on a game route, and do not edit `contracts/src/commit-reveal/`. (5) The whole-move routes are `isLegalWholeMove(board, army, moves, maxPieceMoves)` and `legalMovesAlongside(board, from, others, maxPieceMoves)` on `GameSimulation`; the reveal currently calls `ChessRules.vacatedBy(moves, ChessRules.MAX_PIECE_MOVES)`.

The per-table toggle of `docs/adr/0016`, end to end: contract, table creation screen, tests.

- **One bit of the framework's `gameOptions`, and a SET bit means OFF.** The worlds never open a roster, so they read zero and keep three piece-moves; a table created with no options (`NO_GAME_OPTIONS` in `web/src/lib/game/lobby/table.ts`) plays three as well; a creator who sets the bit plays one piece-move per cycle, today's game. Pin the bit's position as a named constant in the contract and in the client.
- **Refuse an unreadable table at the SEAT, never at the reveal.** A table whose `gameOptions` has any other bit set is refused in `_joinTable` (`UsingGameTable.sol`), so nobody can take a seat at it. The reveal must NEVER revert on `gameOptions`: members who already staked would then miss their reveal and freeze (`docs/adr/0005`). The framework's `initializeLobby` and the factory check nothing of the options, by design; leave `contracts/src/commit-reveal/` alone.
- **The cap reads the toggle.** The per-move check from `three-piece-moves-in-the-contract` caps a move at 1 where the bit is set. Add a game-route getter that returns the table's cap (or its `gameOptions`, read with `_gameOptions()`), and the client passes that cap to the whole-move simulation route (`three-piece-moves-simulation-route`), which reads no storage. `actionsPerReveal` stays 3: it is shared by every table clone and only caps a chunk.
- **Cost.** The `gameOptions` read happens on every reveal of a world and a table: say what it costs (`docs/gas.md`), and keep the declared figures inside `GasBudget.test.ts`'s window.
- **The table creation screen** uses the existing options seam: add `options` (`fields`, `encode`, `describe`) to `chessLobby` in `web/src/lib/chess/table.ts` (`TableLobby.options` in `web/src/lib/game/lobby/table.ts`; the lobby page already renders `fields`), a field limited to 0 or 1, default three piece-moves. Show which one a table plays by rendering `lobby.options.describe(table.gameOptions)` in the table list (it exists, nothing calls it yet).

## Acceptance criteria

- [ ] A table created with the bit set accepts one piece-move per reveal and refuses two; a table created without it, and both worlds, accept three (tested in the contract).
- [ ] Buying a seat at a table whose `gameOptions` carries any other bit reverts (tested); no reveal reverts on `gameOptions`.
- [ ] The getter returns the cap; the client reads it and passes it to the whole-move route.
- [ ] The creation screen sets the bit through `chessLobby.options`, and the table list shows `describe`; a web test checks the client's bit constant against the contract's; logic in plain `.ts`, components only render (AGENTS.md "Svelte conventions").
- [ ] `GasBudget.test.ts`, `RouteSizes.test.ts`, `DeterministicDeploys.test.ts` and the web tests stay green.

## Blocked by

- `three-piece-moves-gas-limits` (the toggle's read is priced on the measured three-piece-move reveal; and it serialises the contract edits).

## Prompt

Goal: build the task above. The "What to build" and "Acceptance criteria" sections are the brief; "done" is every criterion met with the `verify` gate in `dorfl.json` green.

Read first: `AGENTS.md` (Svelte conventions, the framework boundary), the spec `work/specs/tasked/three-piece-moves.md`, `docs/adr/0016` and `0005`, `contracts/src/commit-reveal/CommitRevealGameFactory.sol`, `CommitRevealLobby.sol`, `UsingCommitReveal.sol` (`_gameOptions`), `contracts/src/game/internal/UsingGameTable.sol` (`_joinTable`), the per-move check and the simulation route as the earlier `three-piece-moves-*` tasks left them, `web/src/lib/game/lobby/table.ts` (`TableLobby.options`), `web/src/lib/chess/table.ts` (`chessLobby`), `web/src/routes/lobby/+page.svelte`, and `work/tasks/done/chess-tables.md`. `contracts/src/commit-reveal/` is the framework: read its seams, do not edit it.

Work in small steps, and `git commit -am "wip: <step>"` after each one. RECORD non-obvious in-scope decisions in a `## Decisions` block at the end of your FINAL REPORT. Do not write the done record, commit message or PR body yourself, and do not edit this task body.

## Decisions

- **Where the cap getter lives:** I added `getMaxPieceMoves()` to `IGameGetters`/`GameGetters`, so it answers in the worlds and at tables (the lobby's `getGameOptions` only exists on tables). It returns the cap rather than the raw options, so the client never re-decodes the contract's rule to get its cap. The alternative was a game-route `getGameOptions`-style getter, which would duplicate the lobby's selector. This touches the planner task, which should read this getter.
- **New error `UnreadableGameOptions(bytes32 gameOptions)`:** it is raised only at the seat, in `_joinTable`, which every purchase path goes through. The reveal ignores unknown bits, per ADR-0005. The framework factory still accepts any options, so a table nobody can join can still be created. The alternative of refusing at creation would mean editing the framework, which is off-limits.
- **Freeing code size in `Reveal`:** I replaced the typed `IGameDeploymentReveal(address(this)).revealDeployment(...)` re-encode with an assembly forward of `msg.data` under the `revealDeployment` selector, bubbling any revert unchanged. Both functions take identical arguments, and the inner call carries no value, so passing the original payee pays nobody inside. The alternatives were moving judging into a library, or an `abi.encodePacked` forward (tried: it made the route larger, 24,964 bytes). This touches `GameDeploymentReveal` callers only through `reveal`, and all deployment and collision suites stay green.
- **`LOBBY_REVEAL_GAS` raised from 2,090,000 to 2,100,000:** this is required by `GasBudget.test.ts`'s 10% headroom after the options read, and is within the table ceiling. It is a user-visible change to the lobby's declared reveal limit, which feeds the table's stipend and reveal-prepayment sizing. `REVEAL_GAS` and `GENEROSITY_CEILING` are unchanged.
- **Client cap plumbing:** `readMaxPieceMoves` and `wholeMoveRoute` are tested helpers, but no screen calls them yet. Wiring them into planning is `three-piece-moves-planner`'s job. `maxPieceMovesOf` decodes the bit on the client only for `describe` in the table list; the cap the client plays by is the contract's getter.
- **Field shape:** a numeric field `onePieceMove` from 0 to 1, defaulting to 0, labelled "One piece-move a cycle? 1 for one, 0 for up to three", because the existing options seam only renders number inputs. `describe` returns `{label: 'Piece-moves a cycle', value: 'up to 3' | '1'}`.
- **Bit check in the web test:** it parses `ChessRules.sol`'s constants with a regex, because the constant is `internal` and web unit tests have no chain to ask. The alternative was a pure contract getter just for the test.
