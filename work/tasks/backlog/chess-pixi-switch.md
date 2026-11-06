---
title: 'Switch the game to the wooden board on the pixi host'
slug: chess-pixi-switch
blockedBy: [lean-rules-square-army-on-a-9-grid]
covers: []
---

## What to build

The wooden board's pixi renderer is BUILT but not selected: `web/src/lib/chess/render/pixi/` (its `README.md` lists every module; `renderer.ts` is `createChessPixiRenderer`, and `WoodenBoardCanvas.svelte` mounts the template's pixi host with smooth art and no grid). It draws every field of `BoardView` the canvas renderer draws (pieces, stones, the ghost army, frozen armies, spawn points, selection, destinations, the planned move, attacked squares, outcomes, exits, king and stone stake labels) and the low-zoom view. It was smoke-tested by hand in the offline world on the pre-9-grid board (boots, no console errors, wood, pieces, selection, destinations and low zoom all draw).

This task makes it the game's renderer, once the 9-grid board has landed, and fixes what that board changed:

- **Switch the host** in `web/src/lib/chess/render/index.ts`: `GameSurface` becomes pixi's `Container`, `loadCanvasComponent` loads `./pixi/WoodenBoardCanvas.svelte`, and `createGameRenderer` returns `createChessPixiRenderer`. It needs `cellSize` (the host's, `config.cellSize`, 16 today) and `spawnFrameHalf` (half the footprint's side: 2.5 for the 5 x 5 army; the renderer was smoke-tested with 3.5, the old 7 x 7 frame). Pass them from `chess/context.ts` where it calls `createGameRenderer`, or read the footprint from wherever the 9-grid task put it. Keep the canvas renderer (`render/board.ts`) in the tree as the fallback.
- **Keep the asset pipeline out of the brand folder.** AssetPack (`web/vite.assetpack.ts`) takes the whole repo-root `assets/` as game assets, and the pixi host's `LoadingGate` loads its manifest, so it tries to load `assets/brand/**` (`README.md`, `pieces.py`, `build.sh`, ... with PixiJS warnings in the console). Exclude `assets/brand/` from AssetPack (through `vite.plugins.ts` if the template file should stay untouched) or move the brand folder out of `assets/`.
- **Check the renderer against the 9-grid board.** Exits: `view-model.ts`'s `exitBlocks` groups whatever `$lib/chess/exits.ts` returns into blocks, so a 2 x 2 block should draw as one inlay with no change; verify it, including blocks whose top-left square is dark (they alternate at spacing 9). Anything the 9-grid task changed in `render/board.ts` or `render/style.ts` that the pixi renderer does not do yet: port it.
- **Minimap:** mark an exit as its block, as the board does.

## Acceptance criteria

- [ ] `web/src/lib/chess/render/index.ts` selects the pixi host through `WoodenBoardCanvas.svelte`; `routes/play/+page.svelte` is unchanged and `web/test/render-host-boundary.test.ts` passes.
- [ ] Opening the play page logs no PixiJS asset warnings for `assets/brand/`.
- [ ] Exits draw one inlay per 2 x 2 block, with the right woods on blocks whose top-left square is dark; the spawn frames match the 5 x 5 footprint.
- [ ] A checklist in the final report, one line per `BoardView` field, says where the pixi renderer draws it, including anything the 9-grid task added.
- [ ] The e2e suites pass if the environment can run them (they click the `<canvas>`, which pixi renders into too); say in the report whether you ran them.
- [ ] No rule logic in the renderer (ADR 0007).

## Blocked by

- `lean-rules-square-army-on-a-9-grid`: it changes the exit rule, the spacing, the army's shape and the footprint, and it edits the canvas renderer; switching before it lands would put its client work on a renderer nobody sees.

## Prompt

Goal: make the wooden board the game's renderer. The "What to build" and "Acceptance criteria" sections are the brief; "done" is every criterion met with the `verify` gate in `dorfl.json` green.

Read first: `web/src/lib/chess/render/pixi/README.md`, then `renderer.ts`, `view-model.ts` and `WoodenBoardCanvas.svelte` in that folder; `web/src/lib/chess/render/index.ts` (the one file that chooses the host); `web/src/lib/game/render/README.md` ("Switching renderer", the stateful renderer); `AGENTS.md` (Svelte conventions; do not edit `web/src/lib/core` or the template's `game/render` modules); `docs/adr/0007` and `0015`; and the done record of `lean-rules-square-army-on-a-9-grid` for what it changed on the client.

FIRST, check this task against current reality: has `lean-rules-square-army-on-a-9-grid` landed? Does the pixi renderer still type-check and its tests (`web/test/lib/chess/render/pixi/`) still pass against the new `BoardView`? If the 9-grid task changed something this task assumes, route it to needs-attention with the discrepancy (WORK-CONTRACT.md "Drift is a needs-attention signal").

To see the board, run the dev server and open `/offline/` (three seats, sit down); stop the dev server's process group when done.

Work in small steps (one decision, then edit and run a test), and grow files with edits of at most about 300 lines.

RECORD non-obvious in-scope decisions in a `## Decisions` block at the end of your FINAL REPORT (the runner transcribes it into the done record). Do not write the done record, commit message or PR body yourself, and do not edit this task body.
