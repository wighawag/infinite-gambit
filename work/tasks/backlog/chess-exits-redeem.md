---
title: 'Exits: a king leaves with its stake, paid out in ETH, and nothing else can withdraw'
slug: chess-exits-redeem
spec: infinite-chess
blockedBy: [chess-capture-loops]
covers: [32, 33, 34, 35]
needsAnswers: true
---

## What to build

The only way a stake leaves the world, and the code that pays ETH out of the sale, so review it with care before promoting. See `docs/adr/0006-stake-erc20-reserve-exit-only.md`.

- Exits sit at the centre of each spawn-grid cell (offset S/2 on both axes).
- **The army leaves at the close of its landing cycle, not when somebody calls `exit`.** A king that lands on an exit with no collision has left the board as of the end of that cycle: resolved lazily (a flag read on resolution, not a loop over its pieces), it refuses further commits and can no longer be captured, and the rest of its army is gone. `exit(army)`, callable by ANYONE once that cycle has closed, only PAYS: the king's whole stake (resolved read-order-independently, see `chess-king-capture-merge`) goes to the army's owner. Otherwise a capture in the next cycle would race the call.
- **What backs the payout.** Only `StakeSale` may mint the game token (the template's free faucet `mint` goes), and the sale KEEPS the ETH it receives (it no longer forwards payments to a recipient). `StakeSale` gains `redeem` at the same fixed price, paid from that ETH, so the exit returns ETH.
- **Deterministic deploys** (AGENTS.md): `StakeSale`'s constructor takes the token and the game, so the token learns its minter through a guarded `setMinter` (its owner passed as a constructor argument, since under CREATE2 `msg.sender` is the factory), and the game reaches the sale through a guarded setter too. Both are covered by `DeterministicDeploys.test.ts`.
- Today the free `mint` is also used by the contract test helpers (`contracts/test/js/utils`); move them onto buying through `StakeSale` (or an explicitly test-only path) rather than keeping a public mint.
- **Withdrawal.** An ARMY's reserve can never be withdrawn directly. The ACCOUNT's reserve stays withdrawable and redeemable.
- **Extend the "dead" predicate** with exited armies, so the `advanceCycle` sweep stops waiting for them (exits exist in the offline world, which runs world rules).
- The client marks exits on the board and on the minimap, and offers the payout.

Serialised after capture loops because it edits the same resolution code.

> FORWARD-POINTER (conductor, from what `chess-king-capture-merge` landed; see `docs/adr/0009-merges-resolve-through-captured-into-pointers.md`):
> - **A captor's stake is not in its own reserve.** No reserve moves on a capture: a merged army's stake is its own reserve plus, recursively, the reserves of the armies it took (`UsingGameBoard._stakeOf`/`_treeStake`), and that walk is bounded at `MAX_CHAIN = 8` levels. The exit must pay the WHOLE merged stake: collect every reserve of the tree into the payout (debit them, so nothing can be paid twice), in bounded gas, and never strand a reserve deeper than the bound. Moving a victim's reserve up into its captor when its capture is folded (in `_foldCapture`, a closed-cycle fact) keeps the tree sum unchanged and flattens it over time; an exit that still meets a tree deeper than it can collect in one transaction needs a permissionless, incremental way to collect it first. Add a test with a merged tree deeper than `MAX_CHAIN`. If you cannot make the payout complete and bounded, STOP and surface it rather than pay a truncated stake.
> - **Extend the ONE `_isDead` predicate** (failed/cancelled/unrevealed deployment, captured) with exited; a dead army's commit reverts `NotInGame`.
> - **Route sizes** are tight (`RouteSizes.test.ts`): `chess-deployment-collisions` already moved entry points from `GameReveal` to `GameCommit`, and `chess-king-capture-merge` added a `GameRegistry` route.

> - **Pay the army's CURRENT owner, `_ownerOf(army)`**, not the account that created it: a capture loop rotates owners (`docs/adr/0010-a-capture-loop-rotates-owners-not-armies.md`), so the army record's creator can differ from who owns it now.
> - **Money rules to keep (ADR 0006):** only `StakeSale` may mint; the sale keeps its ETH; `redeem` pays at the same fixed price from that ETH; an exit can be claimed once (debit what it pays); tokens obtained any other way cannot drain the sale (test it). Nothing is deployed yet (`git ls-files contracts/deployments` is empty), so changing the sale's constructor is free, but every contract stays `deterministic: true` and every setup call guarded (`DeterministicDeploys.test.ts`).

## Acceptance criteria

- [ ] A king landing alone on an exit is paid its whole stake in ETH and its army is removed.
- [ ] A king whose arrival on an exit collides follows the collision table instead.
- [ ] `exit(army)` works for any caller after the landing cycle has closed, pays only the army's owner, and cannot be claimed twice.
- [ ] Exit calls and next-cycle capture attempts on the exited army, in either order, give the same payout and the same board.
- [ ] An army reserve can no longer be withdrawn directly; an account reserve still can.
- [ ] Only `StakeSale` can mint; `redeem` pays from the ETH the sale kept; a test shows tokens obtained any other way cannot drain it.
- [ ] `StakeSale.redeem` has its own tests, alongside the existing `StakeSale.test.ts`, and `DeterministicDeploys.test.ts` still passes with the new game-to-sale link.
- [ ] Tests cover the new behaviour.

## Blocked by

- `chess-capture-loops`

## Prompt

Goal: build the task above ("Exits: a king leaves with its stake, paid out in ETH, and nothing else can withdraw"), covering user stories 32, 33, 34, 35 of the spec `infinite-chess`. The "What to build" and "Acceptance criteria" sections above are the brief; "done" is every criterion met with the `verify` gate green.

Read first: `AGENTS.md` (the Svelte conventions, the framework boundary, the commit-reveal rules), `CONTEXT.md` (the framework glossary and this game's words: army, move, spawn point, deployment, exit, capture, merge, collision, capture loop, freeze), the spec `work/specs/tasked/infinite-chess.md` (its user stories), and the ADRs in `docs/adr/`. In particular `0002-order-free-lazy-resolution.md` (reveals only accumulate order-free facts, every square resolves lazily, no rule may make a piece bounce back) and `0007-rules-live-only-in-the-contract.md` (the chess rules are `pure` contract code; the client reaches them only through the simulation route, `$lib/game/simulation`, and reads the board through a contract view that resolves lazily over a viewport; no TypeScript copy of the rules, no indexer for state).

The contracts build on the commit-reveal base (`contracts/src/commit-reveal/`) through its seams (`_playerOf`, `_forfeit`, `_cycle`) and the game's own routes behind the router (`contracts/src/game/`). The pattern to follow is a `pure` rule, a load/apply split around it, and a simulation route that exposes the rule to the client. The template's reference game (`placement`) showed it until `chess-army-deployment` replaced it with chess; follow the chess code from then on, and its order-independence test in `contracts/test/js/` (which replaces the template's `Game.test.ts`). Two budgets bind every contract change: the declared reveal gas (`contracts/test/js/GasBudget.test.ts`; a reveal that runs out of gas is a missed reveal, which FREEZES the army) and the 24,576-byte deployed size of each route. The acceptance gate is `verify` in `dorfl.json`; it must be green.

FIRST, check this task against current reality (it is a launch snapshot and may have DRIFTED): does it still match the code in `work/tasks/done/`, the relevant ADRs, and the tasks it depends on? If a dependency landed differently than this task assumes, or an ADR superseded an assumption here, do NOT build on the stale premise: route the task to needs-attention with the discrepancy as the reason (WORK-CONTRACT.md "Drift is a needs-attention signal"). Building on a stale task produces wrong-but-compiling work.

RECORD non-obvious in-scope decisions you make while building, in a `## Decisions` block at the end of your FINAL REPORT. When the task did not specify some behaviour and you have to CHOOSE, do not leave the choice silent for a reviewer to reverse-engineer. That block is the ONE sanctioned channel for build-time rationale, and the runner transcribes it verbatim into the done record. So do NOT try to write the done record, the commit message, or the PR body yourself (you do no git and must not edit the task body), and do NOT open a `work/notes/observations/decisions-<slug>.md` note. If the choice meets the ADR gate (hard to reverse + surprising without context + a real trade-off, see `work/protocol/ADR-FORMAT.md`), ALSO write the durable WHY as an ADR in `docs/adr/` (next free number) and name it in the block.

---

### Claiming this task

```sh
# atomically claim it (works with a GitHub remote OR a local --bare remote):
dorfl claim chess-exits-redeem --arbiter <remote>      # default --arbiter origin
# then start work on the updated main:
git fetch <remote> && git switch -c work/chess-exits-redeem <remote>/main
# on completion, in the work branch's PR/merge:
git mv work/tasks/ready/chess-exits-redeem.md work/tasks/done/chess-exits-redeem.md
```

## Applied answers 2026-11-06

### q1: 'task:chess-exits-redeem' was bounced — how should we proceed?

keep. The human decided (2026-11-06). Build the task whole, with these decisions:
(1) ROUTE SIZE: split deployment reveals off the Reveal route into their own route (own entry point behind the router). The ABI and the client change accordingly; nothing is deployed yet (`git ls-files contracts/deployments` is empty), so that is free. Keep RouteSizes.test.ts measuring the default profile the tests and the offline world use, and keep every route under 24,576 bytes.
(2) GAS: write a new ADR (next free number, amending 0009) and build it: (a) an "exited" fact that a read can recognise WITHOUT walking the merge chain, so path squares, a king's neighbours and footprint squares can tell an exited empire's pieces are gone at bounded cost; and (b) when a capture is folded (a closed-cycle fact, in `_foldCapture`), move the captured army's reserve up into its captor's reserve, which keeps every tree sum unchanged and flattens trees over time. Price the worst reveal honestly in GasBudget.test.ts and raise revealGas only as far as that needs.
(3) DEPTH: the exit must pay the WHOLE merged stake, never a truncated one: no reserve may stay stranded beyond MAX_CHAIN (test a tree deeper than MAX_CHAIN), and if a tree is too deep for one transaction, provide a permissionless incremental way to collect it first. Pay `_ownerOf(army)` (loops rotate owners, ADR 0010).
(4) MINIMAP: out of scope here. Mark exits on the board only; the minimap markers become a follow-up after this task and chess-camera-minimap have both landed.
Everything else in the task stands (only StakeSale mints, the sale keeps its ETH, redeem at the fixed price, guarded setters, deterministic deploys, test helpers buy through the sale, exit claimable once by anyone after the landing cycle closes). Work in small steps (one decision, then act and run a test), since earlier builds died on the 16,384-token output limit.
