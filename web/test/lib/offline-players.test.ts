import {describe, it, expect, afterEach} from 'vitest';
import {
	createPublicClient,
	createWalletClient,
	custom,
	zeroAddress,
	type Account,
} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {createEmbeddedWorld, type EmbeddedWorld} from '$lib/embedded';
import {
	config,
	extensions,
} from 'chess-battleground-contracts/rocketh/config.js';
import {
	OFFLINE_DEPLOYMENT,
	offlineIdentityOf,
	playedByTheWorld,
	stakeForOfflinePlayer,
} from '$lib/offline';
import {
	SEATS_BY_DEFAULT,
	seatsPlayedByTheWorld,
	tableOf,
} from '$lib/game/lobby/seats';
import {resolveChessConfig} from '$lib/chess/config';
import {buildMoveChain, deploymentAt} from '$lib/chess/commit-reveal';
import {ARMY_STATUS, armyViewOf} from '$lib/chess/armies';
import {createOfflinePlayers, spawnPointForSeat} from '$lib/offline-players';

/**
 * THE OTHER PLAYERS, DRIVEN AGAINST A REAL CHAIN.
 *
 * No `.svelte.` infix, so this runs in the `server` project: node, no DOM.
 * webevm runs under node, so a whole world (a chain, this game's real deploy,
 * three seats) is testable without a browser.
 *
 * WHY IT DRIVES `tick()` RATHER THAN `start()`: the loop is a `setInterval`,
 * and every pass this file makes is one the timer would have made.
 *
 * WHAT IT IS FOR: in chess only armies are members, so a seat is nothing to
 * the cycle until it has deployed one. The seats deploy once the person has,
 * reveal their deployment, and then pass, and every seat ends up holding an
 * army the cycle waits for.
 */

const CHAIN_ID = 9007199254740127;

/**
 * THE SMALLEST TABLE, which is the one this file is about.
 *
 * Three seats: the human, and the two the world plays. The lobby lets a player
 * ask for more, and nothing below would read differently at eight - what these
 * tests assert is the BEHAVIOUR of a played player, and a player does not know
 * how many others there are. The count that has to be honoured is asserted
 * where it can be, against `getAttendance` in the world test.
 */
const TABLE = tableOf(SEATS_BY_DEFAULT);
const PLAYED = seatsPlayedByTheWorld(TABLE);

/**
 * The human, in this test: hardhat's account #1, as the world test uses it.
 *
 * It needs a key of its own rather than borrowing one of the world's, because
 * the whole point is that the third member acts INDEPENDENTLY of the loop
 * under test.
 */
const HUMAN = {
	privateKey:
		'0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
	address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
} as const;

const PLAY_MONEY = 10n ** 24n;

let world: EmbeddedWorld | undefined;
afterEach(async () => {
	await world?.dispose();
	world = undefined;
});

type Sender = {account: Account; client: ReturnType<typeof createWalletClient>};
type Cycle = {cycleNumber: bigint; commiting: boolean};
type Attendance = {waitedFor: bigint; committed: bigint; revealed: bigint};
type Commitment = {hash: `0x${string}`; cycleNumber: bigint; bond: bigint};
type ArmyRaw = Parameters<typeof armyViewOf>[0];

/**
 * A world with three seats provisioned (the human and the two the world plays),
 * each holding one army's stake in its account and NONE of them a member yet:
 * only armies are.
 *
 * Provisioning is written out rather than reusing `provisionOfflinePlayer`,
 * which announces a wallet on `window` and therefore needs a browser. What it
 * does with the STAKE is the same call in the same order, which is the half
 * this file depends on, and the world test is what asserts the real hook makes
 * it.
 */
async function buildWorld() {
	return createEmbeddedWorld({
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
		provision: async ({env, node}) => {
			for (const address of [
				HUMAN.address,
				...PLAYED.map((played) => played.address),
			]) {
				await node.provider.request({
					method: 'evm_setBalance',
					params: [address, `0x${PLAY_MONEY.toString(16)}`],
				} as never);
				await stakeForOfflinePlayer({env, player: address});
			}
		},
	});
}

