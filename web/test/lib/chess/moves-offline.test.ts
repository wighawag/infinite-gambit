import {describe, it, expect, afterEach} from 'vitest';
import {get, writable} from 'svelte/store';
import {createNode} from 'webevm';
import {createEmbeddedWorld, type EmbeddedWorld} from '$lib/embedded';
import {
	config,
	extensions,
} from 'chess-battleground-contracts/rocketh/config.js';
import {
	OFFLINE_DEPLOYMENT,
	firstArmyOf,
	stakeForOfflinePlayer,
} from '$lib/offline';
import {createBytecodeSandbox} from '$lib/game/simulation';
import {createPlanning} from '$lib/chess/planning';
import {readMaxPieceMoves, type WholeMoveCall} from '$lib/chess/piece-moves';
import {
	buildMoveChain,
	deploymentAt,
	type Move,
} from '$lib/chess/commit-reveal';
import {
	PIECE_KIND,
	pieceOf,
	type BoardState,
	type Piece,
} from '$lib/chess/board';
import {positionOf, squareAt} from '$lib/chess/squares';
import {resolveChessConfig} from '$lib/chess/config';
import type {OnchainStateValue} from '$lib/game/core/seams';
import type {SubmissionState, SubmissionStore} from '$lib/game/core/submission';
import type {GameIdentity} from '$lib/game/identity';
import type {LocalPlan} from '$lib/chess/view';
import {noOutcomes} from '$lib/chess/outcomes';

/**
 * A MOVE, END TO END, on this game's own offline world: the legal destinations
 * the client highlights come from the Simulation route's DEPLOYED bytecode run
 * in the sandbox (`docs/adr/0007-rules-live-only-in-the-contract.md`), the
 * click on one of them is the submission's move, and the committed move lands
 * on the board once its cycle is over.
 */

const CHAIN_ID = 9007199254740124;
// hardhat's account #1, which the offline deploy holds a key for.
const PLAYER = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as const;
const ZERO = '0x0000000000000000000000000000000000000000' as const;

let world: EmbeddedWorld | undefined;
afterEach(async () => {
	await world?.dispose();
	world = undefined;
});

function gameEnv() {
	const env = world!.env as unknown as {
		read: (deployment: unknown, args: unknown) => Promise<unknown>;
		execute: (deployment: unknown, args: unknown) => Promise<unknown>;
	};
	return {env, Game: world!.deployments.get().contracts.Game};
}

/** Commit `actions` for the army, advance, reveal them, advance again. */
async function playCycle(army: bigint, actions: Move[], secretByte: string) {
	const {env, Game} = gameEnv();
	const chess = resolveChessConfig(world!.deployments.get());
	const secret = `0x${secretByte.repeat(32)}` as const;
	const chain = buildMoveChain({
		actions,
		secret,
		actionsPerReveal: chess.actionsPerReveal,
	});
	await env.execute(Game, {
		account: PLAYER,
		functionName: 'makeCommitment',
		args: [
			army,
			chain[0].hash,
			actions.length === 1 && actions[0].from === actions[0].to
				? chess.stake
				: 0n,
			ZERO,
		],
	});
	await env.execute(Game, {account: PLAYER, functionName: 'advanceCycle'});
	for (const chunk of chain) {
		await env.execute(Game, {
			account: PLAYER,
			functionName: 'reveal',
			args: [army, chunk.actions, secret, chunk.furtherActions, ZERO],
		});
	}
	await env.execute(Game, {account: PLAYER, functionName: 'advanceCycle'});
}

async function boardAround(): Promise<OnchainStateValue<BoardState>> {
	const {env, Game} = gameEnv();
	const [raw] = (await env.read(Game, {
		functionName: 'getPieces',
		args: [-8, -8, 8, 8],
	})) as [Parameters<typeof pieceOf>[0][], bigint];
	const pieces = new Map<bigint, Piece>();
	for (const r of raw) pieces.set(r.position, pieceOf(r));
	return {
		step: 'Loaded',
		pieces,
		spawnPoints: [],
		armies: [],
		outcomes: noOutcomes(),
	};
}

function fakeSubmission(): SubmissionStore<GameIdentity, Move> {
	const state = writable<SubmissionState<Move>>({step: 'Idle'});
	return {
		subscribe: state.subscribe,
		get value() {
			return get(state);
		},
		ready: writable(true),
		plan(actions: readonly Move[]) {
			state.set({step: 'Planning', cycleNumber: 1, actions});
		},
	} as unknown as SubmissionStore<GameIdentity, Move>;
}

