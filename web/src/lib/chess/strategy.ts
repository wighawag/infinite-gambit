/**
 * THIS GAME'S STRATEGY: how a seat the offline world plays at the `greedy`
 * level picks its move (`work/specs/tasked/infinite-chess.md`, story 43).
 *
 * WHAT IT DOES. Each cycle it captures the most valuable enemy piece one of its
 * pieces can reach (a king or a stone above everything, then by material:
 * queen 9, rook 5, bishop 3, knight 3, pawn 1), and when it can capture nothing it makes a
 * random legal move. Ties are broken by the seat's seeded random, so a test
 * reproduces and two seats do not move alike.
 *
 * THE RULES ARE THE CONTRACT'S, never a copy
 * (`docs/adr/0007-rules-live-only-in-the-contract.md`). Which squares a piece
 * may move to is `legalMoves`, and what a piece is worth is `materialOf`, both
 * run from the Simulation route's bytecode in the seats' sandbox. The only
 * thing decided here is the POLICY on top: a king outranks any material (it
 * carries the stake), and so does a stone, which holds its army's whole stake
 * and is worth nothing as material (`docs/adr/0014`).
 *
 * WHAT IT SEES (the framework's PA6): the board through the contract's own
 * resolving view (`getPieces`), its army through the registry (`getArmy`), and
 * the simulation. It decides in the COMMIT phase, when the board is the one the
 * cycle started with, which is the board `legalMoves` judges a move against.
 *
 * Logic only: no store, no component. `$lib/offline` wires it to the world.
 */
import {
	RANDOM_LEVEL,
	type AiLevel,
	type Strategy,
} from '$lib/game/core/strategy';
import {ARMY_STATUS, type ArmyView} from './armies';
import {PIECE_KIND, type Piece, type PieceKind} from './board';
import type {Move} from './commit-reveal';
import {piecesAround} from './planning';
import {positionOf} from './squares';

/** The level that captures greedily. */
export const GREEDY_LEVEL = 'greedy';

/**
 * How far around its king a seat looks for its own pieces, in squares on each
 * axis. An army's pieces start within two squares of its king and move one
 * piece per cycle, so this holds all of them for a long while; a piece that
 * wandered further is simply not one the seat moves. Captures are found
 * within `MOVE_REACH` of each piece, and the read is widened by that much.
 */
export const LOOK_AROUND = 24;

/** What a seat aims at, given what it could capture. */
export type Target = {kind: PieceKind; army: bigint};

/**
 * How much a seat wants to capture `target`: zero for nothing or its own army;
 * above every material value for a king or a stone, both of which carry a
 * stake; otherwise the contract's material value, handed in as `material`.
 */
export function captureValue(
	target: Target | undefined,
	own: bigint,
	material: (kind: PieceKind) => number,
	kingValue: number,
): number {
	if (!target || target.army === own) return 0;
	if (target.kind === PIECE_KIND.None) return 0;
	if (target.kind === PIECE_KIND.King || target.kind === PIECE_KIND.Stone) {
		return kingValue;
	}
	return material(target.kind);
}

/** One move a seat could make, and what it would capture. */
export type Candidate = {move: Move; value: number};

/**
 * THE CHOICE, given every legal move and its value: one of the most valuable
 * captures when there is any, otherwise any legal move, the tie (or the random
 * pick) decided by `below`. `undefined` when there is no legal move at all.
 */
export function chooseGreedyMove(
	candidates: readonly Candidate[],
	below: (n: number) => number,
): Move | undefined {
	if (candidates.length === 0) return undefined;
	let best = 0;
	for (const candidate of candidates) best = Math.max(best, candidate.value);
	const pool =
		best > 0
			? candidates.filter((candidate) => candidate.value === best)
			: candidates;
	return pool[below(pool.length)].move;
}

/** The rectangle a seat reads, bounds inclusive. */
export type Rect = {minX: number; minY: number; maxX: number; maxY: number};

/** The squares within {@link LOOK_AROUND} of `square`. */
export function lookAround(square: bigint): Rect {
	const {x, y} = positionOf(square);
	return {
		minX: x - LOOK_AROUND,
		minY: y - LOOK_AROUND,
		maxX: x + LOOK_AROUND,
		maxY: y + LOOK_AROUND,
	};
}

/**
 * The levels a world seat may play at in this game, greedy first because it is
 * the one a world seat starts at.
 */
export const CHESS_LEVELS: readonly AiLevel[] = [
	{id: GREEDY_LEVEL, label: 'Greedy'},
	{id: RANDOM_LEVEL, label: 'Deploys and passes'},
];

export function createChessStrategy(params: {
	/** The army as the registry resolves it. */
	readArmy: (army: bigint) => Promise<ArmyView>;
	/** The board on a rectangle, as `getPieces` resolves it. */
	readPieces: (rect: Rect) => Promise<readonly Piece[]>;
	/** `legalMoves`, the contract's rule, run in the sandbox. */
	legalMoves: (board: readonly Piece[], from: bigint) => Promise<bigint[]>;
	/** `materialOf`, the contract's table, run in the sandbox. */
	materialOf: (kind: PieceKind) => Promise<number>;
}): Strategy<Move> {
	// The contract's table never changes within a deployment, so each kind is
	// asked once.
	const values = new Map<PieceKind, Promise<number>>();
	const valueOf = (kind: PieceKind) => {
		let value = values.get(kind);
		if (!value) {
			value = params.materialOf(kind);
			values.set(kind, value);
		}
		return value;
	};

	return async ({identity, level, random, budget}) => {
		if (level !== GREEDY_LEVEL || budget.actionsAtMost < 1) return [];
		const army = await params.readArmy(identity);
		if (army.status !== ARMY_STATUS.Deployed) return [];

		const pieces = new Map<bigint, Piece>();
		for (const piece of await params.readPieces(lookAround(army.king))) {
			pieces.set(piece.position, piece);
		}
		const own = [...pieces.values()]
			.filter((piece) => piece.army === identity)
			.sort((a, b) =>
				a.position < b.position ? -1 : a.position > b.position ? 1 : 0,
			);

		// The material of every kind on the board, asked before anything is
		// scored, so the scoring itself is synchronous.
		const kinds = [...new Set([...pieces.values()].map((p) => p.kind))];
		const material = new Map<PieceKind, number>();
		for (const kind of kinds) material.set(kind, await valueOf(kind));
		const kingValue = 1 + Math.max(0, ...material.values(), 9);

		const candidates: Candidate[] = [];
		for (const piece of own) {
			const destinations = await params.legalMoves(
				piecesAround(pieces, piece.position),
				piece.position,
			);
			for (const to of destinations) {
				candidates.push({
					move: {from: piece.position, to},
					value: captureValue(
						pieces.get(to),
						identity,
						(kind) => material.get(kind) ?? 0,
						kingValue,
					),
				});
			}
		}
		const move = chooseGreedyMove(candidates, (n) => random.below(n));
		return move ? [move] : [];
	};
}
