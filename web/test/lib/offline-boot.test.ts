import {describe, it, expect, afterEach} from 'vitest';
import {bytesToHex} from 'viem';
import {mnemonicToAccount} from 'viem/accounts';
import {createEmbeddedWorld, type EmbeddedWorld} from '$lib/embedded';
import {
	config,
	extensions,
} from 'chess-battleground-contracts/rocketh/config.js';
import {
	OFFLINE_DEPLOYMENT,
	firstArmyOf,
	playedByTheWorld,
	stakeForOfflinePlayer,
} from '$lib/offline';
import {deployEverySeat, humanBootSeat} from '$lib/offline-boot';
import {createOfflinePlayers, spawnPointForSeat} from '$lib/offline-players';
import {createPlayedKeys} from '$lib/game/core/played';
import {
	MOST_SEATS,
	SEAT_CHOICES,
	seatsPlayedByTheWorld,
	tableOf,
} from '$lib/game/lobby/seats';
import {resolveChessConfig} from '$lib/chess/config';
import {ARMY_STATUS, armyViewOf, type ArmyView} from '$lib/chess/armies';

/**
 * A FRESH OFFLINE WORLD OPENS WITH EVERY SEAT DEPLOYED, driven against a real
 * chain in node (no `.svelte.` infix: the `server` project).
 *
 * The people sign with keys this file holds, standing in for the world's own
 * burner wallet (which `$lib/offline` hands the boot in a browser): what is
 * asserted is the boot's behaviour on chain, not who signs.
 */

const CHAIN_ID = 9007199254740131;
const PLAY_MONEY = 10n ** 24n;
const WELL_KNOWN_MNEMONIC =
	'test test test test test test test test test test test junk';

/**
 * The people at this device, in this test: hardhat's accounts from #13 on,
 * past every key the world's seats (#2 to #11) and the hotseat revealer (#12)
 * play with.
 */
function humanKey(index: number) {
	const account = mnemonicToAccount(WELL_KNOWN_MNEMONIC, {
		addressIndex: 13 + index,
	});
	return {
		privateKey: bytesToHex(account.getHdKey().privateKey!),
		address: account.address,
	};
}

let world: EmbeddedWorld | undefined;
afterEach(async () => {
	await world?.dispose();
	world = undefined;
});

type Sends = {address: `0x${string}`; functionName: string}[];

/**
 * A world for a table of `seats`, `humans` of them people, provisioned the way
 * `$lib/offline` does it (gas and one stake for every seat, nobody a member),
 * and a boot that can be cut off at any send, as a closed tab would.
 */
async function setup(seats: number, humans: number) {
	const table = tableOf(seats, humans);
	const people = Array.from({length: humans}, (_, i) => humanKey(i));
	const playedAccounts = seatsPlayedByTheWorld(table).map((p) => p.address);
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
		provision: async ({env, node}) => {
			for (const address of [
				...people.map((p) => p.address),
				...playedAccounts,
			]) {
				await node.provider.request({
					method: 'evm_setBalance',
					params: [address, `0x${PLAY_MONEY.toString(16)}`],
				} as never);
				await stakeForOfflinePlayer({env, player: address});
			}
		},
	});
	const built = world;
	const records = built.deployments.get();
	const chess = resolveChessConfig(records);
	const played = await playedByTheWorld({env: built.env, table});
	const keys = createPlayedKeys({
		provider: built.provider,
		chain: {
			id: records.chain.id,
			name: records.chain.name,
			nativeCurrency: records.chain.nativeCurrency,
			rpcUrls: {default: {http: []}},
		},
		contract: {
			address: records.contracts.Game.address,
			abi: records.contracts.Game.abi,
		},
	});
	const read = async <T>(functionName: string, args: unknown[] = []) =>
		(await keys.publicClient.readContract({
			address: records.contracts.Game.address,
			abi: records.contracts.Game.abi,
			functionName,
			args,
		} as never)) as T;
	const bootHumans = people.map((p, i) => ({
		address: p.address,
		seat: humanBootSeat(i, played.length),
	}));

	/**
	 * One boot, as a fresh tab runs it: a new seat loop over the same chain.
	 * `crashAt` cuts it off before the send it names (by its place among the
	 * people's sends), which is the tab closing there.
	 */
	async function boot(crashAt?: number, options: {raced?: boolean} = {}) {
		const sends: Sends = [];
		const machines = createOfflinePlayers({
			provider: built.provider,
			deployments: built.deployments,
			config: chess,
			players: played,
		});
		const run = deployEverySeat({
			provider: built.provider,
			deployments: built.deployments,
			config: chess,
			humans: bootHumans,
			seats: [...people.map((p) => p.address), ...playedAccounts],
			sendAs: async (address, request) => {
				if (crashAt !== undefined && sends.length === crashAt) {
					throw new Error('the tab closed');
				}
				sends.push({address, functionName: String(request.functionName)});
				const key = people.find((p) => p.address === address)!.privateKey;
				if (options.raced && request.functionName === 'advanceCycle') {
					// Somebody else (the page's advance client, another tab) judged
					// the same cycle and got their advance mined first.
					await keys.send(key, request);
				}
				await keys.send(key, request);
			},
			machines,
		});
		if (crashAt === undefined) return {sent: await run, sends};
		await expect(run).rejects.toThrow('the tab closed');
		return {sent: 0, sends};
	}

	const armyOf = async (id: bigint): Promise<ArmyView> =>
		armyViewOf(await read<Parameters<typeof armyViewOf>[0]>('getArmy', [id]));

	/** Every seat holds a deployed first army, with its whole stake. */
	async function expectEverySeatDeployed() {
		const armies = [
			...bootHumans.map((h) => ({seat: h.seat, id: firstArmyOf(h.address)})),
			...played.map((p) => ({seat: p.seat, id: p.identity})),
		];
		const spawnPoints = new Set<bigint>();
		for (const {id} of armies) {
			const army = await armyOf(id);
			expect(army.status, String(id)).toBe(ARMY_STATUS.Deployed);
			expect(army.stake, String(id)).toBe(chess.stake);
			spawnPoints.add(army.spawnPoint);
		}
		expect(spawnPoints.size).toBe(seats);
		const attendance = await read<{waitedFor: bigint}>('getAttendance');
		expect(attendance.waitedFor).toBe(BigInt(seats));
		return armies;
	}

	return {
		table,
		played,
		bootHumans,
		chess,
		read,
		boot,
		armyOf,
		expectEverySeatDeployed,
	};
}

