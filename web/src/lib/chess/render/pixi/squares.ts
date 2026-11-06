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
 * Screen pixels per square below which an exit stops glowing (`exitLook`).
 * The board is always wood (there is no flat fallback, and the camera's
 * `minScale` keeps it at or above this), but should a config let the camera
 * pull further back, a field of glowing inlays would be the brightest thing on
 * screen.
 */
export const EXIT_QUIET_BELOW = 18;

/**
 * Screen pixels per square below which pieces are no longer turned pieces but
 * the canvas board's disc with a glyph: at about 28 px a turned knight and
 * bishop were already hard to tell apart.
 */
export const TURNED_BELOW = 30;

/**
 * Below this the glyph has no room either, and a piece is a plain disc in its
 * army colour. The same threshold as the canvas board's `MIN_GLYPH_SCALE`.
 */
export const GLYPHS_BELOW = 6;

/** How pieces are drawn at a zoom: turned, as glyphs on discs, or as dots. */
export type PieceMode = 'pieces' | 'glyphs' | 'dots';

export function pieceMode(scale: number): PieceMode {
	if (scale >= TURNED_BELOW) return 'pieces';
	return scale >= GLYPHS_BELOW ? 'glyphs' : 'dots';
}

/**
 * How an exit is drawn at a zoom. Normally it glows and breathes. Below
 * `EXIT_QUIET_BELOW` the pieces are discs and the squares a few pixels, and a
 * glowing inlay became the brightest thing on screen: it drops its glow and
 * breath and takes the board's tint, so it marks the exit without taking the
 * eye.
 */
export function exitLook(scale: number): {glow: boolean; dimmed: boolean} {
	const quiet = scale < EXIT_QUIET_BELOW;
	return {glow: !quiet, dimmed: quiet};
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
