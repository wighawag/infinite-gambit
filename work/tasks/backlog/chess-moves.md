---
title: 'Chess moves: one move per army per cycle, validated against the start-of-cycle board'
slug: chess-moves
spec: infinite-chess
blockedBy: [chess-army-deployment]
covers: [9, 10, 11, 12, 16, 17, 18, 19, 20]
needsAnswers: false
---

## What to build

Armies can make chess moves. Interactions between moves (collisions, captures) are the next tasks; here a move onto an empty square that nobody else targets simply lands, and a move whose destination is touched by another move this cycle must at least not corrupt state (the next task defines the outcome): two arrivals on one square both fail, decided by count, never by reveal order. The same holds for a piece moving onto a new army's footprint until `chess-deployment-collisions` defines it.

- **Tempo.** One commitment per army per cycle holding at most one move. Passing is allowed both by committing nothing and by committing an empty move.
- **Legality, checked against the start-of-cycle board only:** normal chess movement; rooks, bishops and queens capped at 7 squares with path blocking on the start-of-cycle board; pawns move forward (their fixed outward direction) one square, or two on their first move, and capture diagonally forward; a pawn's diagonal move requires an enemy on that square at the start of the cycle, its straight move requires the square to be empty then; no castling, no en passant, no promotion; no check rules (a king may move onto an attacked square); a king may NOT move to a square adjacent to another king's START-OF-CYCLE square, except onto that king's own square (a capture), which makes king-against-king collisions impossible (kings may still END a cycle adjacent; see `docs/adr/0003-collision-table-king-survives-a-crowd.md`); a move onto one's own piece is illegal.
- **Accumulation.** A reveal only records order-free facts for the cycle (the move's origin and destination, a per-destination arrival count with `+=`, the lone arriver, whether a king is among the arrivals) and the board resolves lazily when a square is next read (`docs/adr/0002-order-free-lazy-resolution.md`). A per-square "last touched cycle" skips idle cycles.
- **Registry.** The army registry view keeps returning each king's resolved position.
- **Client.** Select a piece, see its legal destinations (computed by the contract's rule through the simulation route, never a TypeScript copy: `docs/adr/0007-rules-live-only-in-the-contract.md`), plan and commit the move, see it land after the reveal.

> FORWARD-POINTER (conductor, from what `chess-army-deployment` landed; see its `## Decisions` in `work/tasks/done/chess-army-deployment.md`):
> - **The client's missed-reveal penalty is now wrong for a move.** `web/src/lib/chess/missed-reveal.ts` derives the penalty from the action count (`count > 0 ? stake : 0`), which was only correct while a deployment was the only non-empty submission. On chain, `_acknowledgeMissedReveal` charges `STAKE` only for a deployment and 0 for anything else. Once a move is a non-empty submission, make the client agree with the contract (a missed MOVE costs 0 here; what it costs is the freeze, which `chess-freeze` adds). Keep a test that a missed move is not shown as losing the stake.
> - **"Pass" is an explicit empty commit under the manual cycle** (the HUD's Pass button, `commitWhenIdle`). Keep it working as the "empty move" kind of pass this task requires, alongside planning a real move.
> - **There is no per-square storage yet**: deployments are facts per spawn point and the viewport read lays armies out from them. This task introduces the per-square layer; a landed army's pieces must be read from it (or from the layout until first touched) without changing what `getPiecesIn`/the registry return for an untouched army.
> - **At a table the seat is still the ACCOUNT** (pass-only) until `chess-tables`; do not try to make account seats move.

## Acceptance criteria

- [ ] Each piece type moves exactly as described, with the slider cap, pawn direction and two-square first move; castling, en passant and promotion are rejected.
- [ ] A king may move onto an attacked square, never to a square adjacent to another king's start-of-cycle square, but may move onto that king's square.
- [ ] Every contract route stays under 24,576 bytes deployed, checked by a test (split routes or use a library if needed); the worst-case reveal (a 7-square slider path through squares idle for many cycles) fits the reveal gas budget.
- [ ] An army submitting a second move in one cycle is rejected; both kinds of pass leave the army in place.
- [ ] Reading a square after several idle cycles gives the same result as resolving cycle by cycle.
- [ ] The client highlights legal destinations through the simulation route and the committed move lands after the reveal.
- [ ] Tests cover the new behaviour.

## Blocked by

- `chess-army-deployment`

## Prompt

Goal: build the task above ("Chess moves: one move per army per cycle, validated against the start-of-cycle board"), covering user stories 9, 10, 11, 12, 16, 17, 18, 19, 20 of the spec `infinite-chess`. The "What to build" and "Acceptance criteria" sections above are the brief; "done" is every criterion met with the `verify` gate green.

Read first: `AGENTS.md` (the Svelte conventions, the framework boundary, the commit-reveal rules), `CONTEXT.md` (the framework glossary and this game's words: army, move, spawn point, deployment, exit, capture, merge, collision, capture loop, freeze), the spec `work/specs/tasked/infinite-chess.md` (its user stories), and the ADRs in `docs/adr/`. In particular `0002-order-free-lazy-resolution.md` (reveals only accumulate order-free facts, every square resolves lazily, no rule may make a piece bounce back) and `0007-rules-live-only-in-the-contract.md` (the chess rules are `pure` contract code; the client reaches them only through the simulation route, `$lib/game/simulation`, and reads the board through a contract view that resolves lazily over a viewport; no TypeScript copy of the rules, no indexer for state).

The contracts build on the commit-reveal base (`contracts/src/commit-reveal/`) through its seams (`_playerOf`, `_forfeit`, `_cycle`) and the game's own routes behind the router (`contracts/src/game/`). The pattern to follow is a `pure` rule, a load/apply split around it, and a simulation route that exposes the rule to the client. The template's reference game (`placement`) showed it until `chess-army-deployment` replaced it with chess; follow the chess code from then on, and its order-independence test in `contracts/test/js/` (which replaces the template's `Game.test.ts`). Two budgets bind every contract change: the declared reveal gas (`contracts/test/js/GasBudget.test.ts`; a reveal that runs out of gas is a missed reveal, which FREEZES the army) and the 24,576-byte deployed size of each route. The acceptance gate is `verify` in `dorfl.json`; it must be green.

FIRST, check this task against current reality (it is a launch snapshot and may have DRIFTED): does it still match the code in `work/tasks/done/`, the relevant ADRs, and the tasks it depends on? If a dependency landed differently than this task assumes, or an ADR superseded an assumption here, do NOT build on the stale premise: route the task to needs-attention with the discrepancy as the reason (WORK-CONTRACT.md "Drift is a needs-attention signal"). Building on a stale task produces wrong-but-compiling work.

RECORD non-obvious in-scope decisions you make while building, in a `## Decisions` block at the end of your FINAL REPORT. When the task did not specify some behaviour and you have to CHOOSE, do not leave the choice silent for a reviewer to reverse-engineer. That block is the ONE sanctioned channel for build-time rationale, and the runner transcribes it verbatim into the done record. So do NOT try to write the done record, the commit message, or the PR body yourself (you do no git and must not edit the task body), and do NOT open a `work/notes/observations/decisions-<slug>.md` note. If the choice meets the ADR gate (hard to reverse + surprising without context + a real trade-off, see `work/protocol/ADR-FORMAT.md`), ALSO write the durable WHY as an ADR in `docs/adr/` (next free number) and name it in the block.

---

### Claiming this task

```sh
# atomically claim it (works with a GitHub remote OR a local --bare remote):
dorfl claim chess-moves --arbiter <remote>      # default --arbiter origin
# then start work on the updated main:
git fetch <remote> && git switch -c work/chess-moves <remote>/main
# on completion, in the work branch's PR/merge:
git mv work/tasks/ready/chess-moves.md work/tasks/done/chess-moves.md
```

## Applied answers 2026-11-05

### q1: 'task:chess-moves' was bounced — how should we proceed?

keep. Retry the build. The previous attempt died with "Response was truncated: the model reached its output token limit" (the miro MCP OAuth line is harness noise, ignore it), and nothing was saved. Write large files INCREMENTALLY: create a file with a skeleton, then grow it with several edit calls of at most about 300 lines each; never emit a single tool call or final message longer than that. Keep the final report short (a summary plus the Decisions block).
