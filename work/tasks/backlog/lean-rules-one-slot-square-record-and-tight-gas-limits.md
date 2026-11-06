---
title: 'Lean rules, cost: a square record in one slot, cheaper square reads, and tight gas limits'
slug: lean-rules-one-slot-square-record-and-tight-gas-limits
spec: lean-rules
blockedBy: [lean-rules-square-army-on-a-9-grid]
covers: [20, 21]
---

## What to build

The last slice of the `lean-rules` spec: make an ordinary move cheap now that the rules no longer need what made it dear, and declare gas limits close to what a reveal costs. Cut on the measured numbers in `docs/gas.md` (`gas-profile-of-a-plain-move`, 2026-11-06), not on estimates.

1. **A square record in ONE storage slot** (`docs/gas.md` item 1, the largest cut: about 50,000 per reveal). Give each army a compact index (for example uint32) when it is created, written once (one slot per army), and store that index instead of the 256-bit army ids in the square record (the standing army, the arriver's army, the arriving king's army). With `forward`, `moved` and the facings already gone (the board task), the record's fields fit one slot. The 256-bit army identity stays what the commit-reveal base and the client use (the framework's `player`); only storage holds the index. Write the record once per touch rather than field by field where that is cheaper.
2. **The spawn record and the army record in fewer slots** (items 5 and 6): the spawn record's army as an index in its packed slot; the army record's fields (owner, the king's last move, the fall cycle and captor index from the captures task, the flags) packed so a reveal and a commit read as few slots as they can.
3. **Cheaper square reads** (item 2): the squares one move reads almost always share one covering spawn point and one army, so compute the covering spawn point, its layout and the vanish/exited answers once per reveal instead of once per square read. Measure what it saves.
4. **The commit's checks** (item 7): with capture loops gone, `_playerOf`/`_ownerOf` and `_isDead` read only what they need (the army record and one slot of the king's square).
5. **Tight gas limits.** Re-measure and lower `COMMIT_GAS`, `REVEAL_GAS` and `LOBBY_REVEAL_GAS` in `contracts/rocketh/config.ts` to the measured worst case plus `GasBudget.test.ts`'s minimum headroom, with its generosity ceiling still enforced. Update the comments above them (they still describe merge chains and capture loops). Say in the Decisions block what each figure was, what it is now, and the worst case that sets it.
6. **Re-run the gas profile** and update `docs/gas.md` with the new breakdown, on the test and the production builds, so it stays the truth.

Out of scope (`docs/gas.md` items 3, 8, 9): removing the zone index (it serves the viewport read and needs a design of its own), the proxy and router dispatch, and packing the capture candidate list; leave them as `docs/gas.md` lists them unless one turns out trivial, and say so.

No rule changes: every order-replay test and every rules test passes unchanged in behaviour.

## Acceptance criteria

- [ ] A square record is one storage slot; armies are stored by a compact index written once per army; the 256-bit army identity is unchanged at every external surface (the base, events, views the client reads).
- [ ] The gas profile, re-run, shows each plain reveal (pawn, slider, king; fresh and touched) and the plain commit cheaper than in `docs/gas.md` of 2026-11-06, and `docs/gas.md` is updated with the new figures and what each change saved.
- [ ] `COMMIT_GAS`, `REVEAL_GAS` and `LOBBY_REVEAL_GAS` are lowered to the measured worst case plus the minimum headroom, `GasBudget.test.ts` passes with its headroom and generosity checks, and the comments above them describe the new worst cases.
- [ ] Every rules and order-replay test passes; the client's tests and the offline world tests pass unchanged in behaviour.
- [ ] `RouteSizes.test.ts` and `DeterministicDeploys.test.ts` stay green.

## Blocked by

- `lean-rules-square-army-on-a-9-grid` (the last rules slice: the record's fields, the fall cycle and the removed facing are only all known once the captures and board tasks have landed).

## Prompt

Goal: build the task above. The "What to build" and "Acceptance criteria" sections are the brief; "done" is every criterion met with the `verify` gate in `dorfl.json` green.

Read first: `AGENTS.md` (the commit-reveal rules, "renaming a persisted key or field" for why a storage change is free only before a deploy), `docs/gas.md` (the measured breakdown and the ranked savings this task acts on), the spec `work/specs/tasked/lean-rules.md`, `contracts/src/game/internal/UsingGameStore.sol` (the records), `UsingGameBoard.sol` (`_touch`, `_rawSquareAt`, `_laidAt`, `_spawnCovering`, `_exited`, the vanish check and `_ownerOf`), `UsingGameInternal.sol` (`_playerOf`, `_isDead`), `contracts/rocketh/config.ts` (the gas figures and their comments), `contracts/test/js/GasBudget.test.ts` and `contracts/test/js/GasProfile.test.ts` (how to measure; `GAS_PROFILE=slots` lists every slot).

FIRST, check this task against current reality: have the three earlier lean-rules tasks landed (no merges, stones in, no facing, the 5 by 5 army), and is the square record still four slots? If not, route the task to needs-attention with the discrepancy (WORK-CONTRACT.md "Drift is a needs-attention signal"). Run `git ls-files contracts/deployments`: if anything is deployed, a storage layout change is a wire change and needs a human; route to needs-attention.

Work in small steps (one decision, then edit and run a test), and grow files with edits of at most about 300 lines: earlier builds in this repo died on the 16,384-token output limit when a single reply tried to plan everything. Measure before and after each step with the gas profile.

RECORD non-obvious in-scope decisions in a `## Decisions` block at the end of your FINAL REPORT (the runner transcribes it into the done record). Do not write the done record, commit message or PR body yourself, and do not edit this task body.
