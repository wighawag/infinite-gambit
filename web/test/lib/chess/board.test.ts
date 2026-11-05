import {describe, it, expect} from 'vitest';
import {
	rectOfZones,
	squareAt,
	positionOf,
	zonesInRect,
} from '$lib/chess/squares';
import {createBoardReader, PIECE_KIND, type BoardState} from '$lib/chess/board';
import {mergeBoardView} from '$lib/chess/view';
import {MOVE_STORAGE} from '$lib/chess/storage';
import {bondFor, deploymentAt, spawnPointOf} from '$lib/chess/commit-reveal';

/**
 * The client's halves of the wire: how a square is spelled, which squares a
 * viewport read asks the contract for, how a move is stored, and what a
 * submission bonds. None of it is a rule of the game.
 */

describe('squares', () => {
	it('packs a coordinate pair the way the contract does, both ways', () => {
		for (const [x, y] of [
			[0, 0],
			[-3, 7],
			[16, -16],
			[-2147483648, 2147483647],
		]) {
			expect(positionOf(squareAt(x, y))).toEqual({x, y});
		}
		// y in the high 32 bits, x in the low 32, two's complement.
		expect(squareAt(1, 0)).toBe(1n);
		expect(squareAt(0, 1)).toBe(1n << 32n);
		expect(squareAt(-1, 0)).toBe(0xffffffffn);
	});

	it('turns the zones in view into one rectangle covering all of them', () => {
		const zones = zonesInRect({left: -20, top: -5, right: 20, bottom: 5});
		expect(rectOfZones(zones)).toEqual({
			minX: -32,
			minY: -16,
			maxX: 31,
			maxY: 15,
		});
		expect(rectOfZones([])).toBeUndefined();
	});
});

describe('reading the board', () => {
	it('asks for the pieces in the rectangle in view, pinned to one block', async () => {
		const calls: {functionName: string; args: unknown[]; block: bigint}[] = [];
		const read = createBoardReader({
			deployments: {
				contracts: {
					Game: {
						address: '0x2222222222222222222222222222222222222222',
						abi: [],
					},
				},
			} as never,
			publicClient: {
				readContract: async (request: {
					functionName: string;
					args: unknown[];
					blockNumber: bigint;
				}) => {
					calls.push({
						functionName: request.functionName,
						args: request.args,
						block: request.blockNumber,
					});
					if (request.functionName === 'getPieces') {
						return [
							[
								{
									position: squareAt(1, 2),
									army: 7n,
									kind: PIECE_KIND.King,
									forward: 0,
									moved: false,
								},
							],
							3n,
						];
					}
					if (request.functionName === 'getOpenSpawnPoints') {
						return [[squareAt(0, 0)], 3n];
					}
					return [[], 0n];
				},
			} as never,
		});
		const zones = zonesInRect({left: 0, top: 0, right: 10, bottom: 10});
		const state = await read({
			zones,
			fromBlock: 0,
			toBlock: 42,
			expectedCycleNumber: 3,
		});
		expect(state?.cycleNumber).toBe(3);
		expect(state?.pieces.get(squareAt(1, 2))?.kind).toBe(PIECE_KIND.King);
		expect(state?.spawnPoints).toEqual([squareAt(0, 0)]);
		const pieces = calls.find((call) => call.functionName === 'getPieces');
		expect(pieces?.args).toEqual([0, 0, 15, 15]);
		expect(calls.every((call) => call.block === 42n)).toBe(true);
	});
});

describe('the view', () => {
	it('draws a planned deployment as a ghost, apart from the board', () => {
		const onchain: BoardState = {
			pieces: new Map(),
			spawnPoints: [squareAt(0, 0), squareAt(16, 0)],
			armies: [],
		};
		const ghost = {
			position: squareAt(-2, 0),
			army: 9n,
			kind: PIECE_KIND.King,
			forward: 0 as const,
			moved: false,
		};
		const view = mergeBoardView({
			onchain,
			local: {spawnPoint: squareAt(16, 0), army: 9n, preview: [ghost]},
			cycleNumber: 3,
		});
		expect(view.pieces.size).toBe(0);
		expect(view.planned?.position).toEqual({x: 16, y: 0});
		expect(view.ghost.map((piece) => piece.position2d)).toEqual([
			{x: -2, y: 0},
		]);
		expect(view.you).toBe(9n);
		expect(view.spawnPoints).toHaveLength(2);
	});
});

describe('a submission', () => {
	it('stores a move as two decimal strings, and reads it back', () => {
		const move = {from: squareAt(-3, 5), to: squareAt(-3, 6)};
		const stored = MOVE_STORAGE.encode(move);
		expect(stored).toEqual({
			from: move.from.toString(),
			to: move.to.toString(),
		});
		expect(MOVE_STORAGE.decode(JSON.parse(JSON.stringify(stored)))).toEqual(
			move,
		);
	});

	it('bonds the stake for a deployment and nothing for a pass', () => {
		const config = {stake: 10n} as never;
		const deployment = deploymentAt(squareAt(16, 0));
		expect(spawnPointOf(deployment)).toBe(squareAt(16, 0));
		expect(bondFor(config, deployment)).toBe(10n);
		expect(spawnPointOf([])).toBeUndefined();
		expect(bondFor(config, [])).toBe(0n);
	});
});
