/**
 * What the wooden board draws, worked out from the view state as plain data.
 * Pure (no DOM, no pixi), so every mapping from `BoardView` to the screen is
 * tested in node and the pixi half only places sprites.
 *
 * NO RULE OF THE GAME IS HERE (`docs/adr/0007-rules-live-only-in-the-contract.md`):
 * destinations, attacked squares, outcomes and exit squares all arrive already
 * decided, and this module only chooses how they look. The one judgement it
 * makes is which attacked squares are worth showing, which changes nothing
 * anyone may do.
 */
import {PIECE_KIND, type PieceKind} from '../../board';
import {captureEffectsOf} from '../../outcomes';
import type {BoardView, PieceView} from '../../view';
import {armyColour, frozenColour, glyphOf, YOUR_COLOUR} from '../style';
import type {Finish, Kind} from './piece-art';
import type {ExitSpan} from './squares';

type Square = {x: number; y: number};
const keyOf = ({x, y}: Square) => `${x},${y}`;

// ---- colours ---------------------------------------------------------------

/**
 * A CSS colour as a 24-bit number, for a pixi `tint`. Takes what `style.ts`
 * produces: `#rgb`, `#rrggbb` and `hsl(h, s%, l%)`. Converting here rather than
 * trusting pixi's parser keeps the tint testable and independent of its version.
 */
