/**
 * What the renderer draws: the board, plus what the player has planned but not
 * yet committed.
 *
 * The planned layer is the reason a view state exists separately from the
 * onchain state: a deployment is real to the player and invisible to everyone
 * else until it is revealed, and the client is the only thing that can show
 * it. A planned army is drawn as a GHOST of the pieces the contract says it
 * would stand on (`./preview.ts`), never merged into the confirmed board, and
 * a planned move as a mark from its square to its destination: the piece
 * stays where the chain has it until the cycle is over.
 */
import type {ViewMerge} from '$lib/view';
import {PIECE_KIND, type BoardState, type Piece} from './board';
import {positionOf, type Position} from './squares';
import {describeSpawnPoints, type SpawnPointView} from './spawn-points';
import type {SquareOutcome} from './outcomes';
import {ARMY_STATUS, type ArmyView} from './armies';
import {STAKE} from './stake';

export type PieceView = Piece & {position2d: Position};

/** A square the last closed cycle changed by a capture or a collision. */
export type OutcomeView = SquareOutcome & {position2d: Position};

/**
 * A king on the board, labelled with what its army holds: the registry's
 * stake, as the contract resolves it (story 46).
 */
export type KingView = {
	army: bigint;
	position2d: Position;
	stake: bigint;
	stakeLabel: string;
	/** Its army is frozen (`docs/adr/0005-missed-reveal-freezes-the-army.md`). */
	frozen: boolean;
};

/**
 * A stone on the board, labelled with the stake it holds: the registry's stake
 * for the army it was, which nobody has taken yet (`docs/adr/0014`).
 */
export type StoneView = {
	army: bigint;
	position2d: Position;
	stake: bigint;
	stakeLabel: string;
};

export type BoardView = {
	pieces: Map<bigint, PieceView>;
	/** The open spawn points, with how close the nearest armies are. */
	spawnPoints: readonly SpawnPointView[];
	/** The spawn point the player has planned to deploy at, if any. */
	planned?: SpawnPointView;
	/**
	 * Where the planned army would stand, by the contract's own rule run in
	 * the sandbox. Absent until it answers.
	 */
	ghost: readonly PieceView[];
	/** The army this client plays, for telling its pieces apart. */
	you?: bigint;
	/** The piece the player has selected to move, if any. */
	selected?: Position;
	/**
	 * The king or stone clicked: the only one whose stake label is drawn.
	 * Always drawn, the labels covered the pieces around them.
	 */
	inspected?: Position;
	/**
	 * Where the selected piece may move, by the contract's rule run in the
	 * sandbox (`legalMoves`). Empty until it answers.
	 */
	destinations?: readonly Position[];
	/** The move the player has planned this cycle, if any. */
	plannedMove?: {from: Position; to: Position};
	/**
	 * What the last closed cycle did: the squares where a piece was captured
	 * or pieces died colliding, as the contract resolved them.
	 */
	outcomes: readonly OutcomeView[];
	/** The cycle {@link outcomes} happened in; -1 before any was read. */
	outcomesCycle: number;
	/** Every king standing on the board, with its army's stake. */
	kings?: readonly KingView[];
	/** Every stone in view, with the stake it holds. */
	stones?: readonly StoneView[];
	/**
	 * The armies the registry says are frozen, a missed reveal not yet settled
	 * included: their pieces are drawn greyed out.
	 */
	frozen?: ReadonlySet<bigint>;
	/**
	 * Where an enemy piece may move this cycle, by the contract's rule run in
	 * the sandbox (`./attacked.ts`). Empty until it answers, and while the
	 * army this client plays is not on the board.
	 */
	attacked?: readonly Position[];
};

export type LocalPlan = {
	/** The spawn point picked this cycle. */
	spawnPoint?: bigint;
	/** The army the deployment is for. */
	army?: bigint;
	/**
	 * The pieces that army would stand on there, when the sandbox has answered
	 * for exactly this spawn point.
	 */
	preview?: readonly Piece[];
	/** The one move planned this cycle, for a deployed army. */
	move?: {from: bigint; to: bigint};
	/** The piece selected to move. */
	selected?: bigint;
	/** The king or stone whose stake label is shown (clicked). */
	inspected?: bigint;
	/** Its legal destinations, once the sandbox has answered. */
	destinations?: readonly bigint[];
	/** Where an enemy piece may move this cycle, once the sandbox has answered. */
	attacked?: readonly bigint[];
};

