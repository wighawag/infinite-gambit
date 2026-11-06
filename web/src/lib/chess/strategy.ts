/**
 * THIS GAME'S STRATEGY: how a seat the offline world plays at the `greedy`
 * level picks its move (`work/specs/tasked/infinite-chess.md`, story 43).
 *
 * WHAT IT DOES. Each cycle it makes up to the cap of piece-moves, each by a
 * different piece (three, or one at a table that turns three off,
 * `docs/adr/0016-an-army-moves-up-to-three-pieces-a-cycle-simultaneously.md`).
 * It picks them one at a time: the most valuable enemy piece one of its
 * unmoved pieces can reach (a king or a stone above everything, then by
 * material: queen 9, rook 5, bishop 3, knight 3, pawn 1), and when it can
 * capture nothing more, a random legal piece-move. Ties are broken by the
 * seat's seeded random, so a test reproduces and two seats do not move alike.
 *
 * THE RULES ARE THE CONTRACT'S, never a copy
 * (`docs/adr/0007-rules-live-only-in-the-contract.md`). Which squares a piece
 * may move to, alongside the piece-moves already picked, is the whole-move
 * route's `legalMovesAlongside` (`./piece-moves.ts`, the planner's own path),
 * the finished move is checked by its `isLegalWholeMove`, the cap is the
 * game's `getMaxPieceMoves`, and what a piece is worth is `materialOf`, all
 * run from the Simulation route's bytecode in the seats' sandbox. The only
 * thing decided here is the POLICY on top: a king outranks any material (it
 * carries the stake), and so does a stone, which holds its army's whole stake
 * and is worth nothing as material (`docs/adr/0014`).
 *
 * WHAT IT SEES (the framework's PA6): the board through the contract's own
 * resolving view (`getPieces`), its army through the registry (`getArmy`), and
 * the simulation. It decides in the COMMIT phase, when the board is the one the
 * cycle started with, which is the board the route judges a move against.
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
import {wholeMoveRoute, type WholeMoveCall} from './piece-moves';
import {piecesAround} from './planning';
import {positionOf} from './squares';

/** The level that captures greedily. */
export const GREEDY_LEVEL = 'greedy';

/**
 * How far around its king a seat looks for its own pieces, in squares on each
 * axis. An army's pieces start within two squares of its king and move a few
 * squares per cycle, so this holds all of them for a long while; a piece that
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
	/** The whole-move route (`isLegalWholeMove`, `legalMovesAlongside`), run in the sandbox. */
	wholeMove: WholeMoveCall;
	/** The game's cap, `getMaxPieceMoves`: 3, or 1 at a table that turns three off. */
	maxPieceMoves: () => Promise<number>;
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

	// Nor does the cap: asked once, and again only after a failed read.
	let readingCap: Promise<number> | undefined;
	const capOf = () => {
		readingCap ??= params.maxPieceMoves().catch((error: unknown) => {
			readingCap = undefined;
			throw error;
		});
		return readingCap;
	};

	return async ({identity, level, random, budget}) => {
		if (level !== GREEDY_LEVEL || budget.actionsAtMost < 1) return [];
		const army = await params.readArmy(identity);
		if (army.status !== ARMY_STATUS.Deployed) return [];
		const cap = await capOf();
		const route = wholeMoveRoute({call: params.wholeMove, maxPieceMoves: cap});
		const most = Math.min(cap, budget.actionsAtMost);

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

		const value = (to: bigint) =>
			captureValue(
				pieces.get(to),
				identity,
				(kind) => material.get(kind) ?? 0,
				kingValue,
			);

		// One piece-move at a time, each offered by the route ALONGSIDE the ones
		// already picked: the route knows which squares they vacate and refuses
		// a second piece-move to one square, so nothing of that is decided here.
		const chosen: Move[] = [];
		while (chosen.length < most) {
			const candidates: Candidate[] = [];
			for (const piece of own) {
				if (chosen.some((move) => move.from === piece.position)) continue;
				const destinations = await route.alongside(
					piecesAround(pieces, [
						piece.position,
						...chosen.map((move) => move.from),
					]),
					piece.position,
					chosen,
				);
				for (const to of destinations) {
					candidates.push({move: {from: piece.position, to}, value: value(to)});
				}
			}
			const move = chooseGreedyMove(candidates, (n) => random.below(n));
			if (!move) break;
			chosen.push(move);
		}

		// The whole move, judged as the reveal will judge it. Every piece-move
		// was offered alongside the others, so this holds; should it not, the
		// last ones are dropped rather than an illegal move committed (a reveal
		// that reverts freezes the army, `docs/adr/0005`).
		const board = piecesAround(
			pieces,
			chosen.map((move) => move.from),
		);
		while (
			chosen.length > 0 &&
			!(await route.isLegal(board, identity, chosen))
		) {
			chosen.pop();
		}
		return chosen;
	};
}
