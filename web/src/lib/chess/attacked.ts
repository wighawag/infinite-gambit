/**
 * THE ATTACKED SQUARES: where an enemy piece may move this cycle, so a player
 * does not walk into a capture by accident (user story 21).
 *
 * WHAT "ATTACKED" MEANS HERE, and why it is not chess's word. Every army moves
 * at once and every move is judged against the board as it stood at the START
 * of the cycle (`ChessRules.isLegalMove`, story 12). So a square is dangerous
 * exactly when an enemy piece may LEGALLY move onto it this cycle: a piece of
 * mine standing there is captured, and one of mine arriving there collides
 * with it (`docs/adr/0003-collision-table-king-survives-a-crowd.md`). That is
 * the union of `legalMoves` over the enemy's pieces, on the board the cycle
 * started with, and nothing else. It differs from the chess picture where the
 * rule does: a pawn steps one square every way and captures on all four
 * diagonals (`docs/adr/0015`), and an enemy pawn's diagonal onto an empty
 * square is not marked (that pawn may not move there this cycle, whatever I
 * do), while its steps onto empty squares are.
 *
 * THE RULE IS THE CONTRACT'S. `legalMoves` is the Simulation route's own
 * bytecode run in the sandbox, as it is for the player's own destinations
 * (`./planning.ts`); this file only chooses whose pieces to ask about and
 * gathers the answers (`docs/adr/0007-rules-live-only-in-the-contract.md`).
 *
 * WHOSE PIECES. An army that can move: one the registry has on the board and
 * not frozen. A frozen army never moves again, so it threatens nothing, and
 * neither does a stone, which never moves (`docs/adr/0014`).
 */
import {derived, type Readable} from 'svelte/store';
import {latestResult, type LatestResult} from '$lib/game/simulation';
import type {OnchainStateValue} from '$lib/game/core/seams';
import {ARMY_STATUS, type ArmyView} from './armies';
import {PIECE_KIND, type BoardState, type Piece} from './board';
import {piecesAround} from './planning';
import type {LocalPlan} from './view';

/** `legalMoves`, the contract's rule, run in the sandbox. */
export type LegalMoves = (
	pieces: readonly Piece[],
	from: bigint,
) => Promise<readonly bigint[]>;

/**
 * The pieces that may move this cycle against `you`: every piece of another
 * army the registry has standing on the board (not frozen), stones aside.
 */
export function attackersOf(params: {
	pieces: ReadonlyMap<bigint, Piece>;
	armies: readonly Pick<ArmyView, 'id' | 'status'>[];
	you: bigint;
}): Piece[] {
	const moving = new Set(
		params.armies
			.filter((army) => army.status === ARMY_STATUS.Deployed)
			.map((army) => army.id),
	);
	const attackers: Piece[] = [];
	for (const piece of params.pieces.values()) {
		if (piece.army === params.you || piece.kind === PIECE_KIND.Stone) continue;
		if (moving.has(piece.army)) attackers.push(piece);
	}
	return attackers.sort((a, b) =>
		a.position < b.position ? -1 : a.position > b.position ? 1 : 0,
	);
}

/**
 * Every square one of `attackers` may move to on `pieces`, by the contract's
 * rule: each is asked about its own neighbourhood, as the player's own pieces
 * are. In square order, each once.
 */
export async function attackedSquares(params: {
	pieces: ReadonlyMap<bigint, Piece>;
	attackers: readonly Piece[];
	legalMoves: LegalMoves;
}): Promise<bigint[]> {
	const answers = await Promise.all(
		params.attackers.map((attacker) =>
			params.legalMoves(
				piecesAround(params.pieces, attacker.position),
				attacker.position,
			),
		),
	);
	const squares = new Set<bigint>();
	for (const answer of answers)
		for (const square of answer) squares.add(square);
	return [...squares].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

type AttackInput = {
	you: bigint;
	pieces: ReadonlyMap<bigint, Piece>;
	attackers: readonly Piece[];
	key: string;
};

const keyOf = (you: bigint, pieces: ReadonlyMap<bigint, Piece>) =>
	`${you}|${[...pieces.values()]
		.map((p) => `${p.position}:${p.army}:${p.kind}`)
		.sort()
		.join(',')}`;

export type AttackedSquaresStore = Readable<
	LatestResult<AttackInput, readonly bigint[]>
>;

/**
 * The attacked squares of the board in view, for the army this client plays,
 * while it stands on the board: an army that is deploying, frozen or gone has
 * no move to walk into a capture with. Re-run when the board read changes, and
 * only then.
 */
export function createAttackedSquares(params: {
	board: Readable<OnchainStateValue<BoardState>>;
	you: Readable<bigint | undefined>;
	legalMoves: LegalMoves;
}): AttackedSquaresStore {
	const inputs = derived(
		[params.board, params.you],
		([$board, $you]): AttackInput | undefined => {
			if ($board.step !== 'Loaded' || $you === undefined) return undefined;
			const mine = $board.armies.find((army) => army.id === $you);
			if (mine?.status !== ARMY_STATUS.Deployed) return undefined;
			const attackers = attackersOf({
				pieces: $board.pieces,
				armies: $board.armies,
				you: $you,
			});
			return {
				you: $you,
				pieces: $board.pieces,
				attackers,
				key: `${keyOf($you, $board.pieces)}|${attackers
					.map((p) => p.position)
					.join(',')}`,
			};
		},
	);
	return latestResult(
		inputs,
		({pieces, attackers}) =>
			attackedSquares({pieces, attackers, legalMoves: params.legalMoves}),
		{equal: (a, b) => a.key === b.key},
	);
}

/**
 * The plan with the attacked squares, attached only when they were worked out
 * for the army the plan is for.
 */
export function withAttacked(
	plan: Readable<LocalPlan>,
	attacked: AttackedSquaresStore,
): Readable<LocalPlan> {
	return derived([plan, attacked], ([$plan, $attacked]): LocalPlan => {
		if ($attacked.step !== 'Ready' || $attacked.input.you !== $plan.army) {
			return $plan;
		}
		return {...$plan, attacked: $attacked.result};
	});
}
