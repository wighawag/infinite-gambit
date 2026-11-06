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
 * What a capture on a square did, beyond taking a piece, read from the
 * contract's answer alone (`ChessRules.outcome` for what was taken and how many
 * arrivals died, `getPieces`' resolution for what stands there now): nothing
 * here applies a rule, it only names the shapes that answer can take
 * (`docs/adr/0013`, `docs/adr/0014`).
 */
export type CaptureEffects = {
	/**
	 * The piece standing there now landed as a queen: it took a king that
	 * stayed (a king that takes a king stays a king), or it was the one piece
	 * a moving king met.
	 */
	promoted: boolean;
	/**
	 * The army of the king that stayed there and was taken for good: its
	 * pieces leave the board from the next cycle and its stake is its
	 * captor's. Absent when no king was taken, or when it became a stone.
	 */
	vanished?: bigint;
	/** A stone stands there now, from a capture whose captor's king fell. */
	stoneMade: boolean;
	/** A stone that stood there was taken, with its stake, by what stands now. */
	stoneCaptured: boolean;
	/**
	 * A moving king met exactly one piece there and died: the only row of the
	 * table where exactly one arrival dies.
	 */
	kingMet: boolean;
};

export function captureEffectsOf(outcome: SquareOutcome): CaptureEffects {
	const {captured, piece} = outcome;
	const kingMet = outcome.died === 1;
	const stoneNow = piece?.kind === PIECE_KIND.Stone;
	const kingTaken = captured?.kind === PIECE_KIND.King;
	const stoneTaken = captured?.kind === PIECE_KIND.Stone;
	const vanished = kingTaken && !stoneNow ? captured.army : undefined;
	return {
		promoted: piece?.kind === PIECE_KIND.Queen && (kingTaken || kingMet),
		...(vanished !== undefined ? {vanished} : {}),
		stoneMade: stoneNow && !stoneTaken,
		stoneCaptured: stoneTaken && !stoneNow && piece !== undefined,
		kingMet,
	};
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
			[PIECE_KIND.Stone]: 'stone',
		}[kind] ?? 'piece'
	);
}

export type OutcomeLine = {
	label: string;
	/** `bad` when it cost the player a piece, `good` when it won them one. */
	tone: 'idle' | 'good' | 'bad';
};

/** Who a line is about, from the player's side. */
type Side = 'yours' | 'theirs' | 'nobody';

const sideOf = (army: bigint | undefined, you: bigint | undefined): Side =>
	you === undefined || army === undefined
		? 'nobody'
		: army === you
			? 'yours'
			: 'theirs';

/** The line for a capture of a king or a stone, or undefined for any other. */
function describeStakeCapture(
	outcome: SquareOutcome,
	effects: CaptureEffects,
	at: string,
	you: bigint | undefined,
): OutcomeLine | undefined {
	const {captured, piece} = outcome;
	if (!captured) return undefined;
	const victim = sideOf(captured.army, you) === 'yours';
	const captor = !victim && sideOf(piece?.army, you) === 'yours';
	if (effects.stoneMade) {
		const whose = victim ? 'your' : 'its';
		const what = victim ? 'Your king' : 'A king';
		return {
			label: `${what} on ${at} was taken by a piece whose own king fell this cycle: it is a stone now, holding ${whose} army's stake.`,
			tone: victim ? 'bad' : 'idle',
		};
	}
	if (effects.vanished !== undefined) {
		const how = effects.promoted
			? 'and the piece that took it is now a queen'
			: piece
				? `by a ${pieceName(piece.kind)}`
				: '';
		if (captor) {
			const by = effects.promoted
				? 'piece captured a king on ' + at + ' and is now a queen'
				: `${pieceName(piece!.kind)} captured a king on ${at}`;
			return {
				label: `Your ${by}: its army leaves the board and its stake is yours.`,
				tone: 'good',
			};
		}
		const sep = effects.promoted ? ', ' : how ? ' ' : '';
		if (victim) {
			return {
				label: `Your king on ${at} was captured${sep}${how}: your army leaves the board and its stake is theirs.`,
				tone: 'bad',
			};
		}
		return {
			label: `A king on ${at} was captured${sep}${how}: its army leaves the board and its stake goes to the captor.`,
			tone: 'idle',
		};
	}
	if (effects.stoneCaptured && piece) {
		const by = pieceName(piece.kind);
		if (captor) {
			return {
				label: `Your ${by} captured a stone on ${at}: its stake is yours.`,
				tone: 'good',
			};
		}
		if (victim) {
			return {
				label: `Your stone on ${at} was captured by a ${by}: its stake is theirs.`,
				tone: 'bad',
			};
		}
		return {
			label: `A stone on ${at} was captured by a ${by}, which took its stake.`,
			tone: 'idle',
		};
	}
	return undefined;
}

/** The line for a moving king that met exactly one piece and died. */
function describeKingMet(
	outcome: SquareOutcome,
	effects: CaptureEffects,
	at: string,
	you: bigint | undefined,
): OutcomeLine {
	const {piece} = outcome;
	if (effects.stoneMade) {
		return {
			label: `A king moving onto ${at} met one piece and died, and that piece's own king fell too: a stone stands there now, holding a stake.`,
			tone: 'idle',
		};
	}
	if (piece && sideOf(piece.army, you) === 'yours') {
		return {
			label: `Your piece on ${at} took a moving king and is now a queen: the king's stake is yours.`,
			tone: 'good',
		};
	}
	return {
		label: `A king moving onto ${at} met one piece and died: that piece is now a queen with the king's stake.`,
		tone: 'idle',
	};
}

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
		const effects = captureEffectsOf(outcome);
		if (effects.kingMet) {
			lines.push(describeKingMet(outcome, effects, at, you));
		}
		const stakeLine = describeStakeCapture(outcome, effects, at, you);
		if (stakeLine) {
			lines.push(stakeLine);
		} else if (captured) {
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
		if (outcome.died > 1) {
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