describe('a fresh offline world', () => {
	it('opens at least as many spawn points as the largest table has seats', () => {
		expect(
			Number(OFFLINE_DEPLOYMENT.data.Game.openSpawnPoints),
		).toBeGreaterThanOrEqual(MOST_SEATS);
		// Online and at a table, the open set is the deploy's own.
		expect(config.data.Game.default.openSpawnPoints).toBe(8n);
		expect(OFFLINE_DEPLOYMENT.data.Lobby.openSpawnPoints).toBe(8n);
	});

	it('numbers the people after the world\u2019s seats, so every seat of a table has its own', () => {
		for (const seats of SEAT_CHOICES) {
			for (let humans = 1; humans <= seats; humans++) {
				const played = seats - humans;
				const numbers = [
					...Array.from({length: played}, (_, i) => i),
					...Array.from({length: humans}, (_, i) => humanBootSeat(i, played)),
				];
				expect(new Set(numbers).size).toBe(seats);
				expect(Math.max(...numbers)).toBeLessThan(MOST_SEATS);
			}
		}
	});

	it('starts with every seat deployed on its own spawn point, without the person acting', async () => {
		const t = await setup(3, 1);
		const [open] =
			await t.read<readonly [readonly bigint[], bigint]>('getOpenSpawnPoints');
		const {sent, sends} = await t.boot();
		// One commit and one reveal for the person, and the two advances.
		expect(sent).toBe(2);
		expect(sends.map((s) => s.functionName)).toEqual([
			'makeCommitment',
			'advanceCycle',
			'reveal',
			'advanceCycle',
		]);
		await t.expectEverySeatDeployed();
		// Every seat at `spawnPointForSeat(seat, open)` over the set the first
		// cycle opened with: the machine seats where their own loop puts them.
		for (const human of t.bootHumans) {
			expect((await t.armyOf(firstArmyOf(human.address))).spawnPoint).toBe(
				spawnPointForSeat(human.seat, open),
			);
		}
		for (const seat of t.played) {
			expect((await t.armyOf(seat.identity)).spawnPoint).toBe(
				spawnPointForSeat(seat.seat, open),
			);
		}
	});

	it('starts pre-deployed at every table size, up to the largest', async () => {
		for (const seats of SEAT_CHOICES) {
			const t = await setup(seats, 1);
			await t.boot();
			await t.expectEverySeatDeployed();
			await world!.dispose();
			world = undefined;
		}
	}, 120_000);

	it('starts pre-deployed in hotseat, with several people and with everyone a person', async () => {
		for (const [seats, humans] of [
			[4, 3],
			[MOST_SEATS, MOST_SEATS],
		] as const) {
			const t = await setup(seats, humans);
			await t.boot();
			await t.expectEverySeatDeployed();
			await world!.dispose();
			world = undefined;
		}
	}, 60_000);

	it('finishes on the next boot wherever the last one was cut off', async () => {
		// Two people, so a cut can fall between their reveals. The people's
		// sends are: commit, commit, advance, reveal, reveal, advance.
		for (const crashAt of [1, 2, 3, 4, 5]) {
			const t = await setup(4, 2);
			await t.boot(crashAt);
			await t.boot();
			await t.expectEverySeatDeployed();
			await world!.dispose();
			world = undefined;
		}
	}, 60_000);

	it('carries on when another advance gets mined before its own', async () => {
		// What reverts the boot's own advance with StillWaitingToReveal or
		// StillWaitingToCommit: the cycle already moved, which is what the boot
		// was after. A lost race is not a failed boot.
		const t = await setup(3, 1);
		await t.boot(undefined, {raced: true});
		await t.expectEverySeatDeployed();
	});

	it('deploys nothing on a restore that already has its armies', async () => {
		const t = await setup(3, 1);
		await t.boot();
		const before = await t.read<{cycleNumber: bigint}>('getCycle');
		const {sent, sends} = await t.boot();
		expect(sent).toBe(0);
		expect(sends).toEqual([]);
		expect((await t.read<{cycleNumber: bigint}>('getCycle')).cycleNumber).toBe(
			before.cycleNumber,
		);
		await t.expectEverySeatDeployed();
	});
});