async function playersOf(built: EmbeddedWorld) {
	return createOfflinePlayers({
		provider: built.provider,
		deployments: built.deployments,
		config: resolveChessConfig(built.deployments.get()),
		players: await playedByTheWorld({env: built.env, table: TABLE}),
	});
}

function clientsOf(built: EmbeddedWorld) {
	const records = built.deployments.get();
	const chain = {
		id: records.chain.id,
		name: records.chain.name,
		nativeCurrency: records.chain.nativeCurrency,
		rpcUrls: {default: {http: [] as string[]}},
	};
	const game = {
		address: records.contracts.Game.address,
		abi: records.contracts.Game.abi,
	};
	const publicClient = createPublicClient({
		chain,
		transport: custom(built.provider as never),
	});

	function senderFor(privateKey: `0x${string}`): Sender {
		const account = privateKeyToAccount(privateKey);
		return {
			account,
			client: createWalletClient({
				account,
				chain,
				transport: custom(built.provider as never),
			}),
		};
	}

	async function send(
		sender: Sender,
		request: Record<string, unknown>,
	): Promise<void> {
		const hash = await sender.client.writeContract({
			...game,
			chain: null,
			account: sender.account,
			...request,
		} as never);
		const receipt = await publicClient.waitForTransactionReceipt({hash});
		expect(receipt.status, String(request.functionName)).toBe('success');
	}

	// The cast is the same one the app's own readers make at this boundary: the
	// records carry a runtime ABI, and a helper that takes a function NAME cannot
	// have viem infer the argument tuple from it.
	async function read<T>(functionName: string, args: unknown[] = []) {
		return (await publicClient.readContract({
			...game,
			functionName,
			args,
		} as never)) as T;
	}

	return {game, publicClient, senderFor, send, read};
}

const HUMAN_SECRET =
	'0x1111111111111111111111111111111111111111111111111111111111111111' as const;

/** The human's deployment: the origin, nearest of the open spawn points. */
const HUMAN_SPAWN = 0n;

async function setup() {
	world = await buildWorld();
	const clients = clientsOf(world);
	const chess = resolveChessConfig(world.deployments.get());
	const players = await playersOf(world);
	const human = clients.senderFor(HUMAN.privateKey);
	const humanArmy = await offlineIdentityOf({
		env: world.env,
		player: HUMAN.address,
	});
	const records = world.deployments.get();

	async function humanCommits(
		actions: {from: bigint; to: bigint}[],
		bond: bigint,
	) {
		const chain = buildMoveChain({
			actions,
			secret: HUMAN_SECRET,
			actionsPerReveal: chess.actionsPerReveal,
		});
		await clients.send(human, {
			functionName: 'makeCommitment',
			args: [humanArmy, chain[0].hash, bond, zeroAddress],
		});
		return chain;
	}

	async function humanReveals(chain: ReturnType<typeof buildMoveChain>) {
		await clients.send(human, {
			functionName: 'reveal',
			args: [
				humanArmy,
				chain[0].actions,
				HUMAN_SECRET,
				chain[0].furtherActions,
				zeroAddress,
			],
		});
	}

	const advance = () =>
		clients.send(human, {functionName: 'advanceCycle', args: []});

	const armyOf = async (id: bigint) =>
		armyViewOf(await clients.read<ArmyRaw>('getArmy', [id]));

	return {
		...clients,
		chess,
		players,
		human,
		humanArmy,
		records,
		humanCommits,
		humanReveals,
		advance,
		armyOf,
	};
}

