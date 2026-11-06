---
title: 'The wooden board: the game on the pixi host, with grained squares, inlaid exits and the turned piece set'
slug: chess-pixi-wood-board
blockedBy: []
covers: []
---

## What to build

Switch the game's renderer from the immediate canvas-2d host to the template's pixi host, and draw the board as the Devcon wooden set, following `spikes/pixi-wood-board/` (read its `HANDOFF.md` and `README.md` first).

Presentation only: the new renderer draws exactly what `BoardView` says, as the current one does, and decides nothing (ADR 0007).

- **Board:** procedural maple (light) and rosewood (dark) squares, each sampling its own window of one wood texture, with thin joins between squares.
- **Exits:** the Devcon inlay (the Ethereum logo as four triangles in the opposite wood, upright), baked once into a texture, with a soft breathing glow. Keep TODAY's rule (one square, `chess/exits.ts`), with the logo inside the square, behind a single size setting so a 2 x 2 exit stays a one-line switch.
- **Pieces:** the turned set from `assets/brand/game/pieces.json` (written by `pieces.py`).
  - Boxwood for the player's army, sheesham for the others.
  - The army colour on the band parts (collar and felt) and a glow under the piece.
  - Rocks (`army === 0n`) in stone, with no band and no glow.
  - The planned army (`ghost`) translucent.
  - Pieces stand on the lower part of their square and sort by row.
- **Highlights**, everything the canvas renderer draws today, restyled as in the spike:
  - the selected square;
  - destinations (a dot on an empty square, corner wedges on a capture);
  - the planned move as an arrow over the pieces;
  - the last cycle's collisions (a burst) and captures (a ring);
  - open spawn points as a marquetry frame, filled when picked.
- **Draw whatever else `BoardView` carries when you start.** `chess-hud` may have added frozen armies, attacked squares or stake labels by then. If it has, draw them too: attacked squares as the spike's red inner border, frozen armies greyed or in ice.
- **Low zoom:** below about 18 px per square, a flat low-contrast checker, pieces as dots in their army colour, and exits as small glowing logos.

## Acceptance criteria

- [ ] `web/src/lib/chess/render/index.ts` selects the pixi host. It is mounted with `smooth` on and the template grid off. `routes/play/+page.svelte` is unchanged, or changes only its host props.
- [ ] Every field of `BoardView` the canvas renderer drew is drawn by the pixi renderer (a checklist in the PR, one line per field).
- [ ] Exits appear where `exitsIn` says, as the inlay, at today's one-square rule.
- [ ] Rocks, the ghost army, the player's army and other armies are each visually distinct.
- [ ] Below the low-zoom threshold the board is a single tiling sprite and pieces are dots. Above it, the board is the pooled square sprites.
- [ ] No rule logic in the renderer (no move generation, no attack computation). The spike's `pseudoMoves` is not ported.
- [ ] Every texture this art creates uses linear filtering (the template's pixi `assets.ts` defaults to nearest).
- [ ] Tests cover what can be tested without a GPU: which square is light, exit placement for both sizes, the piece-part roles from `pieces.json`, the low-zoom switch, and the reconciler's add/update/remove of pieces.

## Blocked by

- None. It can start immediately. If `chess-hud` is in flight, coordinate on `render/board.ts`, which both touch: port whatever it adds.

## Prompt

Goal: the game drawn as the Devcon wooden board on the pixi host, as prototyped in `spikes/pixi-wood-board/`. Read `spikes/pixi-wood-board/HANDOFF.md` (constraints, decisions, pitfalls), then its `README.md` (each module and what to keep), then AGENTS.md, ADR 0007, `web/src/lib/game/render/README.md` (the stateful renderer and reconciler), `web/src/lib/game/render/pixi/` (the host) and `web/src/lib/chess/render/` (today's renderer, which defines what must be drawn).

Port the spike's `wood.ts`, `board.ts`, `exits.ts`, `overlays.ts` and the texture half of `pieces.ts` into `web/src/lib/chess/render/` (for example a `pixi/` subfolder). Then write the chess pixi renderer:
- The board and the exits follow the camera from `tick`.
- Pieces are keyed entities through `createStatefulRenderer`.
- Highlights are redrawn when the view state changes.

Drop the spike's camera, harness and fake moves: the host owns input, and the contract owns the rules.

The art is data: piece paths and roles come from `assets/brand/game/pieces.json`. Edit `pieces.py` and regenerate, never the JSON by hand.

FIRST, check this task against current reality (it is a launch snapshot and may have DRIFTED). If `BoardView`, the pixi host or the exit rule changed since the spike, route the discrepancy to needs-attention rather than building on a stale premise.

RECORD non-obvious decisions in a `## Decisions` block at the end of your final report, as the task template asks.
