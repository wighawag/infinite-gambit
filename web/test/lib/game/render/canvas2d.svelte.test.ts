import {describe, expect, it, vi} from 'vitest';
import {render} from 'vitest-browser-svelte';
import {writable} from 'svelte/store';
import type {ViewStateStore, ViewStateValue} from '$lib/game/core/seams';
import {createCamera} from '$lib/game/render/camera';
import {createCanvasEventEmitter} from '$lib/game/render/events';
import {createChessBoardRenderer} from '$lib/chess/render/board';
import type {BoardView, PieceView} from '$lib/chess/view';
import {squareAt} from '$lib/chess/squares';
import Harness from './Canvas2DHarness.svelte';

/**
 * The canvas-2d host, against a real canvas and real pixels.
 *
 * IT HAD NO TEST AT ALL, and nothing imported it, for the whole time it was the
 * template's second renderer. That is why this is a browser test that reads the
 * canvas back rather than a node test with a stub context: a fake context
 * records the calls you thought to fake, and every drift this file actually
 * found was a disagreement about coordinates, which a call recorder answers
 * with whatever you told it to.
 *
 * What it pins is the contract between the three pieces the host wires
 * together, because that is where the drift was: `beginFrame` sets up device
 * pixels, `applyCamera` maps game units onto them, and the renderer draws in
 * game units. A change to any one of them alone moves the board.
 */

const SIZE = {width: 240, height: 180};

/**
 * `#ffd166`: the colour this client's own army is drawn in, and the open
 * spawn points' outline.
 */
const YOURS = {r: 0xff, g: 0xd1, b: 0x66};
const BACKGROUND = {r: 0x0b, g: 0x10, b: 0x20};

type Colour = {r: number; g: number; b: number};

/** The army the tests play as. */
const YOU = 7n << 160n;

function piece(
	x: number,
	y: number,
	army = YOU,
	kind: PieceView['kind'] = 1,
): [bigint, PieceView] {
	const position = squareAt(x, y);
	return [position, {position, army, kind, position2d: {x, y}}];
}

/** `#8d8579`: a stone's tile (`$lib/chess/render/style.ts`). */
const STONE = {r: 0x8d, g: 0x85, b: 0x79};

function board(pieces: [bigint, PieceView][]): BoardView {
	return {
		pieces: new Map(pieces),
		spawnPoints: [],
		ghost: [],
		you: YOU,
		outcomes: [],
		outcomesCycle: -1,
	};
}

function setup(options: {showGrid?: boolean} = {}) {
	const store = writable<ViewStateValue<BoardView>>({step: 'Unloaded'});
	const viewState: ViewStateStore<BoardView> = {
		subscribe: store.subscribe,
		status: writable({loading: false}),
	};
	// A scale of exactly 5 CSS pixels per square, so a square's screen
	// position is arithmetic a reader can check by hand, and small enough that
	// the renderer draws a plain disc with no glyph over its middle.
	const {cameraControl} = createCamera({
		initialVisible: {width: SIZE.width / 5, height: SIZE.height / 5},
		limits: {minWidth: 1, minHeight: 1, maxWidth: 1000, maxHeight: 1000},
	});
	const renderer = createChessBoardRenderer({viewState});
	const eventEmitter = createCanvasEventEmitter();

	const screen = render(Harness, {
		cameraControl,
		renderer,
		eventEmitter,
		width: SIZE.width,
		height: SIZE.height,
		showGrid: options.showGrid ?? false,
	});
	// The ResizeObserver is asynchronous; seed the size so the first frame has
	// a surface to draw on. Same reason as `input.svelte.test.ts`.
	cameraControl.resize(SIZE.width, SIZE.height);

	const canvas = () => document.querySelector('canvas') as HTMLCanvasElement;
	return {store, cameraControl, canvas, screen};
}

/** The colour at a CSS-pixel position, read out of the device-pixel buffer. */
function pixelAt(canvas: HTMLCanvasElement, x: number, y: number) {
	const context = canvas.getContext('2d')!;
	const ratio = canvas.width / SIZE.width;
	const data = context.getImageData(
		Math.round(x * ratio),
		Math.round(y * ratio),
		1,
		1,
	).data;
	return {r: data[0], g: data[1], b: data[2], a: data[3]};
}

/** Where a game-unit point lands on screen, in CSS pixels. */
function screenOf(x: number, y: number) {
	return {x: SIZE.width / 2 + x * 5, y: SIZE.height / 2 + y * 5};
}

function isNear(actual: Colour, expected: Colour, tolerance = 4) {
	return (
		Math.abs(actual.r - expected.r) <= tolerance &&
		Math.abs(actual.g - expected.g) <= tolerance &&
		Math.abs(actual.b - expected.b) <= tolerance
	);
}