describe('the other players in the offline world', () => {
	it('provisions every seat with one army\u2019s stake, which makes nobody a member', async () => {
		const t = await setup();
		const attendance = await t.read<Attendance>('getAttendance');
		expect(attendance.waitedFor).toBe(0n);
		for (const address of [HUMAN.address, ...PLAYED.map((p) => p.address)]) {
			expect(
				await t.read<bigint>('getReserve', [BigInt(address)]),
				address,
			).toBe(t.chess.stake);
		}
	});

	it('deploys every seat it plays at once, each on its own spawn point', async () => {
		const t = await setup();
		await t.players.tick();
		// Both seats are members now, committed this cycle; the person is not
		// one until they deploy, which the world's advance waits for
		// (`$lib/chess/awaited-deployments`).
		const attendance = await t.read<Attendance>('getAttendance');
		expect(attendance.waitedFor).toBe(2n);
		expect(attendance.committed).toBe(2n);
		for (const played of await playedByTheWorld({
			env: world!.env,
			table: TABLE,
		})) {
			expect((await t.armyOf(played.identity)).status).toBe(
				ARMY_STATUS.Deploying,
			);
		}
	});

	it('deploys beside the person, and every seat ends up holding an army', async () => {
		const t = await setup();
		const played = await playedByTheWorld({env: world!.env, table: TABLE});

		// The person deploys first: the cycle now waits on them.
		const humanChain = await t.humanCommits(
			deploymentAt(HUMAN_SPAWN),
			t.chess.stake,
		);
		const [open] =
			await t.read<readonly [readonly bigint[], bigint]>('getOpenSpawnPoints');
		await t.players.tick();

		// Each seat deployed at its own spawn point, from the far end of the set.
		let attendance = await t.read<Attendance>('getAttendance');
		expect(attendance.waitedFor).toBe(3n);
		expect(attendance.committed).toBe(3n);
		for (const seat of played) {
			expect((await t.armyOf(seat.identity)).status).toBe(
				ARMY_STATUS.Deploying,
			);
		}
		expect(spawnPointForSeat(0, open)).toBe(open[open.length - 1]);
		expect(spawnPointForSeat(1, open)).toBe(open[open.length - 2]);

		await t.advance();
		await t.humanReveals(humanChain);
		await t.players.tick();
		attendance = await t.read<Attendance>('getAttendance');
		expect(attendance.revealed).toBe(3n);
		await t.advance();

		// The cycle is over: every army stands on the board, on its own spawn
		// point, and the cycle waits for all three.
		const human = await t.armyOf(t.humanArmy);
		expect(human.status).toBe(ARMY_STATUS.Deployed);
		expect(human.spawnPoint).toBe(HUMAN_SPAWN);
		const spawnPoints = new Set([human.spawnPoint]);
		for (const seat of played) {
			const army = await t.armyOf(seat.identity);
			expect(army.status).toBe(ARMY_STATUS.Deployed);
			spawnPoints.add(army.spawnPoint);
		}
		expect(spawnPoints.size).toBe(3);
		expect((await t.read<Attendance>('getAttendance')).waitedFor).toBe(3n);
	});

	it('passes once deployed, and opens its pass after a reload', async () => {
		const t = await setup();
		const humanChain = await t.humanCommits(
			deploymentAt(HUMAN_SPAWN),
			t.chess.stake,
		);
		await t.players.tick();
		await t.advance();
		await t.humanReveals(humanChain);
		await t.players.tick();
		await t.advance();

		// A cycle of passes. The person passes too: an empty submission.
		const pass = await t.humanCommits([], 0n);
		await t.players.tick();
		expect((await t.read<Attendance>('getAttendance')).committed).toBe(3n);
		await t.advance();

		// A RELOAD between commit and reveal: a fresh loop holds nothing in
		// memory and still opens what the first one committed.
		const reloaded = await playersOf(world!);
		await t.humanReveals(pass);
		await reloaded.tick();
		expect((await t.read<Attendance>('getAttendance')).revealed).toBe(3n);
		await t.advance();

		const cycle = await t.read<Cycle>('getCycle');
		expect(cycle.commiting).toBe(true);
		for (const seat of await playedByTheWorld({
			env: world!.env,
			table: TABLE,
		})) {
			expect((await t.armyOf(seat.identity)).status).toBe(ARMY_STATUS.Deployed);
			const commitment = await t.read<Commitment>('getCommitment', [
				seat.identity,
			]);
			expect(commitment.cycleNumber).toBe(0n);
		}
	});
});