const withPosition = (piece: Piece): PieceView => ({
	...piece,
	position2d: positionOf(piece.position),
});

/** Statuses of an army whose king stands on the board. */
const KING_ON_THE_BOARD: ReadonlySet<number> = new Set([
	ARMY_STATUS.Deployed,
	ARMY_STATUS.Frozen,
]);

/**
 * Every king on the board, at the square the registry has it on and with the
 * stake the registry says its army holds (the stakes of the armies it took
 * included, as far as the registry counts them). Nothing is worked out here:
 * both are the contract's answers.
 */
export function kingsOf(armies: readonly ArmyView[]): KingView[] {
	return armies
		.filter((army) => KING_ON_THE_BOARD.has(army.status))
		.map((army) => {
			const frozen = army.status === ARMY_STATUS.Frozen;
			return {
				army: army.id,
				position2d: positionOf(army.king),
				stake: army.stake,
				stakeLabel: frozen
					? `${STAKE.amount(army.stake)} (frozen)`
					: STAKE.amount(army.stake),
				frozen,
			};
		});
}

/**
 * Every stone among `pieces`, with the stake the registry says its army still
 * holds: a stone is labelled with the army it was, whose stake is its own
 * until someone captures it. Nothing is worked out here either.
 */
export function stonesOf(
	pieces: ReadonlyMap<bigint, Piece>,
	armies: readonly ArmyView[],
): StoneView[] {
	const stakes = new Map(armies.map((army) => [army.id, army.stake]));
	const stones: StoneView[] = [];
	for (const piece of pieces.values()) {
		if (piece.kind !== PIECE_KIND.Stone) continue;
		const stake = stakes.get(piece.army) ?? 0n;
		stones.push({
			army: piece.army,
			position2d: positionOf(piece.position),
			stake,
			stakeLabel: `${STAKE.amount(stake)} (stone)`,
		});
	}
	return stones;
}

/** The armies the registry says are frozen. */
export function frozenArmiesOf(armies: readonly ArmyView[]): Set<bigint> {
	return new Set(
		armies
			.filter((army) => army.status === ARMY_STATUS.Frozen)
			.map((army) => army.id),
	);
}

/**
 * Combine the confirmed board with local intent. Copied rather than annotated,
 * so a re-derive never leaves a planned mark behind on the onchain store.
 */
export const mergeBoardView: ViewMerge<BoardState, LocalPlan, BoardView> = ({
	onchain,
	local,
}) => {
	const pieces = new Map<bigint, PieceView>();
	for (const [square, piece] of onchain.pieces) {
		pieces.set(square, withPosition(piece));
	}
	const spawnPoints = describeSpawnPoints({
		spawnPoints: onchain.spawnPoints,
		armies: onchain.armies,
	});
	const planned =
		local.spawnPoint === undefined
			? undefined
			: (spawnPoints.find((point) => point.spawnPoint === local.spawnPoint) ??
				describeSpawnPoints({
					spawnPoints: [local.spawnPoint],
					armies: onchain.armies,
				})[0]);
	return {
		pieces,
		spawnPoints,
		...(planned ? {planned} : {}),
		ghost: (local.preview ?? []).map(withPosition),
		...(local.army !== undefined ? {you: local.army} : {}),
		...(local.selected !== undefined
			? {selected: positionOf(local.selected)}
			: {}),
		...(local.inspected !== undefined
			? {inspected: positionOf(local.inspected)}
			: {}),
		destinations: (local.destinations ?? []).map(positionOf),
		outcomes: [...onchain.outcomes.bySquare.values()].map((outcome) => ({
			...outcome,
			position2d: positionOf(outcome.position),
		})),
		outcomesCycle: onchain.outcomes.cycleNumber,
		kings: kingsOf(onchain.armies),
		stones: stonesOf(onchain.pieces, onchain.armies),
		frozen: frozenArmiesOf(onchain.armies),
		attacked: (local.attacked ?? []).map(positionOf),
		...(local.move
			? {
					plannedMove: {
						from: positionOf(local.move.from),
						to: positionOf(local.move.to),
					},
				}
			: {}),
	};
};
