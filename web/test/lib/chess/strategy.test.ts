import {describe, it, expect, beforeAll, afterAll} from 'vitest';
import type {Abi} from 'viem';
import {createNode} from 'webevm';
import {createEmbeddedWorld, type EmbeddedWorld} from '$lib/embedded';
import {
	config,
	extensions,
} from 'chess-battleground-contracts/rocketh/config.js';
import {OFFLINE_DEPLOYMENT} from '$lib/offline';
import {
	createBytecodeSandbox,
	type BytecodeSandbox,
} from '$lib/game/simulation';
import {seededRandom} from '$lib/game/core/strategy';
import {ARMY_STATUS, type ArmyView} from '$lib/chess/armies';
import {PIECE_KIND, type Piece, type PieceKind} from '$lib/chess/board';
import {squareAt} from '$lib/chess/squares';
import {
	GREEDY_LEVEL,
	captureValue,
	chooseGreedyMove,
	createChessStrategy,
	type Candidate,
} from '$lib/chess/strategy';

/**
 * THE GREEDY SEAT'S CHOICE: the most valuable capture it can reach, else a
 * random legal move. Which moves are legal and what a piece is worth are the
 * Simulation route's own `legalMoves` and `materialOf`, run here from the
 * deployed bytecode of an offline world in a sandbox, exactly as the world's
 * seats run them; only the board is handed in.
 */

const CHAIN_ID = 9007199254740131;
const OWN = (1n << 160n) | 0xabcn;
const ENEMY = (1n << 160n) | 0xdefn;
const OTHER = (2n << 160n) | 0xdefn;

const piece = (x: number, y: number, kind: PieceKind, army: bigint): Piece => ({
	position: squareAt(x, y),
	army,
	kind,
});

let world: EmbeddedWorld;
let sandbox: BytecodeSandbox<'rules'>;
let abi: Abi;

beforeAll(async () => {
	world = await createEmbeddedWorld({
		chainId: CHAIN_ID,
		chain: {
			name: 'Offline',
			nativeCurrency: {name: 'Ether', symbol: 'ETH', decimals: 18},
			properties: {...config.chains[31337].properties},
		},
		rocketh: {config, extensions},
		environment: OFFLINE_DEPLOYMENT.environment,
		scripts: [...OFFLINE_DEPLOYMENT.scripts],
		data: {...OFFLINE_DEPLOYMENT.data},
		accounts: {...OFFLINE_DEPLOYMENT.accounts},
		initialBalances: {...OFFLINE_DEPLOYMENT.initialBalances},
	});
	const records = world.deployments.get();
	abi = records.contracts.Game.abi as Abi;
	sandbox = createBytecodeSandbox({
		provider: world.provider as never,
		node: () => createNode({}) as never,
		contracts: {
			rules: {
				address:
					records.contracts.Game_Implementation_Router_Simulation_Route.address,
			},
		},
	});
}, 120_000);

afterAll(async () => {
	sandbox?.dispose();
	await world?.dispose();
});

const legalMoves = async (board: readonly Piece[], from: bigint) => [
	...((await sandbox.call({
		contract: 'rules',
		abi,
		functionName: 'legalMoves',
		args: [board, from],
	} as never)) as unknown as readonly bigint[]),
];

const materialOf = async (kind: PieceKind) =>
	Number(
		(await sandbox.call({
			contract: 'rules',
			abi,
			functionName: 'materialOf',
			args: [kind],
		} as never)) as unknown as bigint,
	);

function strategyOn(board: readonly Piece[]) {
	let legalMovesCalls = 0;
	const strategy = createChessStrategy({
		readArmy: async (army): Promise<ArmyView> => ({
			id: army,
			owner: '0x0000000000000000000000000000000000000abc',
			status: ARMY_STATUS.Deployed,
			deployedIn: 1n,
			spawnPoint: 0n,
			king: squareAt(0, -2),
			stake: 1n,
			capturedBy: 0n,
		}),
		readPieces: async () => board,
		legalMoves: async (around, from) => {
			legalMovesCalls++;
			return legalMoves(around, from);
		},
		materialOf,
	});
	const decide = (cycleNumber = 1, level = GREEDY_LEVEL) =>
		strategy({
			identity: OWN,
			cycleNumber,
			level,
			random: seededRandom({
				chainId: CHAIN_ID,
				contract: '0x00000000000000000000000000000000000000aa',
				identity: OWN,
				cycleNumber,
			}),
			budget: {actionsAtMost: 1},
		});
	return {decide, calls: () => legalMovesCalls};
}

