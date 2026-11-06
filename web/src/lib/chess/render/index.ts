/**
 * WHICH RENDERER THIS GAME USES. The one file that chooses it, from
 * `PUBLIC_RENDERER` (see `web/.env`):
 *
 * - `canvas` (the default, also when empty): the IMMEDIATE canvas-2d host
 *   (`$lib/game/render/canvas2d`), redrawing the board every frame from the
 *   view state. It needs no art pipeline.
 * - `pixi`: the wooden board (`./pixi/`, see its README) on the template's
 *   pixi host. Not the default yet: making it so is `chess-pixi-switch`.
 *
 * Read from `$env/dynamic/public`, as `../context.ts` reads its env, and only
 * when a function below is called: `test/lib/context/fatal.test.ts` (upstream,
 * kept identical) mocks `$env/static/public` with a fixed list of keys, so a
 * static import of a new key fails it. With adapter-static the value is the
 * one in the environment at build (prerender) time. The pixi side
 * is only ever reached through dynamic imports (`loadCanvasComponent` and
 * `lazyRenderer`), so a canvas build does not carry pixi.js in its main bundle,
 * and a pixi build loads it only on the play page. Both hosts take the same props, so
 * `routes/play/+page.svelte` does not change with the choice
 * (`web/test/render-host-boundary.test.ts` checks the first host named below,
 * `web/test/lib/chess/render/choice.test.ts` checks that both match).
 */
import {env} from '$env/dynamic/public';
import type {Container} from 'pixi.js';
import type {GameRenderer} from '$lib/game/core/seams';
import type {ViewStateStore} from '$lib/view';
import type {BoardView} from '../view';
import {PICK_RADIUS} from '../planning';
import {createChessBoardRenderer} from './board';
import {rendererChoice} from './choice';
import {lazyRenderer} from './lazy';

/** Which renderer `PUBLIC_RENDERER` names (`./choice.ts`). */
export const renderer = () => rendererChoice(env.PUBLIC_RENDERER);

/**
 * What the mounted surface hands the renderer, named once so no other module
 * mentions a rendering library. Either host's, depending on `renderer()`. The
 * union does not pair a renderer with its host at the type level (method
 * parameters are bivariant); `renderer()` below does, in this one file.
 */
export type GameSurface = CanvasRenderingContext2D | Container;

/**
 * Half the side of a spawn point's frame, in squares: the 5 x 5 footprint an
 * army deploys onto: two squares out from the spawn point (`PICK_RADIUS`),
 * plus the half square the outer ones reach past their centre.
 */
const SPAWN_FRAME_HALF = PICK_RADIUS + 0.5;

let pixiRenderer: Promise<typeof import('./pixi/renderer')> | undefined;

/** The pixi renderer's module, loaded once (and again after a failure). */
function loadPixiRenderer() {
	const loading = (pixiRenderer ??= import('./pixi/renderer'));
	loading.catch(() => {
		if (pixiRenderer === loading) pixiRenderer = undefined;
	});
	return loading;
}

/**
 * Loaded dynamically, and only in the browser: see `routes/play/+page.svelte`.
 *
 * The pixi host waits for the renderer's module as well, so it is evaluated
 * BEFORE the host creates its pixi `Application`. Pixi registers some render
 * pipes when their module is first imported, and an `Application` made before
 * that has no pipe for those objects: the board stays empty and pixi throws
 * reading `validateRenderable` of undefined.
 */
export const loadCanvasComponent = () =>
	renderer() === 'pixi'
		? Promise.all([
				import('$lib/chess/render/pixi/WoodenBoardCanvas.svelte'),
				loadPixiRenderer(),
			]).then(([host]) => host)
		: import('$lib/game/render/canvas2d/Canvas2DCanvas.svelte');

export function createGameRenderer(params: {
	viewState: ViewStateStore<BoardView>;
	spawnSpacing?: number;
	/**
	 * Pixels per square at 1:1, as the page mounts the host with
	 * (`config.cellSize`). Only the pixi renderer uses it.
	 */
	cellSize: number;
}): GameRenderer<GameSurface> {
	if (renderer() === 'pixi') {
		return lazyRenderer(() =>
			loadPixiRenderer().then(({createChessPixiRenderer}) =>
				createChessPixiRenderer({
					...params,
					spawnFrameHalf: SPAWN_FRAME_HALF,
				}),
			),
		);
	}
	return createChessBoardRenderer(params);
}
