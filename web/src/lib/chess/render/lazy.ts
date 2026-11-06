import type {Frame, GameRenderer} from '$lib/game/core/seams';

/**
 * A renderer whose code is loaded on demand, so a build that never selects it
 * does not carry its library (pixi.js) in the main bundle.
 *
 * Loading starts at the FIRST `onAppStarted`, not at creation: the renderer is
 * created while the game context is built, which happens on every route and on
 * the server too, and neither should load a rendering library.
 *
 * Frames before the real renderer has started are dropped, and a stop that
 * arrives while it is still loading wins: that start never reaches it. A load
 * that fails is logged and forgotten, so the next start tries again.
 */
export function lazyRenderer<TSurface>(
	load: () => Promise<GameRenderer<TSurface>>,
): GameRenderer<TSurface> {
	let loading: Promise<GameRenderer<TSurface>> | undefined;
	let real: GameRenderer<TSurface> | undefined;
	let generation = 0;

	return {
		onAppStarted(surface) {
			const started = ++generation;
			const current = (loading ??= load());
			current.then(
				(renderer) => {
					if (started !== generation) return;
					real = renderer;
					renderer.onAppStarted(surface);
				},
				(error) => {
					if (loading === current) loading = undefined;
					// Every pending start sees this failure; only the latest reports it.
					if (started === generation) {
						console.error('the renderer failed to load', error);
					}
				},
			);
		},
		onAppStopped() {
			generation++;
			const was = real;
			real = undefined;
			was?.onAppStopped();
		},
		tick(frame: Frame) {
			real?.tick(frame);
		},
	};
}