export function cssColourToHex(css: string): number {
	const s = css.trim();
	if (s.startsWith('#')) {
		const hex =
			s.length === 4
				? s
						.slice(1)
						.split('')
						.map((c) => c + c)
						.join('')
				: s.slice(1, 7);
		return parseInt(hex, 16);
	}
	const hsl = s.match(
		/^hsl\(\s*([-\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)$/,
	);
	if (!hsl) throw new Error(`unsupported colour: ${css}`);
	const h = (((Number(hsl[1]) % 360) + 360) % 360) / 360;
	const sat = Number(hsl[2]) / 100;
	const l = Number(hsl[3]) / 100;
	const q = l < 0.5 ? l * (1 + sat) : l + sat - l * sat;
	const p = 2 * l - q;
	const channel = (t: number) => {
		if (t < 0) t += 1;
		if (t > 1) t -= 1;
		const v =
			t < 1 / 6
				? p + (q - p) * 6 * t
				: t < 1 / 2
					? q
					: t < 2 / 3
						? p + (q - p) * (2 / 3 - t) * 6
						: p;
		return Math.round(v * 255);
	};
	return (channel(h + 1 / 3) << 16) | (channel(h) << 8) | channel(h - 1 / 3);
}

/** The ice-blue glow under a frozen army's pieces. */
export const ICE_GLOW = '#b9d7ea';

// ---- pieces ----------------------------------------------------------------

const SILHOUETTES: Partial<Record<PieceKind, Kind>> = {
	[PIECE_KIND.Pawn]: 'pawn',
	[PIECE_KIND.Knight]: 'knight',
	[PIECE_KIND.Bishop]: 'bishop',
	[PIECE_KIND.Rook]: 'rook',
	[PIECE_KIND.Queen]: 'queen',
	[PIECE_KIND.King]: 'king',
	// a stone is a taken king (ADR 0014): the king's silhouette, in stone
	[PIECE_KIND.Stone]: 'king',
};

const KINDS_OF: Record<Kind, PieceKind> = {
	pawn: PIECE_KIND.Pawn,
	knight: PIECE_KIND.Knight,
	bishop: PIECE_KIND.Bishop,
	rook: PIECE_KIND.Rook,
	queen: PIECE_KIND.Queen,
	king: PIECE_KIND.King,
};

/**
 * The glyph a piece shows when zoomed out (`./squares`'s `pieceMode`): the
 * canvas board's own (`../style`), so both boards read the same from afar.
 */
export function glyphOfLook(look: Pick<PieceLook, 'kind' | 'stone'>): string {
	return glyphOf(look.stone ? PIECE_KIND.Stone : KINDS_OF[look.kind]);
}

/** The turned piece a kind is drawn as; none for an empty square. */
export function silhouetteOf(kind: PieceKind): Kind | undefined {
	return SILHOUETTES[kind];
}

/** Everything that decides how one piece is drawn. */
export type PieceLook = {
	x: number;
	y: number;
	kind: Kind;
	finish: Finish;
	/** The army colour on the band parts, as CSS. */
	band: string;
	/** The glow under the piece (and its low-zoom dot), as CSS. */
	tone: string;
	/** 0 for no glow. */
	glow: number;
	/** The whole piece's opacity: the planned army is translucent. */
	alpha: number;
	/** Whether this is a stone, which never shows a glow. */
	stone: boolean;
};

export function lookOf(
	piece: PieceView,
	view: Pick<BoardView, 'you' | 'frozen'>,
	ghost = false,
): PieceLook | undefined {
	const kind = silhouetteOf(piece.kind);
	if (!kind) return undefined;
	const {x, y} = piece.position2d;
	const mine = ghost || piece.army === view.you;
	const band = mine ? YOUR_COLOUR : armyColour(piece.army);
	if (piece.kind === PIECE_KIND.Stone) {
		// a stone keeps the band of the army it was: it still holds its stake
		return {
			x,
			y,
			kind,
			finish: 'stone',
			band,
			tone: band,
			glow: 0,
			alpha: 1,
			stone: true,
		};
	}
	if (!ghost && view.frozen?.has(piece.army)) {
		return {
			x,
			y,
			kind,
			finish: 'ice',
			band: frozenColour(piece.army),
			tone: ICE_GLOW,
			glow: 0.6,
			alpha: 1,
			stone: false,
		};
	}
	return {
		x,
		y,
		kind,
		finish: mine ? 'boxwood' : 'sheesham',
		band,
		tone: band,
		glow: 1,
		alpha: ghost ? 0.45 : 1,
		stone: false,
	};
}

/**
 * Every piece to draw, keyed for the reconciler: the chain's pieces by square,
 * and the planned army's ghost under keys of its own, so a ghost and a real
 * piece on one square are two objects.
 */
export function pieceLooks(view: BoardView): Map<string, PieceLook> {
	const looks = new Map<string, PieceLook>();
	for (const [key, piece] of view.pieces) {
		const look = lookOf(piece, view);
		if (look) looks.set(`p:${key}`, look);
	}
	for (const piece of view.ghost) {
		const look = lookOf(piece, view, true);
		if (look) looks.set(`g:${piece.position}`, look);
	}
	return looks;
}

/** Whether two looks draw differently: the reconciler's `changed`. */
export function looksDiffer(a: PieceLook, b: PieceLook): boolean {
	return (
		a.x !== b.x ||
		a.y !== b.y ||
		a.kind !== b.kind ||
		a.finish !== b.finish ||
		a.band !== b.band ||
		a.tone !== b.tone ||
		a.glow !== b.glow ||
		a.alpha !== b.alpha
	);
}

// ---- exits -----------------------------------------------------------------

/**
 * Group exit squares into exits, each named by its top-left square, with its
 * span. The squares come from `$lib/chess/exits.ts`, so this works for a
 * 1-square exit and for a 2 x 2 block alike: a square is a top-left when
 * neither its left nor its upper neighbour is an exit, and the exit spans 2 when
 * its right neighbour is one. Pass squares from a slightly larger area than the
 * view, so a block cut by the view's edge is still found.
 */
export function exitBlocks(
	squares: readonly Square[],
): Array<Square & {span: ExitSpan}> {
	const exits = new Set(squares.map(keyOf));
	const has = (x: number, y: number) => exits.has(`${x},${y}`);
	return squares
		.filter(({x, y}) => !has(x - 1, y) && !has(x, y - 1))
		.map(({x, y}) => ({x, y, span: has(x + 1, y) ? 2 : 1}));
}

// ---- highlights ------------------------------------------------------------

export type OverlayModel = {
	/** Open spawn points; `half` is the frame's half-size, in squares. */
	spawns: Array<Square & {picked: boolean}>;
	selected?: Square;
	destinations: Array<Square & {capture: boolean}>;
	attacked: Square[];
	planned?: {from: Square; to: Square};
	outcomes: Array<
		Square & {
			collision: boolean;
			captured: boolean;
			promoted: boolean;
			stoneMade: boolean;
		}
	>;
};

/**
 * The attacked squares worth showing: around the player's kings, on the
 * selection's destinations and on the planned target. Shown everywhere they
 * are noise. With no king of the player's in view (before a deployment), all
 * of them, as the canvas renderer draws them.
 */
export function attackedThatMatter(view: BoardView): Square[] {
	const attacked = view.attacked ?? [];
	const kings = (view.kings ?? []).filter(
		(king) => view.you !== undefined && king.army === view.you,
	);
	if (kings.length === 0) return [...attacked];
	const near = new Set<string>();
	for (const {position2d: k} of kings) {
		for (let dy = -1; dy <= 1; dy++) {
			for (let dx = -1; dx <= 1; dx++) near.add(`${k.x + dx},${k.y + dy}`);
		}
	}
	for (const d of view.destinations ?? []) near.add(keyOf(d));
	if (view.plannedMove) near.add(keyOf(view.plannedMove.to));
	return attacked.filter((square) => near.has(keyOf(square)));
}

export function overlayModel(view: BoardView): OverlayModel {
	const occupied = new Set<string>();
	for (const piece of view.pieces.values())
		occupied.add(keyOf(piece.position2d));
	return {
		spawns: view.spawnPoints.map((point) => ({
			...point.position,
			picked: view.planned?.spawnPoint === point.spawnPoint,
		})),
		...(view.selected ? {selected: view.selected} : {}),
		// a destination onto a piece is a capture: the contract listed it, so
		// whatever stands there is takeable
		destinations: (view.destinations ?? []).map((d) => ({
			...d,
			capture: occupied.has(keyOf(d)),
		})),
		attacked: attackedThatMatter(view),
		...(view.plannedMove ? {planned: view.plannedMove} : {}),
		outcomes: view.outcomes.map((outcome) => {
			const effects = captureEffectsOf(outcome);
			return {
				...outcome.position2d,
				collision: outcome.died > 0,
				captured: outcome.captured !== undefined,
				promoted: effects.promoted,
				stoneMade: effects.stoneMade,
			};
		}),
	};
}

// ---- labels ----------------------------------------------------------------

export type Label = Square & {text: string; tone: 'live' | 'frozen' | 'stone'};

/**
 * The stake over the king or stone the player clicked (`inspected`): what a
 * player judges a target by. Only that one, since labels over every king
 * covered the pieces around them. Both boards draw these.
 */
export function labelsOf(view: BoardView): Label[] {
	const at = view.inspected;
	if (!at) return [];
	const here = (p: {position2d: {x: number; y: number}}) =>
		p.position2d.x === at.x && p.position2d.y === at.y;
	return [
		...(view.kings ?? []).filter(here).map((king) => ({
			...king.position2d,
			text: king.stakeLabel,
			tone: king.frozen ? ('frozen' as const) : ('live' as const),
		})),
		...(view.stones ?? []).filter(here).map((stone) => ({
			...stone.position2d,
			text: stone.stakeLabel,
			tone: 'stone' as const,
		})),
	];
}
