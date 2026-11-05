/**
 * What the renderer draws: the board, plus what the player has planned but not
 * yet committed.
 *
 * The planned layer is the reason a view state exists separately from the
 * onchain state: a deployment is real to the player and invisible to everyone
 * else until it is revealed, and the client is the only thing that can show
 * it. A planned army is drawn as a GHOST of the pieces the contract says it
 * would stand on (`./preview.ts`), never merged into the confirmed board.
 */
import type {ViewMerge} from '$lib/view';
import type {BoardState, Piece} from './board';
import {positionOf, type Position} from './squares';
import {describeSpawnPoints, type SpawnPointView} from './spawn-points';

export type PieceView = Piece & {position2d: Position};

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
};

const withPosition = (piece: Piece): PieceView => ({
	...piece,
	position2d: positionOf(piece.position),
});

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
	};
};
