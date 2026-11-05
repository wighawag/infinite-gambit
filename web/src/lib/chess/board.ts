/**
 * Reading the board: the pieces in view, the open spawn points and the army
 * registry, all RESOLVED by the contract.
 *
 * The client fetches ONLY THE AREA IN VIEW (`getPieces` over the rectangle the
 * camera's zones cover), so the world stays fast however large it grows. And it
 * reconstructs nothing: what is stored on chain is the cycle's facts, not the
 * board, so the board is whatever the contract's resolving views say
 * (`docs/adr/0007-rules-live-only-in-the-contract.md`).
 */
import type {
	TypedDeployments,
	TypedPublicClient,
} from '$lib/core/connection/types';
import type {ZonesForCamera, ZonesReader} from '$lib/onchain/state';
import {armyViewOf, type ArmyView} from './armies';
import {
	accumulateOutcomes,
	noOutcomes,
	outcomeOf,
	type CycleOutcomes,
} from './outcomes';
import {rectOfZones, zonesInRect} from './squares';

/** `UsingGameTypes.PieceKind`, by value. The order is the contract's. */
export const PIECE_KIND = {
	None: 0,
	Pawn: 1,
	Knight: 2,
	Bishop: 3,
	Rook: 4,
	Queen: 5,
	King: 6,
} as const;
export type PieceKind = (typeof PIECE_KIND)[keyof typeof PIECE_KIND];

/** `UsingGameTypes.Direction`, by value: which way a pawn advances. */
export const DIRECTION = {North: 0, East: 1, South: 2, West: 3} as const;
export type Direction = (typeof DIRECTION)[keyof typeof DIRECTION];

/** One piece, as the contract resolves it. */
export type Piece = {
	position: bigint;
	army: bigint;
	kind: PieceKind;
	forward: Direction;
	moved: boolean;
};

export type BoardState = {
	/** The pieces in view, by square. */
	pieces: Map<bigint, Piece>;
	/** Where a deployment committed now may be revealed, nearest first. */
	spawnPoints: readonly bigint[];
	/** Every army, resolved: what "how close are the nearest armies" reads. */
	armies: readonly ArmyView[];
	/**
	 * What the last closed cycle did in view: its captures and collisions, as
	 * the contract resolves them (`./outcomes.ts`).
	 */
	outcomes: CycleOutcomes;
};

export const emptyBoard = (): BoardState => ({
	pieces: new Map(),
	spawnPoints: [],
	armies: [],
	outcomes: noOutcomes(),
});

/** Normalise a piece as viem hands it back. */
export function pieceOf(raw: {
	position: bigint;
	army: bigint;
	kind: number;
	forward: number;
	moved: boolean;
}): Piece {
	return {
		position: raw.position,
		army: raw.army,
		kind: raw.kind as PieceKind,
		forward: raw.forward as Direction,
		moved: raw.moved,
	};
}

/**
 * How much beyond the visible area to load, as a fraction of the camera's own
 * size, so pieces do not pop in at the edge during a pan.
 */
const CAMERA_MARGIN = 0.5;

export const zonesForCamera: ZonesForCamera = (camera) => {
	const halfWidth = (camera.width / 2) * (1 + CAMERA_MARGIN);
	const halfHeight = (camera.height / 2) * (1 + CAMERA_MARGIN);
	return zonesInRect({
		left: camera.x - halfWidth,
		right: camera.x + halfWidth,
		top: camera.y - halfHeight,
		bottom: camera.y + halfHeight,
	});
};

/** How many registry entries one read asks for. */
const ARMIES_PER_PAGE = 100n;

export function createBoardReader(params: {
	publicClient: TypedPublicClient;
	deployments: TypedDeployments;
}): ZonesReader<BoardState> {
	const {publicClient, deployments} = params;
	const game = {
		address: deployments.contracts.Game.address,
		abi: deployments.contracts.Game.abi,
	};

	async function read<T>(
		functionName: string,
		args: unknown[],
		blockNumber: bigint,
	): Promise<T> {
		return (await publicClient.readContract({
			...game,
			functionName,
			args,
			// PINNED TO ONE BLOCK, every read of one fetch: a reveal landing
			// between two of them would otherwise stitch a board that never
			// existed at any moment.
			blockNumber,
		} as never)) as T;
	}

	// The last cycle's outcomes, kept across reads: see `./outcomes.ts` for why
	// a read can only add to what the one before it found.
	let outcomes = noOutcomes();

	return async ({zones, expectedCycleNumber, toBlock}) => {
		const block = BigInt(toBlock);
		const rect = rectOfZones(zones);

		const [piecesRead, spawnRead, armies, outcomesRead] = await Promise.all([
			rect
				? read<readonly [readonly Parameters<typeof pieceOf>[0][], bigint]>(
						'getPieces',
						[rect.minX, rect.minY, rect.maxX, rect.maxY],
						block,
					)
				: Promise.resolve([[], 0n] as const),
			read<readonly [readonly bigint[], bigint]>(
				'getOpenSpawnPoints',
				[],
				block,
			),
			readAllArmies(block),
			rect
				? read<readonly [readonly Parameters<typeof outcomeOf>[0][], bigint]>(
						'getOutcomes',
						[rect.minX, rect.minY, rect.maxX, rect.maxY],
						block,
					)
				: Promise.resolve(undefined),
		]);
		if (outcomesRead) {
			outcomes = accumulateOutcomes(outcomes, {
				cycleNumber: Number(outcomesRead[1]),
				outcomes: outcomesRead[0].map(outcomeOf),
			});
		}

		const pieces = new Map<bigint, Piece>();
		for (const raw of piecesRead[0]) {
			const piece = pieceOf(raw);
			pieces.set(piece.position, piece);
		}

		// STAMPED WITH THE CYCLE THE FETCH WAS FOR, as the template's reader is:
		// that is what "has the board caught up" means downstream.
		return {
			pieces,
			spawnPoints: [...spawnRead[0]],
			armies,
			outcomes,
			cycleNumber: expectedCycleNumber,
		};
	};

	async function readAllArmies(block: bigint): Promise<ArmyView[]> {
		const armies: ArmyView[] = [];
		for (let offset = 0n; ; offset += ARMIES_PER_PAGE) {
			const [page, total] = await read<
				readonly [readonly Parameters<typeof armyViewOf>[0][], bigint]
			>('getArmies', [offset, ARMIES_PER_PAGE], block);
			armies.push(...page.map(armyViewOf));
			if (offset + ARMIES_PER_PAGE >= total) return armies;
		}
	}
}
