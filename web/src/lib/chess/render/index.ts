/**
 * WHICH RENDERER THIS GAME USES. The one file to edit to change it.
 *
 * The IMMEDIATE canvas-2d host (`$lib/game/render/canvas2d`), redrawing the
 * board every frame from the view state. Chess on an infinite board is a few
 * glyphs per square and nothing animated yet, so a scene graph buys nothing,
 * and this host needs no art pipeline. Both hosts take the same props, so
 * `routes/play/+page.svelte` does not change with the choice
 * (`web/test/render-host-boundary.test.ts`).
 */
import type {GameRenderer} from '$lib/game/core/seams';
import type {ViewStateStore} from '$lib/view';
import type {BoardView} from '../view';
import {createChessBoardRenderer} from './board';

/**
 * What the mounted surface hands the renderer, named once so no other module
 * mentions a rendering library.
 */
export type GameSurface = CanvasRenderingContext2D;

/** Loaded dynamically, and only in the browser: see `routes/play/+page.svelte`. */
export const loadCanvasComponent = () =>
	import('$lib/game/render/canvas2d/Canvas2DCanvas.svelte');

export function createGameRenderer(params: {
	viewState: ViewStateStore<BoardView>;
}): GameRenderer<GameSurface> {
	return createChessBoardRenderer(params);
}
