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
	PRESET_DEPLOYMENT_DATA,
	firstArmyOf,
	stakeForOfflinePlayer,
} from '$lib/offline';
import {
	OFFLINE_PRESETS,
	PRESET_MNEMONIC,
	movesOf,
	presetById,
	presetTable,
	seatOwners,
	type OfflinePreset,
	type PresetTurn,
} from '$lib/offline-presets';
import {playPresetSetup} from '$lib/offline-preset-setup';
import {createPlayedKeys} from '$lib/game/core/played';
import {resolveChessConfig} from '$lib/chess/config';
import {ARMY_STATUS, armyViewOf} from '$lib/chess/armies';
import {squareAt, positionOf} from '$lib/chess/squares';

/**
 * THE DEMO PRESETS, PLAYED AGAINST A REAL CHAIN in node (the `server`
 * project): each preset's setup is played through the contract exactly as the
 * offline world plays it, then its decisive move, one outcome per cycle, and
 * the outcome the video shows is asserted on chain. The positions are only as
 * good as this: a setup the rules refuse reverts here, and a decisive move that
 * does not do what its hint says fails here.
 *
 * The people sign with the keys the preset wallet derives (`PRESET_MNEMONIC`,
 * the burner's own path), the world's seats with their own.
 */

const CHAIN_ID = 9007199254740141;
const PLAY_MONEY = 10n ** 24n;
const KIND = ['.', 'P', 'N', 'B', 'R', 'Q', 'K', 'S'] as const;

let world: EmbeddedWorld | undefined;
afterEach(async () => {
	await world?.dispose();
	world = undefined;
});

type Piece = {position: bigint; army: bigint; kind: number};

