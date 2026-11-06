# The wooden board on pixi (built, not selected yet)

The Devcon wooden board, ported from `spikes/pixi-wood-board/` (see its `HANDOFF.md` and `README.md`) and written as a chess renderer on the template's pixi host. **The game does not use it yet:** `../index.ts` still selects the canvas-2d renderer. Selecting this one is the task `chess-pixi-switch` (`work/tasks/`), which waits for the lean-rules board (`lean-rules-square-army-on-a-9-grid`) because that changes what has to be drawn and edits the canvas renderer meanwhile.

| File                       | What it is                                                                                                                                                                       | Needs              |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `renderer.ts`              | `createChessPixiRenderer`: pieces as reconciler entities (`createStatefulRenderer`), the board and exits following the camera from `tick`, highlights and labels on view change. | pixi               |
| `view-model.ts`            | Everything drawn, worked out from `BoardView` as plain data: piece looks, exit blocks, highlights, labels, CSS colours as tints.                                                 | nothing (pure)     |
| `WoodenBoardCanvas.svelte` | The pixi host mounted with smooth art and no template grid, taking exactly the props the play page passes.                                                                       | pixi               |
| `wood.ts`                  | Procedural maple and rosewood. `woodPixels` is pure; `woodCanvas` wraps it.                                                                                                      | DOM for the canvas |
| `squares.ts`               | Board geometry: light squares, the per-square hash, the low-zoom thresholds and checker placement, where an exit's inlay goes.                                                   | nothing (pure)     |
| `board.ts`                 | `WoodBoard`: the pooled square sprites, joins, and the flat tiling checker at low zoom.                                                                                          | pixi               |
| `piece-art.ts`             | The turned set as SVG from `pieces.json`: kinds, part roles, finishes (boxwood, sheesham, stone, ice), the wax seal.                                                             | nothing (pure)     |
| `pieces.ts`                | `PieceTextures`: rasterises and caches piece textures (async: `peek`, `get`, `preload`), plus the glow and the low-zoom dot.                                                     | pixi, DOM          |
| `exits.ts`                 | `ExitLayer`: the inlay baked on a 2d canvas per span and top-left colour, its breathing copy and glow. Takes exits from the caller.                                              | pixi               |
| `overlays.ts`              | Highlights as two `Graphics` (under and over the pieces), from `view-model.ts`'s `OverlayModel`.                                                                                 | pixi               |
| `pieces.json`              | A copy of `assets/brand/game/pieces.json`. Edit `pieces.py`, copy, then `pnpm format` (prettier reformats the copy); a test fails if the contents differ.                        |                    |

Choices that are not obvious from the code:

- **No exit rule here.** Which squares are exits is `$lib/chess/exits.ts`'s, mirroring the contract; `exitBlocks` only groups them. The spike's own 2 x 2 formula (offsets half - 1 and half) disagrees with ADR 0015 (half and half + 1) and is not ported.
- **The inlay is baked on a 2d canvas**, not with pixi masks and `renderer.generateTexture` as in the spike: the host gives a renderer only its world `Container`, not pixi's `Renderer`. It is baked per top-left colour because at an odd spacing the colour alternates from exit to exit.
- **A stone is the king's silhouette in stone, keeping the band of the army it was**, since it still holds that army's stake (ADR 0014). A frozen army is in ice.
- **Attacked squares are shown only where they matter**: around the player's kings, on the selection's destinations and on the planned target; all of them while the player has no king on the board.
- **Colours are converted to tints here** (`cssColourToHex`), rather than relying on pixi's parser for `armyColour`'s `hsl(...)`.
- Not ported from the spike: its `PieceLayer`, camera and harness (the reconciler and the host own those), and its fake move generator (moves come from the contract, ADR 0007).

Every texture made here sets `scaleMode: 'linear'`, because `$lib/game/render/pixi/assets.ts` makes `nearest` the global default (except the flat checker, where each texel is a square).
