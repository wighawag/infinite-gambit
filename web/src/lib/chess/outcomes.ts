/**
 * What the last closed cycle did: its captures and its collisions.
 *
 * RESOLVED BY THE CONTRACT, not worked out here. `getOutcomes` reads the same
 * accumulated facts the board is resolved from and applies the same table
 * (`ChessRules.outcome` beside `ChessRules.settle`), so this module only
 * normalises, keeps and words its answer
 * (`docs/adr/0007-rules-live-only-in-the-contract.md`). Nothing here decides
 * who died: it is told.
 *
 * WHY THE ANSWERS ARE KEPT. A square keeps a cycle's facts only until a reveal
 * of a later cycle touches it, so a read during the next reveal phase can miss
 * squares the read before it had. It never reports a wrong one, so the union
 * of every read for the same cycle is the whole picture: that is what
 * {@link accumulateOutcomes} keeps.
 */
import {pieceOf, PIECE_KIND, type Piece} from './board';

/** One square the last closed cycle changed by a capture or a collision. */
export type SquareOutcome = {
	position: bigint;
	/** How many arriving pieces died there in a collision. */
	died: number;
	/** The piece that stayed there and was captured, if one was. */
	captured?: Piece;
	/** What stands there now, if anything. */
	piece?: Piece;
};

export type CycleOutcomes = {
	/** The cycle they happened in; -1 before anything was read. */
	cycleNumber: number;
	bySquare: ReadonlyMap<bigint, SquareOutcome>;
};

export const noOutcomes = (): CycleOutcomes => ({
	cycleNumber: -1,
	bySquare: new Map(),
});

type RawPiece = Parameters<typeof pieceOf>[0];

/** Normalise one outcome as viem hands it back. */
export function outcomeOf(raw: {
	position: bigint;
	died: number | bigint;
	captured: RawPiece;
	piece: RawPiece;
}): SquareOutcome {
	return {
		position: raw.position,
		died: Number(raw.died),
		...(raw.captured.kind === PIECE_KIND.None
			? {}
			: {captured: pieceOf(raw.captured)}),
		...(raw.piece.kind === PIECE_KIND.None ? {} : {piece: pieceOf(raw.piece)}),
	};
}

/**
 * Fold a new read into what was kept: the union for the same cycle (a later
 * read can only have lost squares), the new read alone for a newer cycle, and
 * the kept answer for an older read that lands late.
 */
export function accumulateOutcomes(
	kept: CycleOutcomes,
	read: {cycleNumber: number; outcomes: readonly SquareOutcome[]},
): CycleOutcomes {
	if (read.cycleNumber < kept.cycleNumber) return kept;
	const bySquare = new Map(
		read.cycleNumber === kept.cycleNumber ? kept.bySquare : [],
	);
	for (const outcome of read.outcomes) bySquare.set(outcome.position, outcome);
	return {cycleNumber: read.cycleNumber, bySquare};
}

/**
 * A piece kind as a player says it. A function rather than a table built at
 * load time, because `./board` imports this module and a table would read
 * `PIECE_KIND` before that cycle has finished loading.
 */
function pieceName(kind: number): string {
	return (
		{
			[PIECE_KIND.Pawn]: 'pawn',
			[PIECE_KIND.Knight]: 'knight',
			[PIECE_KIND.Bishop]: 'bishop',
			[PIECE_KIND.Rook]: 'rook',
			[PIECE_KIND.Queen]: 'queen',
			[PIECE_KIND.King]: 'king',
		}[kind] ?? 'piece'
	);
}

export type OutcomeLine = {
	label: string;
	/** `bad` when it cost the player a piece, `good` when it won them one. */
	tone: 'idle' | 'good' | 'bad';
};

/**
 * The last cycle's outcomes in the player's words, in the order of their
 * squares' packed positions so the list does not reshuffle between reads. `you` is the army this client
 * plays, if any.
 */
export function describeOutcomes(
	outcomes: Iterable<SquareOutcome>,
	square: (position: bigint) => {x: number; y: number},
	you?: bigint,
): OutcomeLine[] {
	const sorted = [...outcomes].sort((a, b) =>
		a.position < b.position ? -1 : a.position > b.position ? 1 : 0,
	);
	const lines: OutcomeLine[] = [];
	for (const outcome of sorted) {
		const {x, y} = square(outcome.position);
		const at = `(${x}, ${y})`;
		const {captured, piece} = outcome;
		if (captured) {
			const what = pieceName(captured.kind);
			const by = piece ? ` by a ${pieceName(piece.kind)}` : '';
			if (you !== undefined && captured.army === you) {
				lines.push({
					label: `Your ${what} on ${at} was captured${by}.`,
					tone: 'bad',
				});
			} else if (you !== undefined && piece?.army === you) {
				lines.push({
					label: `Your ${pieceName(piece.kind)} captured a ${what} on ${at}.`,
					tone: 'good',
				});
			} else {
				lines.push({
					label: `A ${what} on ${at} was captured${by}.`,
					tone: 'idle',
				});
			}
		}
		if (outcome.died > 0) {
			const held = piece
				? `; the ${pieceName(piece.kind)} there held its square`
				: '';
			lines.push({
				label: `${outcome.died} pieces collided on ${at} and died${held}.`,
				tone: 'idle',
			});
		}
	}
	return lines;
}
