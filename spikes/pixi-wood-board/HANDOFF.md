# Handoff: bring the wooden board into the game

For the agent implementing it. Read this first, then the three task drafts in `handoff/`. Everything you need is in this folder and the repo; no conversation history is required.

## What this is

`spikes/pixi-wood-board/` is a working pixi.js 8 prototype of how Infinite Gambit should look, after the Devcon swag board. It shows:
- maple and rosewood squares, procedurally grained;
- exits drawn as the Ethereum marquetry inlay, glowing;
- turned Staunton pieces: boxwood for the player's army, sheesham for every other army, unicorn knights, a crystal prism on each king;
- army colour painted on the collar band and the felt pad, plus a soft glow under the piece;
- highlights, rocks in stone, frozen armies in ice, and a wax seal on the king of an army that has committed;
- a flat map view when zoomed far out.

It runs on its own (`pnpm install --ignore-workspace && pnpm dev` in this folder) with a fake scene and a fake move generator. The screenshots are in `screenshots/`, and `README.md` explains each module and the decisions behind it.

**The spike is a reference, not a library.** Port its modules into `web/`; don't import from `spikes/`. The spike folder is not part of the workspace and may be deleted once the work lands.

## Where the game is today

- `web/src/lib/chess/render/index.ts` selects the **immediate canvas-2d** host and `createChessBoardRenderer` (`render/board.ts`).
  - It draws every `BoardView` field (`web/src/lib/chess/view.ts`): pieces (keyed by position, rocks are `army === 0n`), `spawnPoints` and the picked one (`planned`), `ghost` (the planned army, translucent), `selected`, `destinations`, `plannedMove`, `outcomes` (collisions and captures of the last cycle), and exits (`exitsIn`, from `chess/exits.ts`).
  - Pieces are coloured discs with Unicode glyphs (`render/style.ts`): yours in `YOUR_COLOUR`, others in `armyColour(army)`, rocks in `ROCK_COLOUR`.
- The template's **pixi host** is already in the tree, with the same props as the canvas one: `web/src/lib/game/render/pixi/PixiCanvas.svelte` (`showGrid`, `smooth`, `cellSize`, `gridCells`).
  - It gives the renderer a world `Container`, already transformed by the camera (`pixi/world.ts`, `applyTransform`, content in pixels at `cellSize` per square).
  - It also provides the **stateful** renderer and its reconciler (`web/src/lib/game/render/stateful.ts`, `reconcile.ts`, documented in `web/src/lib/game/render/README.md`).
  - `pixi.js` is already a dependency of `web`.

## Rules you must keep

- **No game rule in the client** (ADR 0007, `docs/adr/0007-rules-live-only-in-the-contract.md`).
  - The renderer draws what the view state says and decides nothing.
  - Destinations and attacks come from the contract via `$lib/game/simulation`.
  - The spike's `pseudoMoves` in `main.ts` is a demo fake: do NOT port it.
- **Svelte files stay logic-minimal** (AGENTS.md): renderer logic lives in `.ts` modules.
- **Don't edit `web/src/lib/core` or the template's `game/render` modules** for this game's convenience (AGENTS.md). Select the pixi host from `chess/render/index.ts`, which is the one file meant for that choice, and put the chess pixi renderer under `web/src/lib/chess/render/`.
- **Texture filtering:** `web/src/lib/game/render/pixi/assets.ts` sets `TextureStyle.defaultOptions.scaleMode = 'nearest'` globally when it's imported (the template's art is pixel art). This art is smooth, so every texture you create must say `scaleMode: 'linear'`.
  - The spike's canvas textures already do.
  - So does the baked inlay (`renderer.generateTexture` in `exits.ts`, which sets `texture.source.scaleMode = 'linear'` after baking). Keep that line when you port it.
  - Mount the host with `smooth={true}` and `showGrid={false}` (the wood draws its own joins).
