<!-- dorfl-sidecar: item=task:three-piece-moves-simulation-route type=task slug=three-piece-moves-simulation-route allAnswered=false -->

## Q1

**'task:three-piece-moves-simulation-route' was bounced — how should we proceed?**

> False premise: the task assumes new functions can be added "NEXT TO" `legalMoves` on the Simulation route at no cost. They cannot. Every route is deployed behind `Router10X60` from `solidity-proxy@0.5.2` (the default of `@rocketh/router`'s `deployViaRouter`, used by `contracts/deploy/010_deploy_game.ts` and `030_deploy_lobby.ts`). Its constructor has a copy-paste bug at `solc_0_8/router/Router10X60.sol` lines 142 to 146: entries 48 to 53 are written with `tmp_sigs_07 = tmp_sigs_08 | ...` and entries 54 and up with `tmp_sigs_07 = tmp_sigs_09 | ...`, where it should write `tmp_sigs_08` and `tmp_sigs_09`. So a router with more than 48 selectors loses the routes in positions 42 to 47 and reverts `UNKNOWN_METHOD`. `GameLobbyImplementation` already has exactly 48 selectors (the world `Game` has 46). Adding `isLegalWholeMove` and `legalMovesAlongside` took the lobby to 50, and 12 table and lobby tests failed with `UNKNOWN_METHOD` (`Lobby.test.ts`, `Tables.test.ts`, `GasBudget.test.ts`'s table reveal), so `verify` is red. Even one new selector (49) breaks it, and `three-piece-moves-table-toggle`'s planned getter hits the same wall. 0.5.2 is the latest published `solidity-proxy`. The fix is a decision above this task: fix and republish `solidity-proxy` (the maintainer's package), then bump it here or upstream in `template-commit-reveal`. Or vendor a fixed router into `contracts/src` and pass `routerContract` to both deploy scripts, which edits template-owned deploy scripts and changes every deterministic address (nothing is deployed yet). Once the router holds 60 selectors, this task can be rebuilt as is. The implementation that passed (contract plus tests) is described above and saved, ephemerally, in /tmp/three-piece-moves-simulation-route/. Captured in work/notes/observations/router-loses-selectors-past-48.md.

<!-- q1 fields: id=q1 kind=stuck -->

**Your answer** (write below this line):
