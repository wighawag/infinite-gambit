---
title: 'Piece states on the wooden board: frozen armies in ice, a wax seal on a committed king, stake plaques'
slug: chess-piece-states
spec: infinite-chess
blockedBy: [chess-pixi-switch]
covers: [36, 46]
---

## What to build

Give the board's states their wooden-set look, as prototyped in `spikes/pixi-wood-board/` (`screenshots/pieces-states.png`). The finishes and the seal are already ported in `web/src/lib/chess/render/pixi/piece-art.ts` (`ice`, `stone`, `SEAL_SVG`) and `pieces.ts` (`PieceTextures.seal`).

- **A frozen army is in ice.** Already drawn by the pixi renderer (`view-model.ts`'s `lookOf`, from `BoardView.frozen`): what is left is making ice and stone read apart at a glance (see the criteria).
- **The king of an army that has committed this cycle wears a wax seal.** It shows that a move exists without revealing it, which is everything commit-reveal lets anyone know. "Has committed this cycle" is NOT in `BoardView` yet: add it from the chain (the commit-reveal base's commitments) through the existing onchain read, not by inference.
- **Stake labels as plaques.** `BoardView.kings[].stakeLabel` (from `chess-hud`) drawn as a small brass plaque under the king. A stone holds a stake too (`docs/adr/0014-...`, `BoardView.stones[].stakeLabel`): give it the plaque as well. Both replace the renderer's plain text labels.

## Acceptance criteria

- [ ] A frozen army is drawn in ice, distinct at a glance from stones and from live armies. Give ice a frost rim, or stones a darker granite, if they read alike: the spike notes the two finishes are close.
- [ ] A committed army's king shows the seal for exactly the cycle in which it committed, and it disappears at the next cycle.
- [ ] Kings and stones carry their stake as a plaque, matching the HUD's numbers.
- [ ] At low zoom, frozen armies are ice-coloured dots, and the seal and plaques are hidden.
- [ ] Tests cover the new view-state fact (committed this cycle) and the renderer's mapping from the view state to finishes.

## Blocked by

- `chess-pixi-switch`

## Prompt

Goal: frozen armies, committed kings and stake plaques drawn in the wooden-board style. The "What to build" and "Acceptance criteria" sections are the brief; "done" is every criterion met with the `verify` gate in `dorfl.json` green.

Read first: `web/src/lib/chess/render/pixi/README.md`, the chess pixi renderer (`web/src/lib/chess/render/pixi/renderer.ts`), `web/src/lib/chess/view.ts` (`BoardView`, `frozen`, `kings`), `spikes/pixi-wood-board/src/pieces.ts` (how the spike applied the `stone` and `ice` finishes and the seal), `docs/adr/0007-rules-live-only-in-the-contract.md` (facts come from the contract; nothing is inferred in the client) and `docs/adr/0014-...` (stones).

FIRST, check this task against current reality: the pixi renderer may already draw some of this, or differ from the spike. Route drift to needs-attention (WORK-CONTRACT.md "Drift is a needs-attention signal").

Work in small steps (one decision, then edit and run a test), and grow files with edits of at most about 300 lines.

RECORD non-obvious in-scope decisions in a `## Decisions` block at the end of your FINAL REPORT (the runner transcribes it into the done record). Do not write the done record, commit message or PR body yourself, and do not edit this task body.
