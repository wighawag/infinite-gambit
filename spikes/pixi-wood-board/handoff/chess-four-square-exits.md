---
title: 'Four-square exits: the exit is the 2 x 2 block the Ethereum inlay covers'
slug: chess-four-square-exits
spec: infinite-chess
needsAnswers: true
blockedBy: [chess-pixi-wood-board]
covers: [32]
---

<!-- open-questions -->

## Open questions

1. **Does the owner approve the rule change?** Ask only after reporting the assessment in question 2. The owner has said that two kings landing on different squares of one exit in the same cycle is fine (each square follows the collision table, and both kings exit).
2. **Assessment, for the implementer to write before anything is built:**
   - the gas and route-size cost of the wider `_isExit` in the reveal path (`GasBudget.test.ts`, `RouteSizes.test.ts`);
   - what changes in `Exits.test.ts`;
   - whether any rule reads "the exit square" as a single square (exit payout, rocks, footprints, the king-adjacency rule validated against the start-of-cycle board);
   - whether tables (no exits) are untouched;
   - what the minimap needs.

<!-- /open-questions -->

## What to build

Today an exit is one square, the centre of each spawn-grid cell (`UsingGameBoard._isExit`, `web/src/lib/chess/exits.ts`). Make it the 2 x 2 block whose shared corner is that centre: on each axis, accept `(v - half) % spacing` equal to `0` OR `spacing - 1`. That's the block the Devcon inlay covers exactly, one triangle per square. It's harder to camp than a single square, and a king has four ways in.

The spike's `spikes/pixi-wood-board/src/exits.ts` has the client-side form (`isExitSquare`, `exitCentres`, both sizes) and the renderer switch (`size: 4`). Press `E` in the spike to compare the two sizes.

## Acceptance criteria

- [ ] `_isExit` and the client's `isExitSquare` / `exitsIn` agree on the 2 x 2 block, with a test pinning that agreement for negative and positive coordinates.
- [ ] A king landing alone on any of the four squares exits. A collision on one of them follows the collision table. Two kings landing on two different squares of the block in the same cycle both exit.
- [ ] Reveal gas stays within the declared budget, and route sizes stay under the limit.
- [ ] The renderer draws the inlay across the block, and the minimap marks it.
- [ ] Tests cover the new behaviour (extend `Exits.test.ts`).

## Blocked by

- `chess-pixi-wood-board`, for the renderer half. The contract half could go first if approved.

## Prompt

Goal: assess, then (if approved) implement, exits as 2 x 2 blocks. Read `spikes/pixi-wood-board/HANDOFF.md` ("Not decided yet: exit size"), ADR 0006 and ADR 0011, the exit code (`UsingGameBoard._isExit`, the exit resolution, `chess/exits.ts`) and `contracts/test/js/Exits.test.ts`.

Answer open question 2 in writing first and stop for the owner's decision (question 1). Do not change the rule without it.

FIRST, check this task against current reality: route drift to needs-attention.

RECORD non-obvious decisions in a `## Decisions` block at the end of your final report.
