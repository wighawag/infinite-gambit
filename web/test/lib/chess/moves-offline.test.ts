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
import {
	buildMoveChain,
	deploymentAt,
	type Move,
} from '$lib/chess/commit-reveal';
import {pieceOf, type BoardState, type Piece} from '$lib/chess/board';
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

describe('a move on the offline world', () => {
	it('highlights what the deployed rule allows, and lands the committed move after the reveal', async () => {
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
		const board = writable(await boardAround());
		const submission = fakeSubmission();
		const planning = createPlanning({
			submission,
			needsDeployment: writable(false),
			canMove: writable(true),
			army: writable(army),
			board,
			legalMoves: async (pieces, from) => [
				...((await sandbox.call({
					contract: 'rules',
					abi: deployments.contracts.Game.abi,
					functionName: 'legalMoves',
					args: [pieces, from],
				})) as unknown as readonly bigint[]),
			],
		});
		let plan: LocalPlan = {};
		const stop = planning.plan.subscribe((p) => (plan = p));

		// The army faces North from the origin: its knight on (0,0) may jump
		// over its pawns onto the two squares in front, or into the corner.
		planning.click(squareAt(0, 0));
		for (let i = 0; i < 200 && (plan.destinations ?? []).length === 0; i++) {
			await new Promise((r) => setTimeout(r, 10));
		}
		expect((plan.destinations ?? []).map(positionOf)).toEqual(
			expect.arrayContaining([
				{x: 1, y: 2},
				{x: -1, y: 2},
				{x: 2, y: 1},
			]),
		);
		expect(plan.destinations).toHaveLength(3);

		planning.click(squareAt(2, 1));
		const actions = [...get(planning.actions)];
		expect(actions).toEqual([{from: squareAt(0, 0), to: squareAt(2, 1)}]);
		stop();
		sandbox.dispose();

		await playCycle(army, actions, '22');
		const after = await boardAround();
		if (after.step !== 'Loaded') throw new Error('unloaded');
		expect(after.pieces.get(squareAt(0, 0))).toBeUndefined();
		expect(after.pieces.get(squareAt(2, 1))).toMatchObject({army, moved: true});
	}, 60_000);
});