/** Wait for the host's `requestAnimationFrame` loop to paint. */
async function painted(check: () => void) {
	await vi.waitFor(check, {timeout: 2000, interval: 16});
}

describe('the canvas-2d host', () => {
	it('sizes its backing store in device pixels and paints the background', async () => {
		const {canvas} = setup();

		await painted(() => {
			const ratio = window.devicePixelRatio || 1;
			expect(canvas().width).toBe(Math.round(SIZE.width * ratio));
			expect(canvas().height).toBe(Math.round(SIZE.height * ratio));
			const at = pixelAt(canvas(), 4, 4);
			expect(at.a).toBe(255);
			expect(isNear(at, BACKGROUND, 2)).toBe(true);
		});
	});

	/**
	 * The load-bearing assertion in this file: the camera transform is the only
	 * thing that turns a square into pixels, and the renderer draws its pieces
	 * in screen space from that same transform.
	 */
	it('paints a piece where the camera says its square is', async () => {
		const {store, canvas} = setup();
		store.set({step: 'Loaded', cycleNumber: 1, ...board([piece(2, 1)])});

		await painted(() => {
			const at = screenOf(2, 1);
			expect(isNear(pixelAt(canvas(), at.x, at.y), YOURS)).toBe(true);
		});
		// And not over the whole square: its corner stays background.
		const corner = screenOf(2.48, 1.48);
		expect(isNear(pixelAt(canvas(), corner.x, corner.y), BACKGROUND)).toBe(
			true,
		);
	});

	it("draws a stone as a stone tile, not in its army's colour", async () => {
		const {store, canvas} = setup();
		store.set({
			step: 'Loaded',
			cycleNumber: 1,
			...board([piece(2, 1, YOU, 7)]),
		});

		await painted(() => {
			const at = screenOf(2, 1);
			expect(isNear(pixelAt(canvas(), at.x, at.y), STONE)).toBe(true);
		});
	});

	it('outlines an open spawn point', async () => {
		const {store, canvas} = setup();
		store.set({
			step: 'Loaded',
			cycleNumber: 1,
			...board([]),
			spawnPoints: [
				{spawnPoint: squareAt(0, 0), position: {x: 0, y: 0}, nearest: []},
			],
		});

		await painted(() => {
			// The outline runs round the footprint, three and a half squares out,
			// two pixels wide: read a pixel wholly inside it.
			const border = screenOf(-3.55, 0);
			expect(isNear(pixelAt(canvas(), border.x, border.y), YOURS, 40)).toBe(
				true,
			);
		});
		// The middle stays background: nothing stands there yet.
		const middle = screenOf(0, 0);
		expect(isNear(pixelAt(canvas(), middle.x, middle.y), BACKGROUND)).toBe(
			true,
		);
	});

	it('does not draw a piece the camera cannot see', async () => {
		const {store, canvas} = setup();
		store.set({
			step: 'Loaded',
			cycleNumber: 1,
			...board([piece(0, 0), piece(500, 500)]),
		});

		await painted(() => {
			const at = screenOf(0, 0);
			expect(isNear(pixelAt(canvas(), at.x, at.y), YOURS)).toBe(true);
		});
		for (const [x, y] of [
			[10, 10],
			[SIZE.width - 10, SIZE.height - 10],
		]) {
			expect(isNear(pixelAt(canvas(), x, y), BACKGROUND)).toBe(true);
		}
	});

	it('clears what it drew last frame', async () => {
		const {store, canvas} = setup();
		store.set({step: 'Loaded', cycleNumber: 1, ...board([piece(0, 0)])});
		await painted(() => {
			const at = screenOf(0, 0);
			expect(isNear(pixelAt(canvas(), at.x, at.y), YOURS)).toBe(true);
		});

		store.set({step: 'Loaded', cycleNumber: 2, ...board([])});
		await painted(() => {
			const at = screenOf(0, 0);
			expect(isNear(pixelAt(canvas(), at.x, at.y), BACKGROUND)).toBe(true);
		});
	});

	it('follows the camera when it pans', async () => {
		const {store, cameraControl, canvas} = setup();
		store.set({step: 'Loaded', cycleNumber: 1, ...board([piece(0, 0)])});
		await painted(() => {
			const at = screenOf(0, 0);
			expect(isNear(pixelAt(canvas(), at.x, at.y), YOURS)).toBe(true);
		});

		// Drag the content right by 30 CSS pixels: the piece moves with it.
		cameraControl.handle({type: 'pan', dx: 30, dy: 0});
		await painted(() => {
			const moved = screenOf(0, 0);
			expect(isNear(pixelAt(canvas(), moved.x + 30, moved.y), YOURS)).toBe(
				true,
			);
			expect(isNear(pixelAt(canvas(), moved.x, moved.y), BACKGROUND)).toBe(
				true,
			);
		});
	});
});