describe('captureValue and chooseGreedyMove', () => {
	const material = (kind: PieceKind) =>
		({1: 1, 2: 3, 3: 3, 4: 5, 5: 9})[kind as 1] ?? 0;

	it('values an enemy piece by material, a king and a stone above everything, and nothing for its own army or an empty square', () => {
		const at = (kind: PieceKind, army: bigint) =>
			captureValue({kind, army}, OWN, material, 10);
		expect(at(PIECE_KIND.Queen, ENEMY)).toBe(9);
		expect(at(PIECE_KIND.Pawn, ENEMY)).toBe(1);
		expect(at(PIECE_KIND.King, ENEMY)).toBe(10);
		expect(at(PIECE_KIND.Stone, ENEMY)).toBe(10);
		expect(at(PIECE_KIND.Queen, OWN)).toBe(0);
		expect(captureValue(undefined, OWN, material, 10)).toBe(0);
	});

	it('picks among the best captures, and among every move when there is none', () => {
		const move = (to: bigint): Candidate['move'] => ({from: 0n, to});
		const candidates: Candidate[] = [
			{move: move(1n), value: 0},
			{move: move(2n), value: 5},
			{move: move(3n), value: 5},
			{move: move(4n), value: 1},
		];
		const picked = new Set<bigint>();
		for (let i = 0; i < 4; i++) {
			picked.add(chooseGreedyMove(candidates, () => i % 2)!.to);
		}
		expect([...picked].sort()).toEqual([2n, 3n]);
		const quiet = candidates.map((c) => ({...c, value: 0}));
		expect(chooseGreedyMove(quiet, (n) => n - 1)?.to).toBe(4n);
		expect(chooseGreedyMove([], () => 0)).toBeUndefined();
	});
});

describe('the greedy strategy, scored by the deployed rules', () => {
	it('captures the most valuable piece it can reach', async () => {
		const {decide} = strategyOn([
			piece(0, 0, PIECE_KIND.Rook, OWN),
			piece(0, 4, PIECE_KIND.Queen, ENEMY),
			piece(4, 0, PIECE_KIND.Pawn, OTHER),
		]);
		expect(await decide()).toEqual([
			{from: squareAt(0, 0), to: squareAt(0, 4)},
		]);
	}, 60_000);

	it('takes a king over any material', async () => {
		const {decide} = strategyOn([
			piece(0, 0, PIECE_KIND.Rook, OWN),
			piece(0, 4, PIECE_KIND.Queen, ENEMY),
			piece(-3, 0, PIECE_KIND.King, OTHER),
		]);
		expect(await decide()).toEqual([
			{from: squareAt(0, 0), to: squareAt(-3, 0)},
		]);
	}, 60_000);

	it('takes a stone over any material, as it would a king: the stone holds a stake', async () => {
		const {decide} = strategyOn([
			piece(0, 0, PIECE_KIND.Rook, OWN),
			piece(0, 4, PIECE_KIND.Queen, ENEMY),
			piece(4, 0, PIECE_KIND.Stone, OTHER),
		]);
		expect(await decide()).toEqual([
			{from: squareAt(0, 0), to: squareAt(4, 0)},
		]);
	}, 60_000);

	it('makes a legal move when it can capture nothing, and only moves its own pieces', async () => {
		const board = [
			piece(0, 0, PIECE_KIND.Knight, OWN),
			piece(10, 10, PIECE_KIND.Queen, ENEMY),
		];
		const {decide, calls} = strategyOn(board);
		const legal = await legalMoves(board, squareAt(0, 0));
		expect(legal.length).toBeGreaterThan(0);
		const seen = new Set<bigint>();
		for (let cycle = 1; cycle <= 6; cycle++) {
			const actions = await decide(cycle);
			expect(actions).toHaveLength(1);
			expect(actions[0].from).toBe(squareAt(0, 0));
			expect(legal).toContain(actions[0].to);
			seen.add(actions[0].to);
		}
		// The enemy queen's square was never asked about: only its own piece is.
		expect(calls()).toBe(6);
		// Random, and seeded per cycle: not the same square every time.
		expect(seen.size).toBeGreaterThan(1);
	}, 60_000);

	it('passes at any other level, or with nothing to move', async () => {
		expect(
			await strategyOn([piece(0, 0, PIECE_KIND.Rook, OWN)]).decide(1, 'random'),
		).toEqual([]);
		expect(
			await strategyOn([piece(0, 4, PIECE_KIND.Queen, ENEMY)]).decide(),
		).toEqual([]);
	}, 60_000);
});
