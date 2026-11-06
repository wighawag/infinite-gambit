---
title: 'Played seats: a greedy bot that captures the most valuable piece it can reach'
slug: chess-greedy-bot
spec: infinite-chess
blockedBy: [chess-freeze]
covers: [43]
---

## What to build

Machine-played seats in the offline world (the hotseat mode, where each seat is a human or the machine; online tables have no machine seats in v1) play chess. A machine seat whose army is gone (captured, exited, failed deployment) redeploys at an open spawn point. Each cycle it plays: each cycle, capture the most valuable piece reachable (king highest, then queen 9, rook 5, bishop 3, knight 3, pawn 1), otherwise make a random legal move. Scoring and legality come from the contract's own rule through the simulation route (`docs/adr/0007-rules-live-only-in-the-contract.md`). The framework's strategy seam is `$lib/game/core/strategy.ts`; the deleted reference game's `placement/strategy.ts` (in git history) shows how a `greedy` level scored moves from the bytecode. Bot logic lives in plain `.ts`.

> FORWARD-POINTER (conductor, from what landed before this task; see `work/tasks/done/`):
> - **DRIFT TO CHECK FIRST: redeploying.** `chess-deployment-collisions` decided "machine seats with a dead army sit out instead of redeploying", because a redeploy changes the seat's identity (a new army id) and the secret derived for it, which is a wire. This task asks the opposite (a seat whose army is gone redeploys). An account may own several armies (`_armyIdOf(owner, nonce)`), so redeploying means the seat plays its NEXT army id; make sure the stored submissions and derived secrets stay keyed per army and nothing in flight is lost. If that cannot be done safely, STOP and surface it rather than break the wire.
> - **Rocks are army 0**: a piece with a kind and army 0 is an ownerless rock (capturable, worth nothing to capture, never a target worth scoring). An exited army's own pieces are simply gone.
> - Scoring and legality come from the contract through the simulation route (`legalMoves` in the sandbox), never a TypeScript copy of the rules.

## Acceptance criteria

- [ ] A played seat captures the most valuable reachable piece when one exists, and otherwise makes a legal move.
- [ ] A played seat whose army is gone redeploys, so the offline world always has its machine opponents.
- [ ] The bot uses the simulation route, not a TypeScript copy of the rules.
- [ ] Tests cover the new behaviour.

## Blocked by

- `chess-freeze`

## Prompt

Goal: build the task above ("Played seats: a greedy bot that captures the most valuable piece it can reach"), covering user stories 43 of the spec `infinite-chess`. The "What to build" and "Acceptance criteria" sections above are the brief; "done" is every criterion met with the `verify` gate green.

