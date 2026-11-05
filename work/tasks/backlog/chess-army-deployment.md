---
title: 'Replace the reference game with chess: deploy an army at a hidden spawn point and see it on the board'
slug: chess-army-deployment
spec: infinite-chess
blockedBy: []
covers: [1, 2, 3, 7, 8, 48]
---

## What to build

The tracer bullet: the template's reference game (`placement`, in the contracts and in `web/src/lib/placement`) is replaced by a chess skeleton, end to end, so that a player can buy a stake, deploy an army at a spawn point they chose in secret, and see it appear on the board, online and in the offline world.

- **Identity.** An army is the framework's identity (`_playerOf`): a `uint256` army id owned by an account and acted for by its signer through the template's delegation. Not an NFT, not NFT-shaped. An account may own several armies; the frontend shows one.
- **Stake: two reserves** (`docs/adr/0006-stake-erc20-reserve-exit-only.md`). The ACCOUNT buys stake with ETH through `StakeSale` in one transaction, which credits the account's own reserve (an address-derived id). When the deployment is COMMITTED, a fixed stake (a deployment parameter) moves from the account's reserve into a NEW ARMY id's reserve, and that army reserve IS the stake; it makes the army a waited-for member of the base. Army ids are disjoint from address-derived ids. The army reserve can never be withdrawn directly (the exit task adds the only way out); the account reserve stays withdrawable.
- **Only armies are members.** A credit to an ACCOUNT reserve (a purchase, later a refund) must NOT make the account a waited-for member, or every policy that waits for everyone stalls on an identity that never commits: credit it with `CommitReveal.deposit` directly, skipping the seat. The public `addToReserve(player, amount)` refuses army ids, so nobody can pre-fund a future army or slip extra stake into an existing one.
- **Spawn points.** A grid with spacing S (deployment parameter, 16 for the world). A spawn point is FREE if it has never been deployed to, or its deployment failed; the open set is the K (deployment parameter, 8) free spawn points nearest the origin, in spiral order. A reveal is validated against the open set as it stood at the START of the cycle. A deployment commits to one of them under the commit-reveal base and reveals it like any other submission.
- **Army registry.** The contract keeps a registry of armies (id, owner, king position, stake) with a PAGINATED view over it that returns RESOLVED values (later tasks keep it resolved as kings move, are captured and exit). This is the data source for "how close the nearest armies are" (story 3), and later for the minimap and the HUD, since no indexer is used for state (`docs/adr/0007-rules-live-only-in-the-contract.md`).
- **Placement.** On a successful reveal, the army is placed at the end of the cycle and acts from the next one. Layout (horizontal form, 6 by 4, empty corners, 12 pawns, rotationally symmetric apart from king and queen):

  ```
  . P P P P .
  P R N B Q P
  P K B N R P
  . P P P P .
  ```

  Orientation is a function of the spawn point: the long side faces the origin (horizontal when |y| >= |x|, else vertical), with the king's row on the side away from the origin. Anchor: for the horizontal form the rectangle covers x from spawn.x-3 to spawn.x+2 and y from spawn.y-2 to spawn.y+1 (the vertical form is the same rectangle transposed). Tie-break where "away from the origin" is undefined (a coordinate of 0, including the origin spawn point itself): treat 0 as positive. Each pawn's forward is outward from its side of the rectangle, fixed at deployment. Every piece carries a has-moved flag (needed later for the pawn's two-square move).
- **Board read.** A contract view returns the pieces in a viewport (the client fetches only the area in view). Storage is sparse per square; coordinates are signed and unbounded. The view resolves lazily (`docs/adr/0007-rules-live-only-in-the-contract.md`), even though there is nothing to resolve yet beyond deployments.
- **Client.** The open spawn points are shown with the distance to the nearest armies; the player picks one and commits; the army appears after the reveal. Pieces are drawn with the existing render layer (`$lib/game/render`). All logic in plain `.ts`, components only render. The game's submission storage gets its own key and record shape (this is a wire once deployed: get the names right now).
- **Offline world** (`$lib/embedded`, `offline*.ts`, the hotseat mode on world rules with `CyclePolicy.Manual`) keeps working with chess. Funding a seat's account reserve no longer makes it a member (only armies are), so EVERY seat, human or machine, must deploy an army: machine seats deploy automatically at an open spawn point, then pass (empty commitments) until the greedy bot lands.
- **Until `chess-deployment-collisions` lands**, two deployments revealing the same spawn point both fail (decided by count, never by reveal order); never let the last writer win.

Moves are the next task. Deployment collisions (two reveals on one spawn point, a blocked footprint, cancelling, an unrevealed deployment) come after moves.

## Acceptance criteria

- [ ] The `placement` game is gone from contracts and client, and every path it leaves is listed with a reason in `.offshoot-omissions`; `node scripts/check-dangling-imports.mjs` passes.
- [ ] A player can buy a stake and deploy an army at one of the K open spawn points; the spawn point is hidden until the reveal.
- [ ] After the reveal phase the army stands on the board in the layout and orientation above, and the viewport view returns its pieces.
- [ ] The open spawn points advance along the spiral as spawn points are used, and a reveal is checked against the start-of-cycle open set.
- [ ] Committing a deployment moves the fixed stake from the account reserve into the new army reserve; the account reserve can still be withdrawn, the army reserve cannot; an account reserve never makes its account a waited-for member; `addToReserve` refuses army ids.
- [ ] The registry view is paginated and returns resolved values.
- [ ] An order-independence test reveals two deployments in both orders and gets the same board and registry (the template's `Game.test.ts` goes with `placement`; this replaces it).
- [ ] The commit gas (a deployment commit creates an army id, moves the reserve and starts waiting for it) and reveal gas figures are re-measured for chess and `GasBudget.test.ts` passes.
- [ ] The client shows the open spawn points, lets the player choose one, and renders the army; it fetches only the area in view.
- [ ] The offline world boots with every seat (human or machine) holding an army, and a player can deploy in it.
- [ ] Two deployments revealing the same spawn point both fail, whichever order they reveal in.
- [ ] `contracts/test/js/DeterministicDeploys.test.ts` still passes (every contract deterministic, every setup transaction guarded).
- [ ] Tests cover the new behaviour (contract tests for deployment, layout and orientation in all four quadrants, and the spiral of open spawn points; client unit tests where logic was added).

## Blocked by

- None: can start immediately.

## Prompt

Goal: build the task above ("Replace the reference game with chess: deploy an army at a hidden spawn point and see it on the board"), covering user stories 1, 2, 3, 7, 8, 48 of the spec `infinite-chess`. The "What to build" and "Acceptance criteria" sections above are the brief; "done" is every criterion met with the `verify` gate green.

Read first: `AGENTS.md` (the Svelte conventions, the framework boundary, the commit-reveal rules), `CONTEXT.md` (the framework glossary and this game's words: army, move, spawn point, deployment, exit, capture, merge, collision, capture loop, freeze), the spec `work/specs/tasked/infinite-chess.md` (its user stories), and the ADRs in `docs/adr/`. In particular `0002-order-free-lazy-resolution.md` (reveals only accumulate order-free facts, every square resolves lazily, no rule may make a piece bounce back) and `0007-rules-live-only-in-the-contract.md` (the chess rules are `pure` contract code; the client reaches them only through the simulation route, `$lib/game/simulation`, and reads the board through a contract view that resolves lazily over a viewport; no TypeScript copy of the rules, no indexer for state).

The contracts build on the commit-reveal base (`contracts/src/commit-reveal/`) through its seams (`_playerOf`, `_forfeit`, `_cycle`) and the game's own routes behind the router (`contracts/src/game/`). The pattern to follow is a `pure` rule, a load/apply split around it, and a simulation route that exposes the rule to the client. The template's reference game (`placement`) showed it until `chess-army-deployment` replaced it with chess; follow the chess code from then on, and its order-independence test in `contracts/test/js/` (which replaces the template's `Game.test.ts`). Two budgets bind every contract change: the declared reveal gas (`contracts/test/js/GasBudget.test.ts`; a reveal that runs out of gas is a missed reveal, which FREEZES the army) and the 24,576-byte deployed size of each route. The acceptance gate is `verify` in `dorfl.json`; it must be green.

FIRST, check this task against current reality (it is a launch snapshot and may have DRIFTED): does it still match the code in `work/tasks/done/`, the relevant ADRs, and the tasks it depends on? If a dependency landed differently than this task assumes, or an ADR superseded an assumption here, do NOT build on the stale premise: route the task to needs-attention with the discrepancy as the reason (WORK-CONTRACT.md "Drift is a needs-attention signal"). Building on a stale task produces wrong-but-compiling work.

RECORD non-obvious in-scope decisions you make while building, in a `## Decisions` block at the end of your FINAL REPORT. When the task did not specify some behaviour and you have to CHOOSE, do not leave the choice silent for a reviewer to reverse-engineer. That block is the ONE sanctioned channel for build-time rationale, and the runner transcribes it verbatim into the done record. So do NOT try to write the done record, the commit message, or the PR body yourself (you do no git and must not edit the task body), and do NOT open a `work/notes/observations/decisions-<slug>.md` note. If the choice meets the ADR gate (hard to reverse + surprising without context + a real trade-off, see `work/protocol/ADR-FORMAT.md`), ALSO write the durable WHY as an ADR in `docs/adr/` (next free number) and name it in the block.

---

### Claiming this task

```sh
# atomically claim it (works with a GitHub remote OR a local --bare remote):
dorfl claim chess-army-deployment --arbiter <remote>      # default --arbiter origin
# then start work on the updated main:
git fetch <remote> && git switch -c work/chess-army-deployment <remote>/main
# on completion, in the work branch's PR/merge:
git mv work/tasks/ready/chess-army-deployment.md work/tasks/done/chess-army-deployment.md
```
