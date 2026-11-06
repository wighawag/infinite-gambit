/**
 * HOW MANY PIECE-MOVES A MOVE HOLDS: up to three, each by a different piece,
 * or one at a table whose creator turned three off
 * (`docs/adr/0016-an-army-moves-up-to-three-pieces-a-cycle-simultaneously.md`).
 *
 * THE CHOICE IS ONE BIT of the table's `gameOptions`, and a SET bit means OFF:
 * both worlds never open a roster, so they read zero and play three, and so
 * does a table created with no options ({@link NO_GAME_OPTIONS}). The bit is
 * the contract's (`ChessRules.ONE_PIECE_MOVE`), pinned here and checked
 * against it by `web/test/lib/chess/piece-moves.test.ts`. A table whose
 * options carry any other bit is one the contract refuses every seat at.
 *
 * THE CAP THE CLIENT PLAYS BY IS THE CONTRACT'S ANSWER (`getMaxPieceMoves`,
 * {@link readMaxPieceMoves}), which it passes to the whole-move route
 * ({@link wholeMoveRoute}): that route reads no storage, so it cannot read a
 * table's options itself. Decoding the bit here ({@link maxPieceMovesOf}) is
 * only for saying, in the table list, which a table plays.
 */
import {NO_GAME_OPTIONS} from '$lib/game/lobby/table';
import type {Piece} from './board';
import type {Move} from './commit-reveal';

/** `ChessRules.ONE_PIECE_MOVE`: the bit of `gameOptions` that turns three piece-moves off. */
export const ONE_PIECE_MOVE_OPTION = 1n;

/** `ChessRules.MAX_PIECE_MOVES`: how many piece-moves a move holds where the bit is not set. */
export const MAX_PIECE_MOVES = 3;

/**
 * The cap `gameOptions` sets: 1 with {@link ONE_PIECE_MOVE_OPTION}, three
 * without; undefined when another bit is set, a table nobody can be seated at.
 */
export function maxPieceMovesOf(
	gameOptions: `0x${string}`,
): number | undefined {
	const bits = BigInt(gameOptions);
	if ((bits & ~ONE_PIECE_MOVE_OPTION) !== 0n) return undefined;
	return bits & ONE_PIECE_MOVE_OPTION ? 1 : MAX_PIECE_MOVES;
}

/** The options a table is created with, playing one piece-move or three. */
export function gameOptionsFor(onePieceMove: boolean): `0x${string}` {
	return onePieceMove
		? `0x${ONE_PIECE_MOVE_OPTION.toString(16).padStart(64, '0')}`
		: NO_GAME_OPTIONS;
}

/** The game's `getMaxPieceMoves`, read through whatever reads the game. */
export async function readMaxPieceMoves(
	read: (functionName: 'getMaxPieceMoves') => Promise<bigint>,
): Promise<number> {
	return Number(await read('getMaxPieceMoves'));
}

/** One call to the Simulation route, as the sandbox runs it. */
export type WholeMoveCall = (
	functionName: 'isLegalWholeMove' | 'legalMovesAlongside',
	args: readonly unknown[],
) => Promise<unknown>;

/**
 * The whole-move route at a cap: whether a move is legal for an army
 * (`isLegalWholeMove`), and where one more piece may go alongside the others
 * (`legalMovesAlongside`), each judged by the contract with `maxPieceMoves`.
 */
export function wholeMoveRoute(params: {
	call: WholeMoveCall;
	maxPieceMoves: number;
}) {
	const cap = BigInt(params.maxPieceMoves);
	return {
		maxPieceMoves: params.maxPieceMoves,
		async isLegal(
			board: readonly Piece[],
			army: bigint,
			moves: readonly Move[],
		): Promise<boolean> {
			return (await params.call('isLegalWholeMove', [
				board,
				army,
				moves,
				cap,
			])) as boolean;
		},
		async alongside(
			board: readonly Piece[],
			from: bigint,
			others: readonly Move[],
		): Promise<bigint[]> {
			return [
				...((await params.call('legalMovesAlongside', [
					board,
					from,
					others,
					cap,
				])) as readonly bigint[]),
			];
		},
	};
}
