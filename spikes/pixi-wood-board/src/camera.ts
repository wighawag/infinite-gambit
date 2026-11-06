/**
 * The camera, with the same contract as the game's pixi host
 * (`web/src/lib/game/render/view-transform.ts` and `pixi/world.ts`): a centre
 * in GAME UNITS (squares) and a scale in screen pixels per square, applied to a
 * world container whose content is authored in pixels at `cellSize` per square.
 *
 * In the game the host owns this and the input; here it is a minimal stand-in
 * so the spike can be panned and zoomed. Only `applyTransform` and
 * `visibleCells` would survive the move into the game.
 */
import type {Container} from 'pixi.js';
import type {VisibleCells} from './board';

export type ViewTransform = {centerX: number; centerY: number; scale: number};

export const MIN_SCALE = 4;
export const MAX_SCALE = 220;

export function applyTransform(world: Container, t: ViewTransform, screen: {width: number; height: number}, cellSize: number): void {
	world.scale.set(t.scale / cellSize);
	world.position.set(screen.width / 2 - t.centerX * t.scale, screen.height / 2 - t.centerY * t.scale);
}

/** Squares whose centres are within the screen, plus one of margin. */
export function visibleCells(t: ViewTransform, screen: {width: number; height: number}): VisibleCells {
	const halfW = screen.width / 2 / t.scale;
	const halfH = screen.height / 2 / t.scale;
	return {
		left: Math.floor(t.centerX - halfW) - 1,
		right: Math.ceil(t.centerX + halfW) + 1,
		top: Math.floor(t.centerY - halfH) - 1,
		bottom: Math.ceil(t.centerY + halfH) + 1,
	};
}

/** Pointer drag to pan, wheel and pinch to zoom about the pointer. */
export function attachControls(canvas: HTMLCanvasElement, t: ViewTransform, onChange: () => void): void {
	const pointers = new Map<number, {x: number; y: number}>();
	let pinch = 0;

	function zoomAbout(px: number, py: number, factor: number) {
		const rect = canvas.getBoundingClientRect();
		const ox = (px - rect.left - rect.width / 2) / t.scale;
		const oy = (py - rect.top - rect.height / 2) / t.scale;
		const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, t.scale * factor));
		const real = next / t.scale;
		t.centerX += ox * (1 - 1 / real);
		t.centerY += oy * (1 - 1 / real);
		t.scale = next;
		onChange();
	}

	canvas.addEventListener('pointerdown', (e) => {
		canvas.setPointerCapture(e.pointerId);
		pointers.set(e.pointerId, {x: e.clientX, y: e.clientY});
	});
	canvas.addEventListener('pointermove', (e) => {
		const last = pointers.get(e.pointerId);
		if (!last) return;
		if (pointers.size === 1) {
			t.centerX -= (e.clientX - last.x) / t.scale;
			t.centerY -= (e.clientY - last.y) / t.scale;
			onChange();
		}
		pointers.set(e.pointerId, {x: e.clientX, y: e.clientY});
		if (pointers.size === 2) {
			const [a, b] = [...pointers.values()];
			const distance = Math.hypot(a.x - b.x, a.y - b.y);
			if (pinch) zoomAbout((a.x + b.x) / 2, (a.y + b.y) / 2, distance / pinch);
			pinch = distance;
		}
	});
	const release = (e: PointerEvent) => {
		pointers.delete(e.pointerId);
		pinch = 0;
	};
	canvas.addEventListener('pointerup', release);
	canvas.addEventListener('pointercancel', release);
	canvas.addEventListener(
		'wheel',
		(e) => {
			e.preventDefault();
			zoomAbout(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015));
		},
		{passive: false},
	);
}