- **The acceptance gate is `dorfl.json`'s `verify`.** Run `node scripts/check-dangling-imports.mjs` too (AGENTS.md).

## Decided

- **Look:**
  - Maple light squares and rosewood dark squares, `(x + y)` even is light, as today.
  - The player's army is boxwood; every other army is sheesham.
  - The army colour (`armyColour`, or `YOUR_COLOUR`) shows on the collar band, the felt pad and a glow under the piece.
  - Rocks are stone with no band and no glow. A frozen army is ice, keeping its band.
  - The planned army (`ghost`) stays translucent.
- **Exits** are drawn as the Devcon inlay: the Ethereum logo as four triangles, one per square, each in the OPPOSITE wood to its square, upright. Plus a soft glow and a slow "breathing" pulse.
- **Low zoom:** below about 18 screen pixels per square, the board becomes a flat low-contrast checker (one `TilingSprite`), pieces become dots in their army colour, and exits shrink to small glowing logos.
- **Piece art is data:** `assets/brand/game/pieces.py` writes `pieces.json` (paths, part roles `wood` / `band` / `prism`, woods, inlay triangles). It is the source of truth for both the brand mock and the game. Copy it next to the renderer, or import it from `assets/brand/game/`, and keep `pieces.py` as the only place it's edited.

## Not decided yet: exit size

Exits are **one square** today (`UsingGameBoard._isExit`, `chess/exits.ts`): the centre of each spawn-grid cell. The proposal is **four squares**, the 2 x 2 block whose shared corner is that centre. That's where the inlay fits exactly, and it's harder to camp. This is a **rule change**, and the owner wants your view before deciding.

What the owner has settled: two kings landing on different squares of the same 4-square exit in the same cycle is fine. Each square follows the collision table and both kings exit.

So:
- **Build the visuals at today's one-square rule first** (task 1). The spike's `exits.ts` supports both sizes behind one setting (`size: 1 | 4`).
- **Report your assessment of the 4-square change** in task 3's open questions: cost in the contract (gas, route sizes), tests, minimap, and anything in the rules it interacts with.

## The work, as three tasks

Drafts in this folder's `handoff/`, in the repo's task format (`work/protocol/task-template.md`). File them under `work/tasks/backlog/` for promotion. They are ordered.

1. **`chess-pixi-wood-board`**: switch the game to the pixi host with the wooden board, the turned pieces, the inlaid exits (one square) and every highlight the canvas renderer draws today, plus low zoom. Presentation only; nothing outside `web/src/lib/chess/render/` and `render/index.ts` should need to change.
2. **`chess-piece-states`**: frozen armies in ice and the wax seal on a committed army's king. This needs two facts the `BoardView` doesn't carry yet (which armies are frozen, which have committed this cycle), so it touches the view state.
3. **`chess-four-square-exits`** (`needsAnswers`): the rule change, only if the owner approves it after your assessment.

## Pitfalls the spike already hit

- Sprite masks are expensive. The inlay is masked wood, so **bake it once** into a texture and reuse it for every exit (`exits.ts`).
- Pieces are rasterised from SVG, which is **async** (`image.decode()`), while the stateful renderer's `add` is synchronous.
  - Preload the textures for every kind and finish of an army the first time its colour appears.
  - Or create the sprite with a placeholder and set the texture when it resolves.
  - Cache by `kind|finish|colour`.
- `armyColour` returns an `hsl(...)` string. That's fine inside the SVG. For a pixi `tint`, check that `Color` accepts it, and convert to hex if not.
- A full-contrast flat checker **shimmers** at a few pixels per square. Keep the low-zoom checker low-contrast (`board.ts`).
- Exit glows at low zoom must shrink and fade (`exits.ts`), or a field of exits becomes a polka-dot pattern.
- In the overlay, show **attacked squares only where they matter** (around your king, on the selection's destinations, on the planned target). Shown everywhere they're noise. The attack data itself must come from the contract.