Read first: `AGENTS.md` (the Svelte conventions, the framework boundary, the commit-reveal rules), `CONTEXT.md` (the framework glossary and this game's words: army, move, spawn point, deployment, exit, capture, merge, collision, capture loop, freeze), the spec `work/specs/tasked/infinite-chess.md` (its user stories), and the ADRs in `docs/adr/`. In particular `0002-order-free-lazy-resolution.md` (reveals only accumulate order-free facts, every square resolves lazily, no rule may make a piece bounce back) and `0007-rules-live-only-in-the-contract.md` (the chess rules are `pure` contract code; the client reaches them only through the simulation route, `$lib/game/simulation`, and reads the board through a contract view that resolves lazily over a viewport; no TypeScript copy of the rules, no indexer for state).

The contracts build on the commit-reveal base (`contracts/src/commit-reveal/`) through its seams (`_playerOf`, `_forfeit`, `_cycle`) and the game's own routes behind the router (`contracts/src/game/`). The pattern to follow is a `pure` rule, a load/apply split around it, and a simulation route that exposes the rule to the client. The template's reference game (`placement`) showed it until `chess-army-deployment` replaced it with chess; follow the chess code from then on, and its order-independence test in `contracts/test/js/` (which replaces the template's `Game.test.ts`). Two budgets bind every contract change: the declared reveal gas (`contracts/test/js/GasBudget.test.ts`; a reveal that runs out of gas is a missed reveal, which FREEZES the army) and the 24,576-byte deployed size of each route. The acceptance gate is `verify` in `dorfl.json`; it must be green.

FIRST, check this task against current reality (it is a launch snapshot and may have DRIFTED): does it still match the code in `work/tasks/done/`, the relevant ADRs, and the tasks it depends on? If a dependency landed differently than this task assumes, or an ADR superseded an assumption here, do NOT build on the stale premise: route the task to needs-attention with the discrepancy as the reason (WORK-CONTRACT.md "Drift is a needs-attention signal"). Building on a stale task produces wrong-but-compiling work.

RECORD non-obvious in-scope decisions you make while building, in a `## Decisions` block at the end of your FINAL REPORT. When the task did not specify some behaviour and you have to CHOOSE, do not leave the choice silent for a reviewer to reverse-engineer. That block is the ONE sanctioned channel for build-time rationale, and the runner transcribes it verbatim into the done record. So do NOT try to write the done record, the commit message, or the PR body yourself (you do no git and must not edit the task body), and do NOT open a `work/notes/observations/decisions-<slug>.md` note. If the choice meets the ADR gate (hard to reverse + surprising without context + a real trade-off, see `work/protocol/ADR-FORMAT.md`), ALSO write the durable WHY as an ADR in `docs/adr/` (next free number) and name it in the block.

---

### Claiming this task

```sh
# atomically claim it (works with a GitHub remote OR a local --bare remote):
dorfl claim chess-greedy-bot --arbiter <remote>      # default --arbiter origin
# then start work on the updated main:
git fetch <remote> && git switch -c work/chess-greedy-bot <remote>/main
# on completion, in the work branch's PR/merge:
git mv work/tasks/ready/chess-greedy-bot.md work/tasks/done/chess-greedy-bot.md
```

## Decisions

- **Material values come from a new contract view, `materialOf` on the Simulation route.** I chose this because the task says scoring comes from the contract's own rule, and the material table already exists in `ChessRules` (tables use it for payouts). The alternative was a TypeScript value table, which would be a copy of a rule (ADR 0007). It changes the `IGameSimulation` and `IGame` ABI by one pure function, so the route's bytecode, and with it the deterministic addresses, changes. Nothing is deployed yet, so that costs nothing.
- **"King highest" is the bot's own policy, not a contract number.** The contract values a king at 0 material, so the strategy ranks it one above the largest material value. Rocks score 0 but stay among the random legal moves.
- **Greedy is a level and the default; "Deploys and passes" stays available.** I exported `AI_DEFAULT_LEVEL = 'greedy'`, so a fresh lobby choice starts there. A world restored from a record keeps the levels it was built with, so older worlds are still `random`. The alternative was making every machine seat greedy and dropping the level choice. This touches the lobby, through the `AI_LEVELS` and `AI_DEFAULT_LEVEL` exports it already reads.
- **A redeploying seat buys its stake with its own play money** (`StakeSale.purchase`, no stipend) when its reserve plus any pending refund is less than one stake. Without this, a captured or frozen seat could never come back, and the task requires that the world always has its machine opponents. Unlike the human's stake, this one is refilled, but only after the old army is really gone. Topping it up at boot was the alternative, and the existing code rules that out as the "refill on reload" hazard.
- **Which army a seat plays (`armyToPlay`):** the most recent live army whose `owner` is still the seat's account, otherwise `getNextArmy`. An army that a capture loop handed to another account counts as gone for that seat. Before acting, the seat settles a stale commitment on the army it plays and on its most recent owned army.
- **The bot only looks within 24 squares of its king** (`LOOK_AROUND`). A piece that wandered further, or a merged army's pieces left far away, are not moved by the bot. I rejected scanning the whole board: it costs more, and pieces that far away cannot affect captures near the army.
- **New persisted key `offline-world:played-turns`** holds the seats' decided moves, keyed per (chain, contract, army, cycle) with the framework's `createPlayedTurnStore` and this game's `MOVE_STORAGE` format. It is a wire from its first build. Nothing is deployed yet, so introducing it costs nothing.
- **If the strategy throws, the seat stores and commits a pass**, so a seat that cannot decide never holds up the manual cycle.

No ADR written: none of these is hard to reverse before the first deploy.