async function presetWorld(preset: OfflinePreset) {
	const table = presetTable(preset);
	const people = Array.from({length: preset.humans}, (_, i) => {
		const account = mnemonicToAccount(PRESET_MNEMONIC, {addressIndex: i});
		return {
			address: account.address,
			privateKey: bytesToHex(account.getHdKey().privateKey!),
		};
	});
	const owners = seatOwners(
		table,
		people.map((p) => p.address),
	);
	const keyOf = new Map<string, `0x${string}`>();
	for (const p of people) keyOf.set(p.address.toLowerCase(), p.privateKey);
	for (const seat of table) {
		if (seat.occupant.kind === 'the-world') {
			keyOf.set(seat.occupant.address.toLowerCase(), seat.occupant.privateKey);
		}
	}
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
		data: {...PRESET_DEPLOYMENT_DATA},
		accounts: {...OFFLINE_DEPLOYMENT.accounts},
		initialBalances: {...OFFLINE_DEPLOYMENT.initialBalances},
		provision: async ({env, node}) => {
			for (const address of owners) {
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
	const game = {
		address: records.contracts.Game.address,
		abi: records.contracts.Game.abi,
	};
	const keys = createPlayedKeys({
		provider: built.provider,
		chain: {
			id: records.chain.id,
			name: records.chain.name,
			nativeCurrency: records.chain.nativeCurrency,
			rpcUrls: {default: {http: []}},
		},
		contract: game,
	});
	const sendAs = (owner: `0x${string}`, request: Record<string, unknown>) =>
		keys.send(keyOf.get(owner.toLowerCase())!, request);
	const read = async <T>(functionName: string, args: unknown[] = []) =>
		(await keys.publicClient.readContract({
			...game,
			functionName,
			args,
		} as never)) as T;
	const armies = preset.armies.map((army) => ({
		owner: owners[army.seat],
		spawnPoint: squareAt(...army.spawn),
	}));
	const ids = armies.map((army) => firstArmyOf(army.owner));

	const toTurns = (turns: readonly PresetTurn[]) =>
		turns.map((turn) => ({army: turn.army, moves: movesOf(turn.moves)}));

	return {
		chess,
		owners,
		ids,
		read,
		sendAs,
		provider: built.provider,
		async setup() {
			await playPresetSetup({
				provider: built.provider,
				deployments: built.deployments,
				config: chess,
				armies,
				cycles: preset.setup.map(toTurns),
				sendAs,
			});
		},
		/** One cycle in which `turns` are played and every other army passes. */
		async play(turns: readonly PresetTurn[]) {
			await playPresetSetup({
				provider: built.provider,
				deployments: built.deployments,
				config: chess,
				armies,
				cycles: [toTurns(turns)],
				sendAs,
				deploy: false,
			});
		},
		async pieceAt(x: number, y: number): Promise<string | undefined> {
			const [pieces] = await read<readonly [readonly Piece[], bigint]>(
				'getPieces',
				[x, y, x, y],
			);
			if (pieces.length === 0) return undefined;
			const p = pieces[0];
			return `${KIND[p.kind]}#${ids.indexOf(p.army)}`;
		},
		async board(): Promise<string[]> {
			const [pieces] = await read<readonly [readonly Piece[], bigint]>(
				'getPieces',
				[-12, -12, 18, 18],
			);
			return pieces
				.map((p) => {
					const {x, y} = positionOf(p.position);
					return `${KIND[p.kind]}@${x},${y}#${ids.indexOf(p.army)}`;
				})
				.sort();
		},
		async army(index: number) {
			return armyViewOf(
				await read<Parameters<typeof armyViewOf>[0]>('getArmy', [ids[index]]),
			);
		},
	};
}

type PresetWorld = Awaited<ReturnType<typeof presetWorld>>;

/** Play one decisive outcome of `preset`, and assert what it shows. */
async function playAndCheck(
	w: PresetWorld,
	step: OfflinePreset['decisive'][number],
) {
	const before = await w.board();
	const moves = step.turns.flatMap((turn) =>
		turn.moves.map((move) => ({army: turn.army, move})),
	);
	const kinds = await Promise.all(
		moves.map(({move: [[x, y]]}) => w.pieceAt(x, y)),
	);
	// The decisive move starts from a position where every piece it moves is
	// its army's.
	moves.forEach(({army}, i) => expect(kinds[i]).toMatch(`#${army}`));

	if (step.shows === 'king-capture') {
		const [{army: captor, move}] = moves;
		const [, [tx, ty]] = move;
		const victim = Number((await w.pieceAt(tx, ty))!.split('#')[1]);
		expect(await w.pieceAt(tx, ty)).toBe(`K#${victim}`);
		const captorStake = (await w.army(captor)).stake;
		const victimStake = (await w.army(victim)).stake;
		await w.play(step.turns);
		expect(await w.pieceAt(tx, ty)).toBe(`Q#${captor}`);
		const taken = await w.army(victim);
		expect(taken.status).toBe(ARMY_STATUS.Captured);
		expect(taken.capturedBy).toBe(w.ids[captor]);
		expect((await w.army(captor)).stake).toBe(captorStake + victimStake);
		expect((await w.board()).filter((l) => l.endsWith(`#${victim}`))).toEqual(
			[],
		);
		return;
	}

	if (step.shows === 'exit') {
		const [{army}] = moves;
		const owner = w.owners[army];
		await w.play(step.turns);
		const view = await w.army(army);
		expect(view.status).toBe(ARMY_STATUS.Exited);
		expect((await w.board()).filter((l) => l.endsWith(`#${army}`))).toEqual([]);
		const ethOf = async () =>
			BigInt(
				(await w.provider.request({
					method: 'eth_getBalance',
					params: [owner, 'latest'],
				} as never)) as string,
			);
		// The world goes on for a few cycles before anybody presses the payout,
		// as it does in a browser, where the other seats keep passing.
		for (let k = 0; k < 3; k++) await w.play([]);
		const ethBefore = await ethOf();
		// Paid by anyone: here another seat, so the owner's gas does not blur it.
		await w.sendAs(w.owners[(army + 1) % w.owners.length], {
			functionName: 'exit',
			args: [w.ids[army]],
		});
		expect(await ethOf()).toBe(ethBefore + w.chess.sale.price);
		return;
	}

	await w.play(step.turns);
	const after = await w.board();
	if (step.shows === 'collision') {
		const [a, b] = moves;
		expect(a.move[1]).toEqual(b.move[1]);
		const [tx, ty] = a.move[1];
		expect(await w.pieceAt(tx, ty)).toBeUndefined();
		for (const {move} of moves) {
			expect(await w.pieceAt(...move[0])).toBeUndefined();
		}
		expect(after.length).toBe(before.length - 2);
		return;
	}
	if (step.shows === 'chase-trade') {
		// The king stepped to its empty square; the queen and the knight met on
		// the square it left, with no king there, and both died.
		const [king, queen, knight] = moves;
		expect(kinds[0]).toBe('K#0');
		expect(kinds[1]).toBe('Q#0');
		expect(kinds[2]).toBe('N#1');
		expect(await w.pieceAt(...king.move[1])).toBe('K#0');
		expect(queen.move[1]).toEqual(king.move[0]);
		expect(knight.move[1]).toEqual(king.move[0]);
		expect(await w.pieceAt(...king.move[0])).toBeUndefined();
		expect(await w.pieceAt(...queen.move[0])).toBeUndefined();
		expect(await w.pieceAt(...knight.move[0])).toBeUndefined();
		expect(after.length).toBe(before.length - 2);
		expect((await w.army(0)).status).toBe(ARMY_STATUS.Deployed);
		return;
	}
	if (step.shows === 'dodge') {
		const [attacker, dodger] = moves;
		// The attacker aimed at the dodger's square, and lands there on an empty
		// square: the dodger is where it went, nothing was captured.
		expect(attacker.move[1]).toEqual(dodger.move[0]);
		expect(await w.pieceAt(...attacker.move[1])).toBe(
			kinds[0]!.replace(/#.*/, `#${attacker.army}`),
		);
		expect(await w.pieceAt(...dodger.move[1])).toBe(kinds[1]);
		expect(after.length).toBe(before.length);
		return;
	}
	throw new Error(`no check for ${step.shows}`);
}

describe('the offline demo presets', () => {
	it('names a preset for every rule the video shows, showcase first', () => {
		expect(OFFLINE_PRESETS.map((p) => p.id)).toEqual([
			'showcase',
			'showcase-spawn',
			'chase-trade',
			'collision',
			'king-capture',
			'dodge',
			'exit',
		]);
		expect(presetById('nope')).toBeUndefined();
		for (const preset of OFFLINE_PRESETS) {
			const undeployed = preset.undeployed ?? [];
			expect(preset.armies.length + undeployed.length).toBe(preset.seats);
			expect(preset.hint.length).toBe(
				preset.decisive.length + undeployed.length,
			);
		}
	});

	for (const preset of OFFLINE_PRESETS) {
		it(`plays "${preset.id}" to its position, and its decisive move shows ${preset.decisive.map((d) => d.shows).join(', ')}`, async () => {
			const w = await presetWorld(preset);
			await w.setup();
			for (const index of preset.armies.keys()) {
				expect((await w.army(index)).status).toBe(ARMY_STATUS.Deployed);
			}
			// A seat left to deploy on camera has no army, and a stake to deploy.
			for (const seat of preset.undeployed ?? []) {
				const owner = w.owners[seat];
				expect(await w.read<bigint>('getNextArmy', [owner])).toBe(
					firstArmyOf(owner),
				);
				expect(await w.read<bigint>('getReserve', [BigInt(owner)])).toBe(
					w.chess.stake,
				);
			}
			for (const step of preset.decisive) await playAndCheck(w, step);
		}, 60_000);
	}

	it('gives the same board every time it is built', async () => {
		const preset = presetById('showcase')!;
		const first = await presetWorld(preset);
		await first.setup();
		const board = await first.board();
		const ids = first.ids;
		await world?.dispose();
		world = undefined;
		const second = await presetWorld(preset);
		await second.setup();
		expect(await second.board()).toEqual(board);
		expect(second.ids).toEqual(ids);
	}, 60_000);

	it('plays the showcase in ONE cycle too: every outcome at once', async () => {
		const preset = presetById('showcase')!;
		const w = await presetWorld(preset);
		await w.setup();
		await w.play(preset.decisive.flatMap((d) => d.turns));
		expect(await w.pieceAt(3, 0)).toBe('P#0');
		expect(await w.pieceAt(4, 2)).toBe('N#1');
		expect(await w.pieceAt(3, -1)).toBeUndefined();
		expect(await w.pieceAt(6, 6)).toBe('Q#1');
		expect((await w.army(2)).status).toBe(ARMY_STATUS.Captured);
	}, 60_000);
});