/** The offline world, with one army deployed at the origin, and its route. */
async function deployedWorld() {
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
		provision: async ({env}) => {
			await stakeForOfflinePlayer({env, player: PLAYER});
		},
	});
	const army = firstArmyOf(PLAYER);
	await playCycle(army, deploymentAt(squareAt(0, 0)), '11');
	const deployments = world.deployments.get();
	const sandbox = createBytecodeSandbox({
		provider: world.provider as never,
		node: () => createNode({}) as never,
		contracts: {
			rules: {
				address:
					deployments.contracts.Game_Implementation_Router_Simulation_Route
						.address,
			},
		},
	});
	const wholeMove: WholeMoveCall = (functionName, args) =>
		sandbox.call({
			contract: 'rules',
			abi: deployments.contracts.Game.abi,
			functionName,
			args: args as never,
		}) as Promise<unknown>;
	const {env, Game} = gameEnv();
	const maxPieceMoves = await readMaxPieceMoves(
		(functionName) => env.read(Game, {functionName}) as Promise<bigint>,
	);
	const board = writable(await boardAround());
	const submission = fakeSubmission();
	const planning = createPlanning({
		submission,
		needsDeployment: writable(false),
		canMove: writable(true),
		army: writable(army),
		board,
		maxPieceMoves: writable(maxPieceMoves),
		wholeMove,
	});
	let plan: LocalPlan = {};
	let refusal: string | undefined;
	const stops = [
		planning.plan.subscribe((p) => (plan = p)),
		planning.refusal.subscribe((r) => (refusal = r)),
	];
	const until = async (done: () => boolean) => {
		for (let i = 0; i < 300 && !done(); i++) {
			await new Promise((r) => setTimeout(r, 10));
		}
	};
	/** Select (x, y), wait for the route's destinations, return them. */
	const select = async (x: number, y: number) => {
		planning.click(squareAt(x, y));
		await until(() => (plan.destinations ?? []).length > 0);
		return (plan.destinations ?? []).map(positionOf);
	};
	return {
		army,
		maxPieceMoves,
		planning,
		select,
		until,
		plan: () => plan,
		refusal: () => refusal,
		dispose: () => {
			for (const stop of stops) stop();
			sandbox.dispose();
		},
	};
}

describe('a move on the offline world', () => {
	it('highlights what the deployed rule allows, and lands the committed move after the reveal', async () => {
		const t = await deployedWorld();
		// The army stands on the origin: its knight on (0,1) may jump over its
		// pawns onto the two squares above them, or into either top corner.
		const destinations = await t.select(0, 1);
		expect(destinations).toEqual(
			expect.arrayContaining([
				{x: 1, y: 3},
				{x: -1, y: 3},
				{x: 2, y: 2},
				{x: -2, y: 2},
			]),
		);
		expect(destinations).toHaveLength(4);

		t.planning.click(squareAt(2, 2));
		const actions = [...get(t.planning.actions)];
		expect(actions).toEqual([{from: squareAt(0, 1), to: squareAt(2, 2)}]);
		t.dispose();

		await playCycle(t.army, actions, '22');
		const after = await boardAround();
		if (after.step !== 'Loaded') throw new Error('unloaded');
		expect(after.pieces.get(squareAt(0, 1))).toBeUndefined();
		expect(after.pieces.get(squareAt(2, 2))).toMatchObject({
			army: t.army,
			kind: PIECE_KIND.Knight,
		});
	}, 60_000);

	it('plans several piece-moves by the contract, refuses one it would refuse, and lands them from one commitment', async () => {
		const t = await deployedWorld();
		expect(t.maxPieceMoves).toBe(3);
		// The king steps onto the empty core square on its right...
		expect(await t.select(0, 0)).toContainEqual({x: 1, y: 0});
		t.planning.click(squareAt(1, 0));
		// ...and the queen may take the square it leaves: offered by the route
		// alongside the king's piece-move, though the king stands there now.
		expect(await t.select(-1, 0)).toContainEqual({x: 0, y: 0});
		t.planning.click(squareAt(0, 0));
		const both = [
			{from: squareAt(0, 0), to: squareAt(1, 0)},
			{from: squareAt(-1, 0), to: squareAt(0, 0)},
		];
		expect(get(t.planning.actions)).toEqual(both);
		// Long enough for the verdict on the two to come back.
		await new Promise((r) => setTimeout(r, 500));
		expect(t.refusal()).toBeUndefined();

		// Without the king's piece-move the queen's is onto its own king: the
		// contract refuses the move, and the planner says so before any commit.
		t.planning.takeBack(squareAt(0, 0));
		await t.until(() => t.refusal() !== undefined);
		expect(t.refusal()).toMatch(/refuses \(-1, 0\) to \(0, 0\)/);

		// Put back, the move is legal again.
		await t.select(0, 0);
		t.planning.click(squareAt(1, 0));
		await t.until(() => t.refusal() === undefined);
		expect(t.refusal()).toBeUndefined();
		const actions = [...get(t.planning.actions)];
		expect(actions).toEqual([both[1], both[0]]);
		t.dispose();

		// ONE commitment holds both, and both land.
		await playCycle(t.army, actions, '33');
		const after = await boardAround();
		if (after.step !== 'Loaded') throw new Error('unloaded');
		expect(after.pieces.get(squareAt(1, 0))).toMatchObject({
			army: t.army,
			kind: PIECE_KIND.King,
		});
		expect(after.pieces.get(squareAt(0, 0))).toMatchObject({
			army: t.army,
			kind: PIECE_KIND.Queen,
		});
		expect(after.pieces.get(squareAt(-1, 0))).toBeUndefined();
	}, 60_000);
});
