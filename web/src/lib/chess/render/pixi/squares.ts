/**
 * The board's geometry, as pure functions (no DOM, no pixi), so the parts of
 * the wooden board that can be tested without a GPU are tested in node.
 *
 * Coordinates follow the game: a square is centred on its integer coordinate
 * (it spans x - 0.5 to x + 0.5), and (x + y) even is a light square, as the
 * canvas renderer draws it today (`../board.ts`). Pixi content is in PIXELS at
 * `cellSize` per square, as in the template's pixi host
 * (`$lib/game/render/pixi/world.ts`).
 *
 * NO RULE LIVES HERE. In particular, WHICH squares are exits is
 * `$lib/chess/exits.ts`'s to say (it mirrors `UsingGameBoard._isExit`); this
 * module only says how to draw an exit once the caller has named its squares.
 */

/** The squares the camera can see, inclusive. */
export type VisibleCells = {
	left: number;
	top: number;
	right: number;
	bottom: number;
};

/**
 * Below this many screen pixels per square the grain is invisible anyway and
 * the square pool would be tens of thousands of sprites: draw the board as one
 * low-contrast tiling checker instead.
 */
export const FLAT_BELOW = 18;

/** Screen pixels per square below which pieces are drawn as dots. */
export const DOTS_BELOW = 18;

export function isFlat(scale: number): boolean {
	return scale < FLAT_BELOW;
}

export function isDots(scale: number): boolean {
	return scale < DOTS_BELOW;
}

export function isLight(x: number, y: number): boolean {
	return (((x + y) % 2) + 2) % 2 === 0;
}

/** A deterministic 32-bit hash of a square and a salt. */
export function cellHash(x: number, y: number, salt: number): number {
	let h =
		Math.imul(x | 0, 73856093) ^
		Math.imul(y | 0, 19349663) ^
		Math.imul(salt, 83492791);
	h = Math.imul(h ^ (h >>> 15), 2246822519);
	return (h ^ (h >>> 13)) >>> 0;
}

/**
 * Where the flat checker's tiling sprite goes, in squares. Its texture's pixel
 * (0, 0) is a light square, so it starts on the first light square at or left
 * of the view's top-left, half a square up and left of that square's centre.
 */
export function flatChecker(view: VisibleCells): {
	x: number;
	y: number;
	width: number;
	height: number;
} {
	const x0 = view.left - ((((view.left + view.top) % 2) + 2) % 2);
	return {
		x: x0 - 0.5,
		y: view.top - 0.5,
		width: view.right - x0 + 2,
		height: view.bottom - view.top + 2,
	};
}

/** An exit is 1 square (today's rule) or a 2 x 2 block (ADR 0015). */
export type ExitSpan = 1 | 2;

/**
 * How to draw one exit, given its top-left square (the square with the lowest
 * x and y) and its span: the centre of the inlay, in squares, and whether that
 * top-left square is light. The inlay's woods depend on it (each triangle is in
 * the OPPOSITE wood to its square), and on an odd spacing it alternates from
 * one exit to the next, so the renderer bakes both variants.
 */
export function exitInlay(
	topLeft: {x: number; y: number},
	span: ExitSpan,
): {cx: number; cy: number; topLeftLight: boolean} {
	const off = (span - 1) / 2;
	return {
		cx: topLeft.x + off,
		cy: topLeft.y + off,
		topLeftLight: isLight(topLeft.x, topLeft.y),
	};
}
