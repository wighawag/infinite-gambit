/**
 * How pieces look: a glyph per kind and a colour per army. Presentation only.
 */
import {PIECE_KIND, type PieceKind} from '../board';

const GLYPHS: Record<PieceKind, string> = {
	[PIECE_KIND.None]: '',
	[PIECE_KIND.Pawn]: '\u265F',
	[PIECE_KIND.Knight]: '\u265E',
	[PIECE_KIND.Bishop]: '\u265D',
	[PIECE_KIND.Rook]: '\u265C',
	[PIECE_KIND.Queen]: '\u265B',
	[PIECE_KIND.King]: '\u265A',
	// A stone is drawn on a square tile (`STONE_COLOUR`), never a disc.
	[PIECE_KIND.Stone]: '\u25C6',
};

/** The chess glyph a piece is drawn with. */
export function glyphOf(kind: PieceKind): string {
	return GLYPHS[kind] ?? '?';
}

/**
 * A STONE's tile: a taken king that never moves again and holds its army's
 * stake (`docs/adr/0014`). Drawn as a square rather than a disc, so it is never
 * read as a piece anyone plays, and edged in the colour of the army it was.
 */
export const STONE_COLOUR = '#8d8579';

/** Whether a piece is drawn as a stone. */
export const isStone = (kind: PieceKind): boolean => kind === PIECE_KIND.Stone;

/**
 * A FROZEN army's pieces: its own hue, drained of colour, so it stays told
 * apart from the other frozen armies and from a stone's tile.
 */
export function frozenColour(army: bigint): string {
	const hue = Number((army ^ (army >> 160n)) % 300n) + 60;
	return `hsl(${hue % 360}, 12%, 58%)`;
}

/** The ring a frozen army's pieces are drawn with. */
export const FROZEN_RING = '#cfe8ff';

/** The colour of the army this client plays. */
export const YOUR_COLOUR = '#ffd166';

/**
 * A colour per army, stable across reloads and devices: a hue from the army
 * id, away from the gold the player's own army is drawn in.
 */
export function armyColour(army: bigint): string {
	const hue = Number((army ^ (army >> 160n)) % 300n) + 60;
	return `hsl(${hue % 360}, 65%, 62%)`;
}

/**
 * A colour per planned piece-move, by its place in the move: the first gold,
 * the second cyan, the third magenta, so up to three marks on the board stay
 * apart, and the HUD names each in the colour it is drawn in.
 */
export const PLANNED_MOVE_COLOURS = ['#ffd166', '#5ad1e6', '#e07ad6'] as const;

/** The colour the `index`-th planned piece-move of a move is drawn in. */
export function plannedMoveColour(index: number): string {
	return PLANNED_MOVE_COLOURS[index % PLANNED_MOVE_COLOURS.length];
}
