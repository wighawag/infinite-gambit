---
title: 'Piece states on the wooden board: frozen armies in ice, a wax seal on a committed king, stake plaques'
slug: chess-piece-states
spec: infinite-chess
blockedBy: [chess-pixi-wood-board, chess-hud]
covers: [36, 46]
---

## What to build

Give the board's states their wooden-set look, as prototyped in `spikes/pixi-wood-board/` (`pieces.ts`, `screenshots/pieces-states.png`):

- **A frozen army is in ice.** Its pieces keep their silhouette and their army colour on the band, the wood becomes pale ice, and the glow turns ice blue. The frozen fact comes from the contract's frozen view, as `chess-hud` sources it (it also counts an unsettled missed reveal).
- **The king of an army that has committed this cycle wears a wax seal** with a `#`. It shows that a move exists without revealing it, which is everything commit-reveal lets anyone know. "Has committed this cycle" is a fact the view state needs from the chain (the commit-reveal base's commitments); add it to `BoardView` through the existing onchain read, not by inference.
- **Stake labels** (from `chess-hud`) drawn in the board's style: a small brass plaque under the king, carrying the registry's stake.

## Acceptance criteria

- [ ] A frozen army is drawn in ice, distinct at a glance from both rocks (stone) and live armies. Give ice a frost rim, or rocks a darker granite, if they read alike: the spike notes they are close.
- [ ] A committed army's king shows the seal for exactly the cycle in which it committed, and it disappears at the next cycle.
- [ ] Kings carry their stake as a plaque, matching the HUD's numbers.
- [ ] At low zoom, frozen armies are ice-coloured dots, and the seal and plaques are hidden.
- [ ] Tests cover the new view-state facts (frozen, committed) and the renderer's mapping from them to finishes.

## Blocked by

- `chess-pixi-wood-board`
- `chess-hud`

## Prompt

Goal: frozen armies, committed kings and stake labels drawn in the wooden-board style. Read `spikes/pixi-wood-board/HANDOFF.md`, then `spikes/pixi-wood-board/src/pieces.ts` (the `stone` and `ice` finishes, the seal texture), then what `chess-hud` added to the view state, and ADR 0007 (facts come from the contract; nothing is inferred in the client).

FIRST, check this task against current reality: `chess-hud` may already draw some of this, and the renderer from `chess-pixi-wood-board` may differ from the spike. Route drift to needs-attention.

RECORD non-obvious decisions in a `## Decisions` block at the end of your final report.
