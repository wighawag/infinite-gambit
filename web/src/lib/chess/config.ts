/**
 * The game's constants, read off the deployment.
 *
 * Everything here comes from the Game contract's `linkedData` (what the deploy
 * script recorded) rather than being duplicated in the front end, so changing
 * the stake, the spawn grid or the phase durations in `contracts/deploy` cannot
 * leave the UI describing a different game from the one on chain.
 */
import type {TypedDeployments} from '$lib/core/connection/types';
import {
	resolveCommitRevealConfig,
	signerStipend,
	type CommitRevealConfig,
	type CommitRevealLinkedData,
} from '$lib/game/core/commit-reveal/config';
import {
	optionalBigInt,
	readBigInt,
	readNumber,
	type DeclaredValues,
} from '$lib/game/core/linked-data';

/**
 * The base's config (the cycle, the chunk, the expected turn, the gas, the
 * token: `$lib/game/core/commit-reveal/config`) and this game's own.
 */
export type ChessConfig = CommitRevealConfig & {
	/**
	 * What one army holds: moved from the account's reserve into the army's
	 * when its deployment is committed, and what that commitment bonds.
	 */
	stake: bigint;
	/** The distance between two spawn points on each axis. */
	spawnSpacing: number;
	/** How many free spawn points are open at once. */
	openSpawnPoints: number;
	/**
	 * Where a stake is acquired, and what it costs.
	 *
	 * The price is read off the SALE's own `linkedData` rather than the Game's,
	 * because it is the sale contract's to state: `StakeSale.purchase` reverts
	 * with `WrongPaymentAmount` unless the value it is sent matches exactly.
	 */
	sale: {
		address: `0x${string}`;
		/** In the chain's native currency, exact. Not a minimum. */
		price: bigint;
		/** How much reserve one purchase credits: one army's stake. */
		amount: bigint;
		/**
		 * What the purchase forwards to the local signer, in the same
		 * transaction, sized in TURNS: see `signerStipend`.
		 */
		stipend: bigint;
	};
	/**
	 * Pixels per square at 1:1 zoom. Only a scene-graph renderer cares; the
	 * camera and the click maths are in squares.
	 */
	cellSize: number;
	/** What the camera may show, in SQUARES. */
	camera: {
		/** How much board is visible on the first frame. */
		initialVisible: {width: number; height: number};
		/** Zoom limits, as the smallest and largest slice of board on screen. */
		limits: {
			minWidth: number;
			minHeight: number;
			maxWidth: number;
			maxHeight: number;
		};
	};
};

export function resolveChessConfig(deployments: TypedDeployments): ChessConfig {
	const linkedData = deployments.contracts.Game
		.linkedData as CommitRevealLinkedData;
	const StakeSale = deployments.contracts.StakeSale;
	const saleData = StakeSale.linkedData as DeclaredValues;
	const base = resolveCommitRevealConfig(linkedData);

	// The chain's own statement of the worst gas price it expects. A chain that
	// does not declare one gets NO stipend rather than a guessed one.
	const worstGasPrice =
		optionalBigInt(deployments.chain.properties, 'expectedWorstGasPrice') ?? 0n;

	return {
		...base,
		stake: readBigInt(linkedData, 'stake'),
		spawnSpacing: readNumber(linkedData, 'spawnSpacing'),
		openSpawnPoints: readNumber(linkedData, 'openSpawnPoints'),
		sale: {
			address: StakeSale.address,
			price: readBigInt(saleData, 'price'),
			amount: readBigInt(saleData, 'amount'),
			stipend: signerStipend(base, worstGasPrice),
		},
		cellSize: 16,
		camera: {
			// Room for the open spawn points around the origin (two grid steps
			// either way at the world's spacing) on the first frame.
			initialVisible: {width: 72, height: 72},
			limits: {minWidth: 12, minHeight: 12, maxWidth: 160, maxHeight: 160},
		},
	};
}
