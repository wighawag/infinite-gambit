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
};

/** The chess glyph a piece is drawn with. */
export function glyphOf(kind: PieceKind): string {
	return GLYPHS[kind] ?? '?';
}

/** A ROCK: a piece nobody can play again (army zero on the board read). */
export const ROCK_COLOUR = '#7a7f8c';

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
