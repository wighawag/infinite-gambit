import {describe, it, expect, afterEach} from 'vitest';
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
import {createLocalRevealer} from '$lib/game/core/local-revealer';
import {localRevealerKey} from '$lib/game/lobby/seats';
import {buildRevealTransactions} from '$lib/game/core/commit-reveal/adapter';
import {
	MOVE_ENCODING,
	bondFor,
	buildMoveCommitment,
	deploymentAt,
	type Move,
} from '$lib/chess/commit-reveal';
import {squareAt} from '$lib/chess/squares';
import {resolveChessConfig} from '$lib/chess/config';
import {ARMY_STATUS} from '$lib/chess/armies';

/**
 * THE LOCAL REVEALER REVEALS THIS GAME'S TURNS (story 14), on this game's own
 * offline world: a chess turn the player only COMMITS is revealed by the
 * revealer's own key, from the transactions it was handed at commit time, as
 * soon as the chain opens the reveal phase. Nobody reveals by hand, so nobody
 * loses an army to a closed tab (`docs/adr/0005-missed-reveal-freezes-the-army.md`).
 */

const CHAIN_ID = 9007199254740125;
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

/** Let the revealer's passes in flight finish. */
async function settle(revealer: {tick(): Promise<void>}): Promise<void> {
	for (let i = 0; i < 5; i++) {
		await revealer.tick();
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
}

describe('the local revealer, for a chess turn', () => {
	it('reveals a committed deployment and a committed move without the player acting', async () => {
		const key = localRevealerKey();
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
			initialBalances: {
				...OFFLINE_DEPLOYMENT.initialBalances,
				[key.address]: 10n ** 21n,
			},
			provision: async ({env}) => {
				await stakeForOfflinePlayer({env, player: PLAYER});
			},
		});
		const {env, Game} = gameEnv();
		const records = world.deployments.get();
		const chess = resolveChessConfig(records);
		const revealer = createLocalRevealer<bigint>({
			provider: world.provider as never,
			chain: {
				id: records.chain.id,
				name: records.chain.name,
				nativeCurrency: records.chain.nativeCurrency,
				rpcUrls: {default: {http: []}},
			},
			privateKey: key.privateKey,
			contract: {address: Game.address, abi: Game.abi},
		});
		const army = firstArmyOf(PLAYER);

		/** The player commits `actions`, and hands the reveal to the revealer. */
		async function commitOnly(actions: Move[], secretByte: string) {
			const secret = `0x${secretByte.repeat(32)}` as const;
			const cycle = (await env.read(Game, {functionName: 'getCycle'})) as {
				cycleNumber: bigint;
			};
			await env.execute(Game, {
				account: PLAYER,
				functionName: 'makeCommitment',
				args: [
					army,
					buildMoveCommitment({
						actions,
						secret,
						actionsPerReveal: chess.actionsPerReveal,
					}).hash,
					bondFor(chess, actions),
					ZERO,
				],
			});
			await revealer.scheduler.submit({
				identity: army,
				cycleNumber: Number(cycle.cycleNumber),
				transactions: buildRevealTransactions({
					contract: Game,
					encoding: MOVE_ENCODING,
					actionsPerReveal: chess.actionsPerReveal,
					revealGas: chess.gas.reveal,
					player: army,
					actions,
					secret,
				}),
				commitTransaction: '0x',
				payment: {payee: ZERO, value: 0n},
			} as never);
		}

		const commitment = async () =>
			(
				(await env.read(Game, {
					functionName: 'getCommitment',
					args: [army],
				})) as {cycleNumber: bigint}
			).cycleNumber;
		const status = async () =>
			(
				(await env.read(Game, {functionName: 'getArmy', args: [army]})) as {
					status: number;
				}
			).status;
		const advance = () =>
			env.execute(Game, {account: PLAYER, functionName: 'advanceCycle'});

		// The deployment: held through its commit phase, sent once it closes.
		await commitOnly(deploymentAt(squareAt(0, 0)), '31');
		await settle(revealer);
		expect(revealer.sends()).toBe(0);
		expect(await commitment()).not.toBe(0n);
		await advance();
		await settle(revealer);
		expect(revealer.sends()).toBe(1);
		expect(await commitment()).toBe(0n);
		await advance();
		expect(await status()).toBe(ARMY_STATUS.Deployed);

		// A move: the knight to the corner, revealed for the player too.
		await commitOnly([{from: squareAt(0, 0), to: squareAt(2, 1)}], '32');
		await advance();
		await settle(revealer);
		expect(revealer.sends()).toBe(2);
		expect(await commitment()).toBe(0n);
		await advance();
		expect(await status()).toBe(ARMY_STATUS.Deployed);
		const [pieces] = (await env.read(Game, {
			functionName: 'getPieces',
			args: [2, 1, 2, 1],
		})) as [{army: bigint}[], bigint];
		expect(pieces.map((p) => p.army)).toEqual([army]);
	}, 60_000);
});
