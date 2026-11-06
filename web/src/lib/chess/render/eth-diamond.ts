/**
 * THE ETH DIAMOND, the one symbol that means "ETH leaves here": drawn on every
 * exit, and as a badge on every king (the piece whose exit pays the army's
 * stake out). Pure geometry in squares, so the canvas board and the wooden
 * board draw the same shape and it is tested without a canvas.
 *
 * The shape is the wooden board's inlay (`pieces.json`'s `inlay`, through
 * `./pixi/piece-art`): four triangles, the logo's upper pyramid and its lower
 * chevron, light on the left and dark on the right like the logo itself.
 * WHERE exits are is not decided here: `$lib/chess/exits` says, and this only
 * groups its squares into blocks (`./pixi/view-model`'s `exitBlocks`).
 */
import {exitsIn} from '../exits';
import {INLAY, type Quadrant} from './pixi/piece-art';
import {exitBlocks} from './pixi/view-model';
import {exitInlay} from './pixi/squares';

export type Point = {x: number; y: number};

/** The diamond's two tones, light on the left like the logo. */
export const ETH_TONES = {light: '#7cf5d4', dark: '#06a57c'} as const;

/** The outline round a king's badge, so it reads over any piece colour. */
export const BADGE_OUTLINE = '#0b1020';

export type Facet = {
	points: Array<[number, number]>;
	tone: 'light' | 'dark';
};

const FACETS: Array<[Quadrant, Facet['tone']]> = [
	['tl', 'light'],
	['tr', 'dark'],
	['bl', 'light'],
	['br', 'dark'],
];

/**
 * The diamond's four facets about `centre`, `unit` squares per inlay unit (the
 * logo is about 2 units tall: 1 makes it fill a 2 x 2 block).
 */
export function ethDiamond(centre: Point, unit: number): Facet[] {
	return FACETS.map(([quadrant, tone]) => ({
		tone,
		points: INLAY[quadrant].map(
			([x, y]) =>
				[centre.x + x * unit, centre.y + y * unit] as [number, number],
		),
	}));
}

/**
 * One diamond per exit in view: centred on its block and filling it (a lone
 * exit square gets a diamond half the size). The view is widened by two
 * squares so a block cut by the edge of the screen is still drawn whole, and
 * only blocks that overlap the view are kept: the widened area cuts blocks of
 * its own at its edges, and those lie outside the view.
 */
export function exitDiamonds(
	bounds: {minX: number; maxX: number; minY: number; maxY: number},
	spacing: number | undefined,
): Array<{centre: Point; unit: number}> {
	if (!spacing) return [];
	const around = {
		minX: bounds.minX - 2,
		maxX: bounds.maxX + 2,
		minY: bounds.minY - 2,
		maxY: bounds.maxY + 2,
	};
	const overlaps = (x: number, y: number, span: number) =>
		x + span - 1 >= bounds.minX &&
		x <= bounds.maxX &&
		y + span - 1 >= bounds.minY &&
		y <= bounds.maxY;
	return exitBlocks(exitsIn(around, spacing))
		.filter((block) => overlaps(block.x, block.y, block.span))
		.map((block) => {
			const {cx, cy} = exitInlay(block, block.span);
			return {centre: {x: cx, y: cy}, unit: block.span === 2 ? 1 : 0.5};
		});
}

/**
 * Where a king's badge goes: the lower right of its square, clear of its glyph
 * and of the stake label drawn above the square.
 */
export function kingBadge(king: Point): {centre: Point; unit: number} {
	return {centre: {x: king.x + 0.3, y: king.y + 0.25}, unit: 0.2};
}
