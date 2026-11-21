import {derived, get, writable, type Readable} from 'svelte/store';
import {
	config,
	extensions,
	CYCLE_POLICY,
	OFFLINE_OPEN_SPAWN_POINTS,
} from 'chess-battleground-contracts/rocketh/config.js';
import deployToken from 'chess-battleground-contracts/deploy/001_deploy_token.js';
import deployGame from 'chess-battleground-contracts/deploy/010_deploy_game.js';
import deployStakeSale from 'chess-battleground-contracts/deploy/020_deploy_stake_sale.js';
import deployLobby from 'chess-battleground-contracts/deploy/030_deploy_lobby.js';
import {createEmbeddedWorld, type EmbeddedWorld} from '$lib/embedded';
import {mintChainId} from '$lib/embedded/chain-id';
import {
	announceEmbeddedWallet,
	type EmbeddedWallet,
} from '$lib/embedded/wallet';
import {offlineWorldNode} from '$lib/offline-node';
import {
	OFFLINE_CHAIN_TIMING,
	createOfflineBoot,
	openOfflineWorld,
	type OfflineBoot,
	type OfflineBootStatus,
} from '$lib/offline-world';
import {createContext, lobby as gameLobby} from '$lib/context/index';
import type {Context} from '$lib/context/types';
import {createOfflinePlayers, type OfflinePlayer} from '$lib/offline-players';
import {createPublicClient, createWalletClient, custom} from 'viem';
import {deployEverySeat, humanBootSeat} from '$lib/offline-boot';
import {createPlayedTurnStore, type AiLevel} from '$lib/game/core/strategy';
import type {TableChoice} from '$lib/game/lobby/lobby';
import {offlineSeatLabels} from '$lib/game/lobby/offline-table';
import {
	createBytecodeSandbox,
	type BytecodeSandbox,
} from '$lib/game/simulation';
import {pieceOf, type PieceKind} from '$lib/chess/board';
import {armyViewOf} from '$lib/chess/armies';
import {MOVE_STORAGE} from '$lib/chess/storage';
import {readMaxPieceMoves} from '$lib/chess/piece-moves';
import {
	CHESS_LEVELS,
	GREEDY_LEVEL,
	createChessStrategy,
} from '$lib/chess/strategy';
import {createPlayedKeys} from '$lib/game/core/played';
import {
	MOST_SEATS,
	humansAtThisDevice,
	seatsPlayedByTheWorld,
	type Table,
} from '$lib/game/lobby/seats';
import {showHotseat} from '$lib/game/lobby/hotseat';
import {
	createOfflineWallet,
	handOverBetweenThem,
	holdTheWorldOnTheConsole,
	openTheWorldsTable,
	readyToPlay,
	revealerForTheHumans,
	seatTheHumans,
	stakeEverySeat,
	theWorldsGame,
	worldChain,
	type OfflineWallet,
	type TableAt,
	type WorldNodeProvider,
} from '$lib/game/offline';
import {resolveChessConfig} from '$lib/chess/config';
import {awaitDeploymentsOf, firstArmyOf} from '$lib/chess/awaited-deployments';
import type {Move} from '$lib/chess/commit-reveal';
import {
	PRESET_MNEMONIC,
	PRESET_SPAWN_SPACING,
	movesOf,
	presetTable,
	seatOwners,
	type OfflinePreset,
} from '$lib/offline-presets';
import {playPresetSetup} from '$lib/offline-preset-setup';
import {squareAt} from '$lib/chess/squares';

export {firstArmyOf};

/**
 * THIS GAME'S OFFLINE WORLD: the composition, which is the half
 * `$lib/embedded` deliberately does not have.
 *
 * `embedded-chain` is the MECHANISM's word and belongs to the framework;
 * `offline` is the EXPERIENCE a player chooses and belongs to the game,
 * exactly as `turn` does. So the framework knows how to boot a chain and run
 * deploy scripts on it, and this file knows WHICH scripts, WHAT the deployment
 * declares, and what a player of THIS game is handed before they start.
 *
 * THE THREE THINGS IT DECIDES, and each of them is a game's answer rather than
 * the framework's:
 *
 * 1. **The MANUAL cycle policy, with both phase durations zero.** One decision
 *    and not three: the contract refuses a configuration whose durations
 *    disagree with its declared policy. It is the only honest policy for a
 *    chain in a tab, for two independent reasons. A world exists for
 *    single-player and hotseat, where the human decides when a turn ends; and
 *    an automined chain has no clock BETWEEN transactions - a block exists only
 *    where a transaction happened, and every `eth_call` and `eth_estimateGas`
 *    runs at the last mined block's timestamp - so a timed game in the tab
 *    cannot even estimate a reveal after its commit phase closes. See
 *    `work/notes/findings/an-automined-chain-has-no-clock-between-transactions.md`
 *    on the `work` branch.
 *
 * 2. **Everything else unchanged**, by SPREADING the deploy's own `default`
 *    data rather than restating it. `commitGas`, `revealGas`,
 *    `actionsPerReveal` and `expectedActionsPerTurn` are properties of the
 *    CONTRACTS and of the EVM, not of where the chain runs, and webevm was
 *    measured to agree with hardhat to the unit on all six gas readings - so
 *    the declared limits keep their measured headroom here. Restating them
 *    would be a second copy of a measurement, which is exactly how the identity
 *    branches once came to price a credit 58% above what a step there costs.
 *    The ONE exception is the open set (`openSpawnPoints`), raised to
 *    `OFFLINE_OPEN_SPAWN_POINTS` so every seat of the largest table can start
 *    deployed in one cycle; it lives beside the gas figures because
 *    `GasBudget.test.ts` measures them at it.
 *
 * 3. **What the player is given**, which for this game is ONE ARMY'S STAKE in
 *    the account's reserve, bought through the same rail a purchase uses. It
 *    makes nobody a member: only armies are, so every seat, the person's
 *    included, then DEPLOYS an army with it, and a fresh world does that for
 *    every seat before the board shows (`$lib/offline-boot`).
 *
 * 4. **Who else is in it**, which is the difference between a commit-reveal
 *    game and a demonstration of one. A cycle with a single waited-for member
 *    hides nothing and two of `advanceCycle`'s three conditions cannot be
 *    reached at all, so a world enrols at least THREE and plays all but one of
 *    them. HOW MANY is the player's, chosen at the lobby before the world
 *    boots (`$lib/game/lobby`, wired to this world by `$lib/offline-lobby`), and
 *    it arrives here as a TABLE of seats. What those players DO is
 *    `$lib/offline-players`; who is in each seat is `$lib/game/lobby/seats`,
 *    which is framework and shared. What is decided here is what each of them is
 *    GIVEN and how this game spells who they are, because that is what differs
 *    per branch and this file differs already.
 *
 * WHAT IS NOT THIS GAME'S IS NOT HERE: the world is opened and booted by
 * jolly-roger's `$lib/offline-world`, and its wallet, the walk of the table,
 * the world's table, the people's sign-in and keys, the hotseat, the played
 * seats and what starts with the board are the template's steps
 * (`$lib/game/offline`), which this file composes around what this game
 * decides (jolly-roger's plan, K2c). A demo preset keeps its own opener: its
 * world is never persisted, so there is nothing to restore.
 *
 * It lives beside `lib/index.ts` rather than in a route, for the reason the
 * mechanism's README gives: this repo deletes the demo routes it inherits, and
 * anything world-building written inside one is thrown away with them.
 */

/**
 * The keys the deploy signs with, and they are PUBLIC AND FIXED on purpose.
 *
 * These are hardhat's well-known development accounts. There is nothing to
 * protect: the chain exists only in this tab, it has no bridge to anywhere, and
 * its ether is a number this file sets with a cheat call. Generating a key per
 * world would buy no security and would cost the one thing that matters here -
 * a world's contract addresses would change between runs, so nothing could be
 * reasoned about or written down.
 *
 * The PLAYER does not use these. They play through the announced wallet (see
 * `lib/embedded/wallet.ts`), which holds its own mnemonic.
 */
const DEPLOYER =
	'0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;
const DEPLOYER_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as const;
const ADMIN =
	'0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;
const ADMIN_ADDRESS = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as const;

/**
 * Where the id of the world in this browser is kept.
 *
 * EXPORTED because the LOBBY is what decides a world is over: changing how
 * many seats are at the table cannot be done to a world that is already
 * provisioned, so the lobby forgets this and the next boot mints a fresh id.
 * The key lives here rather than there because this file is what writes it.
 */
export const CHAIN_ID_STORAGE_KEY = 'offline-world:chain-id';
/**
 * Where the address of the world's TABLE is kept, when the world is a table
 * (`$lib/game/lobby/offline-table`): written as soon as it is created, checked
 * against the chain on every boot after, and forgotten with the world by the
 * lobby, which reads this key off this module. A WIRE from its first build.
 */
export const TABLE_STORAGE_KEY = 'offline-world:table';

/**
 * HOTSEAT: how many people at this device this world can play, each their own
 * account in the world's wallet, passing the device between them
 * (`$lib/game/lobby/hotseat`). Every seat may be one. Read by the
 * byte-identical lobby off this module (`$lib/offline-lobby`); a game whose
 * world does not export it offers no hotseat.
 */
export const LOCAL_HUMANS_AT_MOST = MOST_SEATS;

/**
 * THE LEVELS A WORLD SEAT MAY PLAY AT, chosen per seat at the lobby: `greedy`
 * (captures the most valuable piece it can reach, else a random legal move;
 * `$lib/chess/strategy`) and `random` (deploys, then passes). Read by the
 * byte-identical lobby off this module.
 */
export const AI_LEVELS: readonly AiLevel[] = CHESS_LEVELS;
/**
 * THE LEVEL A WORLD SEAT STARTS AT in a fresh choice: greedy, so single player
 * has opponents that punish a blunder (the spec's story 43). A world restored
 * from a record keeps the levels it was built with.
 */
export const AI_DEFAULT_LEVEL = GREEDY_LEVEL;
/**
 * Where the world's machine seats keep the move they decided, between its
 * commit and its reveal. A WIRE from its first build, like the record it holds
 * (`$lib/game/core/strategy`): a record a later build cannot read is a seat
 * that cannot open its commitment, and an army that freezes.
 */
export const PLAYED_TURNS_STORAGE_KEY = 'offline-world:played-turns';
const PLAY_MONEY = 10n ** 24n;

/**
 * THE DEPLOYMENT AN OFFLINE GAME IS, as one exported value.
 *
 * Exported rather than inlined below so that the world test can deploy the
 * same thing this file does. What is worth testing about an offline world is
 * not that the mechanism boots - four suites under `test/lib/embedded` already
 * cover that - but that the DATA this game declares produces a deployment this
 * game can actually play, and a test that restated the data would be asserting
 * against its own copy of the decision.
 */
export const OFFLINE_DEPLOYMENT = {
	/**
	 * The environment NAME the deploy runs under, which is what selects the
	 * per-environment data below. Its own rather than `localhost`, so that
	 * changing what an offline game is cannot change what a developer's local
	 * chain is.
	 */
	environment: 'offline',
	scripts: [
		{id: '001_deploy_token', module: deployToken},
		{id: '010_deploy_game', module: deployGame},
		{id: '020_deploy_stake_sale', module: deployStakeSale},
		// THE TABLES, which an offline world plays too (`startOfflineTable`):
		// the factory and the lobby implementation every table is a clone of.
		{id: '030_deploy_lobby', module: deployLobby},
	],
	/**
	 * What the in-tab deployment declares.
	 *
	 * SPREAD FROM THE DEPLOY'S OWN `default`, so the only things this world says
	 * are the things that are actually different about it. See point 2 on this
	 * module for why the rest must not be restated here - and note that the
	 * spread is load-bearing rather than tidy: the world's `data` REPLACES the
	 * environment's entry wholesale, so a partial declaration would leave
	 * `commitGas` undefined and the client would refuse to start.
	 */
	data: {
		Game: {
			...config.data.Game.default,
			cyclePolicy: CYCLE_POLICY.Manual,
			commitPhaseDuration: 0n,
			revealPhaseDuration: 0n,
			// ENOUGH SPAWN POINTS FOR EVERY SEAT AT ONCE: a fresh world starts with
			// every seat of the table deployed, each on its own spawn point, in one
			// cycle (`$lib/offline-boot`), and a table has up to `MOST_SEATS`. The
			// gas budget is measured at exactly this K (`GasBudget.test.ts`).
			openSpawnPoints: OFFLINE_OPEN_SPAWN_POINTS,
		},
		// A TABLE RUNS THE WORLD'S CLOCK HERE, for the world's reason (point 1
		// on this module): the Manual cycle with both durations zero, every
		// phase closed by its members. Everything else is the lobby's own.
		Lobby: {
			...config.data.Lobby.default,
			cyclePolicy: CYCLE_POLICY.Manual,
			commitPhaseDuration: 0n,
			revealPhaseDuration: 0n,
		},
	},
	accounts: {deployer: DEPLOYER, admin: ADMIN},
	initialBalances: {
		[DEPLOYER_ADDRESS]: PLAY_MONEY,
		[ADMIN_ADDRESS]: PLAY_MONEY,
	},
} as const;

/**
 * WHAT A DEMO PRESET'S WORLD DEPLOYS (`$lib/offline-presets`): the offline
 * deployment with ONE number changed, the tight spawn grid the contract tests
 * play on, so armies spawn next to each other. Everything else, the manual
 * policy and the gas figures included, is the offline world's own.
 */
export const PRESET_DEPLOYMENT_DATA = {
	...OFFLINE_DEPLOYMENT.data,
	Game: {
		...OFFLINE_DEPLOYMENT.data.Game,
		spawnSpacing: PRESET_SPAWN_SPACING,
	},
} as const;

/** What a `Ready` world carries as its `context`: the context, and what starts with the board. */
type OfflineWorldContext = {context: Context; start: () => () => void};
type ReadyWorld = {world: EmbeddedWorld; context: OfflineWorldContext};

export type OfflineWorldStatus = OfflineBootStatus<ReadyWorld>;

/**
 * THE WORLD'S OWN WALLET, announced at provisioning: the world switches its
 * accounts in hotseat (`$lib/game/offline`'s `createOfflineWallet`).
 */
const wallet = createOfflineWallet();

/**
 * A DEMO PRESET'S WALLET, its own: derived from a FIXED mnemonic
 * (`PRESET_MNEMONIC`), so the preset gives the same accounts, and the same army
 * ids, every time. Announced by this game's own announcer, every seat still
 * given its gas by the step.
 */
const presetWallet = createOfflineWallet({
	announce: (params) =>
		announceEmbeddedWallet({...params, mnemonic: PRESET_MNEMONIC}),
});

/**
 * APP-SCOPED AND LAZY, and the lifetime is the decision rather than the
 * laziness (`$lib/offline-world`'s `createOfflineBoot`): nothing runs until a
 * page asks, a world is STATE rather than a view so a second start joins the
 * first, and a failed boot is dropped so a retry is possible.
 */
const boot = createOfflineBoot(
	(booting, table: Table, at: TableAt | undefined) =>
		buildOfflineWorld(booting, table, {at}),
);

/**
 * THE DEMO PRESET THIS TAB IS PLAYING, if any (`$lib/offline-presets`): what
 * the page reads to show the preset's hint, its restart and its own failure.
 */
const preset = writable<OfflinePreset | undefined>(undefined);
export const offlinePreset: Readable<OfflinePreset | undefined> = {
	subscribe: preset.subscribe,
};

/**
 * The preset world this tab built last, a boot of its own per take: what a
 * restart lets go of. A take is never restored, so each restart is a new boot.
 */
const presetTake = writable<OfflineBoot<ReadyWorld, []> | undefined>(undefined);
const presetStatus: Readable<OfflineWorldStatus> = derived(
	presetTake,
	(take, set) => (take ? take.status.subscribe(set) : set({step: 'Idle'})),
	{step: 'Idle'} as OfflineWorldStatus,
);

/**
 * What the page renders: the preset's world when this tab plays one, the
 * player's own otherwise. A tab plays one or the other (the page decides by
 * its URL, once).
 */
export const offlineWorld: Readable<OfflineWorldStatus> = derived(
	[preset, boot.status, presetStatus],
	([chosen, own, ofThePreset]) => (chosen ? ofThePreset : own),
);

export function startOfflineWorld(params: {
	/**
	 * Everyone this world will wait for, chosen at the lobby before anything
	 * booted. A world that is already building keeps the table it was started
	 * with: membership is provisioned once and cannot be changed afterwards
	 * without staking or withdrawing members mid-cycle.
	 */
	table: Table;
}): Promise<OfflineWorldStatus> {
	return boot.start(params.table, undefined);
}

/**
 * A TABLE IN THIS WORLD: a game for the seats chosen, created by the first
 * person's account, every seat staked at it, started by the tab, ended after
 * `cycles`. Read by the byte-identical lobby off this module (`$lib/offline-lobby`):
 * exporting it is what offers a table offline, and a game with online tables
 * must (`test/offline-tables-boundary.test.ts`). The world's own `Game` is
 * deployed beside it, and nobody is staked there.
 */
export function startOfflineTable(
	choice: TableChoice,
): Promise<OfflineWorldStatus> {
	return boot.start(choice.table, {
		cycles: choice.cycles,
		gameOptions: choice.gameOptions,
	});
}

/**
 * START A DEMO PRESET: a fresh world in this tab, in the preset's position.
 *
 * ISOLATED FROM THE PLAYER'S OWN OFFLINE WORLD, and that is the decision
 * everything below serves. A preset world is minted a fresh chain id that is
 * never written where the normal world's is (`offline-world:chain-id`), its
 * chain and deployment records are never persisted, it writes no lobby key,
 * and its world seats keep their decided turns in memory: the played-turns
 * store deletes every other chain's records when it opens, so sharing
 * `offline-world:played-turns` would strand the normal world's seats. What it
 * does leave in `localStorage` is keyed by its own chain id (its wallet, its
 * operations, its submissions), which nothing of the normal world reads.
 *
 * NOT CLAIMED. The one-tab-per-world lock exists because a persisted world
 * would be saved over by a second tab; a world that is never saved cannot be,
 * so a preset never takes `offline-world` from the tab playing it.
 */
export function startPresetWorld(
	chosen: OfflinePreset,
): Promise<OfflineWorldStatus> {
	const current = get(presetTake);
	if (current) return current.start();
	preset.set(chosen);
	return takeThePreset(chosen, async () => {});
}

/**
 * RESTART THE PRESET, from scratch and in the tab: the board unmounts (which
 * stops its loops), the old world's node is disposed and its wallet stops
 * announcing, and the preset is built again. No reload, so it works with the
 * network off, and it takes about as long as the first boot did: a deploy is
 * about a tenth of a second in node, and a setup is a few dozen transactions.
 */
export async function restartPresetWorld(): Promise<OfflineWorldStatus> {
	const chosen = get(preset);
	if (!chosen) throw new Error('no preset is being played in this tab');
	const previous = get(presetTake)?.current();
	return takeThePreset(chosen, async (booting) => {
		booting(`restarting ${chosen.name}`);
		showHotseat(undefined);
		// Let the page unmount the board first: its context's stop is what ends
		// the seats' loop, the revealer and the advance client.
		await new Promise((resolve) => setTimeout(resolve, 0));
		const old = await previous?.catch(() => undefined);
		if (old?.step === 'Ready') {
			await old.world.dispose().catch((err) => {
				console.warn('the previous preset world did not stop cleanly', err);
			});
		}
		presetWallet.stop();
	});
}

/** A new take of the preset: its own boot, `before` it builds. */
function takeThePreset(
	chosen: OfflinePreset,
	before: (booting: (what: string) => void) => Promise<void>,
): Promise<OfflineWorldStatus> {
	const take = createOfflineBoot(async (booting) => {
		await before(booting);
		return buildOfflineWorld(booting, presetTable(chosen), {demo: chosen});
	});
	presetTake.set(take);
	return take.start();
}

/**
 * THIS GAME'S WORLD, composed of the steps every commit-reveal game's world
 * takes (`$lib/game/offline`) around what is this game's: its deployment, its
 * stake, its armies deployed before the board shows, a preset's own opener,
 * wallet and opening, and how its world seats decide.
 */
async function buildOfflineWorld(
	booting: (what: string) => void,
	table: Table,
	options: {demo?: OfflinePreset; at?: TableAt} = {},
): Promise<ReadyWorld> {
	const {demo, at} = options;
	const theWallet = demo ? presetWallet : wallet;
	// The id is minted once and remembered, because it is what keys everything
	// the player keeps: the operations ledger, and this game's submission
	// storage (`chess/storage.ts` keys by `chainID_gameAddress_army`). See
	// `lib/embedded/chain-id.ts`. A preset's is minted and FORGOTTEN: each build
	// is a new world, so nothing a previous take kept can be read into it.
	const world = demo
		? await openPresetWorld(booting, mintChainId(), table)
		: await openOfflineWorld({
				chainIdKey: CHAIN_ID_STORAGE_KEY,
				deployment: {
					rocketh: {config, extensions},
					environment: OFFLINE_DEPLOYMENT.environment,
					scripts: [...OFFLINE_DEPLOYMENT.scripts],
					// The manual policy and the two zeroes are the whole of what is
					// different about an offline deployment. See `OFFLINE_DEPLOYMENT`.
					data: {...OFFLINE_DEPLOYMENT.data},
					accounts: {...OFFLINE_DEPLOYMENT.accounts},
					initialBalances: {...OFFLINE_DEPLOYMENT.initialBalances},
				},
				chainProperties: config.chains[31337].properties,
				provision: (params) =>
					provisionOfflinePlayer({
						...params,
						wallet,
						table,
						atTable: !!at,
						onStep: booting,
					}),
				onStep: booting,
			});
	const humans = humansAtThisDevice(table);

	let where = theWorldsGame(world);
	if (at) {
		const opened = await openTheWorldsTable({
			world,
			wallet,
			lobby: gameLobby,
			table,
			at,
			stake: (resolved) =>
				stakeForEveryoneAtTheTable({
					env: world.env,
					table: resolved.address,
					player: wallet.current()!.accounts[0],
					humans: wallet.current()!.accounts,
					seats: table,
				}),
			chainIdKey: CHAIN_ID_STORAGE_KEY,
			storageKey: TABLE_STORAGE_KEY,
			onStep: booting,
		});
		// A refused table let go of this world and remembered a new id: build
		// again, which opens the new one.
		if (opened.kind === 'incoherent') {
			return buildOfflineWorld(booting, table, {at});
		}
		where = opened;
	}
	const {records} = where;
	const identityOf = (player: `0x${string}`) =>
		offlineIdentityOf({
			env: world.env,
			player,
			game: records.get().contracts.Game,
		});

	/**
	 * How many times the board is PLAYING (between the ready world's `start` and its
	 * stop). The seats act during the boot too (`deployEverySeat` ticks their
	 * loop), and the advance client's `check` runs whether or not it was
	 * started: poked then, it pushed the cycle while the boot was about to,
	 * and the boot's own advance reverted with StillWaitingToCommit, which
	 * failed the world. So nothing pokes it until the board is playing.
	 */
	let playing = 0;
	let pokeAdvance = () => {};
	const revealer = revealerForTheHumans({
		world,
		records,
		humans,
		onActed: () => pokeAdvance(),
	});

	booting('connecting');

	// SYNCHRONOUS, AND AFTER THE WORLD, which is the shape the whole design
	// turns on. The context cannot be built first and filled in: it reads a
	// contract address out of `deployments` while constructing, to scope the
	// operations ledger, and before the deploy there is no address to give it.
	// ADR-0002 is untouched - the app-level context in `+layout.svelte` is still
	// built synchronously during prerender, because that one is the remote
	// world.
	const context = createContext({
		establishConnection: where.establishConnection,
		...(revealer ? {scheduler: revealer.scheduler} : {}),
		// AT A TABLE the context is the table's, with its roster and its
		// creator's powers, its seats named as the lobby named them.
		...(where.table
			? {
					table: where.table,
					seatLabels: await offlineSeatLabels({
						table,
						accounts: wallet.current()?.accounts,
						identityOf,
						levels: AI_LEVELS,
					}),
				}
			: {}),
	});
	pokeAdvance = () => {
		if (playing > 0) void context.context.game.cycleAdvance.check();
	};
	holdTheWorldOnTheConsole({world, context: context.context});

	// The world connects, signs in and authorises every person's key itself
	// (`seatTheHumans`), and the handover passes the device between them.
	const seated = await seatTheHumans({
		context: context.context,
		wallet: theWallet.current(),
		humans,
		identityOf,
		onStep: booting,
	});
	const hotseat = handOverBetweenThem({
		seated,
		wallet: theWallet.current(),
		revealer,
		context: context.context,
		world,
		records,
	});

	/**
	 * THE OTHER PLAYERS, STARTED WITH THE BOARD AND STOPPED WITH IT
	 * (`readyToPlay`).
	 */
	const played = await playedByTheWorld({
		env: world.env,
		table,
		game: records.get().contracts.Game,
	});
	const decider = playedSeatDecider(
		{provider: world.provider, deployments: records},
		played,
		demo ? {storage: inMemoryStorage()} : {},
	);
	const people = theWallet.current();
	// EVERY SEAT DEPLOYS BEFORE THE FIRST CYCLE TURNS OVER: the people here and
	// the seats the world plays. Only armies are members, so without this the
	// first to deploy would close the commit phase on everyone else. See
	// `$lib/chess/awaited-deployments`. Not at a table, whose members are its
	// seats, each an army from the stake that seated it.
	if (!where.table) {
		awaitDeploymentsOf(world.deployments.get().chain.id, [
			...(people ? people.accounts : []),
			...played.map((seat) => seat.address),
		]);
	}
	const players = createOfflinePlayers({
		provider: world.provider,
		deployments: records,
		config: resolveChessConfig(records.get()),
		players: played,
		// A played commit can complete unanimity just as the human's can, and the
		// advance client would otherwise find out on its own one-second poll.
		onActed: () => pokeAdvance(),
		...(decider ? {strategy: decider.strategy, turns: decider.turns} : {}),
	});

	/**
	 * EVERY SEAT STARTS ON THE BOARD (`$lib/offline-boot`): the people's
	 * deployments signed by the world's own wallet, the seats the world plays
	 * deploying through their own loop in the same cycle. AFTER provisioning
	 * (the stakes are bought) and BEFORE the world is ready and its loops start,
	 * so neither the seats' loop nor the advance client ever sees a half-done
	 * boot. Decided from the chain, so a restore that already has its armies
	 * sends nothing and an interrupted boot is finished here.
	 */
	if (people && demo) {
		// A PRESET'S OPENING IS ITS OWN: every army on the spawn point it names,
		// then the cycles that bring the pieces into position, all through the
		// contract. The machine seats are DEPLOYED here rather than by their loop,
		// which only ever deploys a seat that has no army, so it finds them
		// standing and plays them from there.
		await setUpPreset({world, wallet: people, table, demo, played, booting});
		await warmTheRulesSandbox(world);
	} else if (people && !where.table) {
		// NOT AT A TABLE: there a seat's army is made by the stake that seated it
		// (`stakeForEveryoneAtTheTable`), on the table's own spawn grid.
		booting('deploying every army');
		await deployEverySeat({
			provider: world.provider,
			deployments: world.deployments,
			config: resolveChessConfig(world.deployments.get()),
			humans: humans.map((human, index) => ({
				address: people.accounts[human.account],
				seat: humanBootSeat(index, played.length),
			})),
			seats: [
				...humans.map((human) => people.accounts[human.account]),
				...played.map((seat) => seat.address),
			],
			sendAs: walletSender(world, people),
			machines: players,
		});
	}

	showHotseat(hotseat);
	return {
		world,
		context: readyToPlay({
			context,
			players,
			revealer,
			hotseat,
			decider,
			// THE BOARD IS PLAYING, which is what lets the advance be poked.
			// Counted once, however often its stop is called.
			also: [
				() => {
					playing++;
					let stopped = false;
					return () => {
						if (!stopped) playing--;
						stopped = true;
					};
				},
			],
		}),
	};
}

/**
 * HOW THE WORLD'S SEATS DECIDE, when one of them plays at a level other than
 * `random`: this game's strategy over the world's own provider, with the rules
 * run from the Simulation route's bytecode in a sandbox of the seats' own (not
 * the player's, which is the game context's and rebuilt with it), and the
 * store their decided moves are kept in. Undefined when every seat plays
 * `random`, so such a world builds no sandbox and stores nothing.
 *
 * EXPORTED for the world test, which builds the seats exactly as this does.
 * Handed the provider and nothing of the page: no context, no submission, no
 * handover.
 */
export function playedSeatDecider(
	world: Pick<EmbeddedWorld, 'provider' | 'deployments'>,
	played: readonly OfflinePlayer[],
	options: {
		storage?: Pick<Storage, 'getItem' | 'setItem'>;
		/** Where the sandbox's node runs; a Worker by default. */
		node?: Parameters<typeof createBytecodeSandbox>[0]['node'];
	} = {},
):
	| {
			strategy: ReturnType<typeof createChessStrategy>;
			turns: ReturnType<typeof createPlayedTurnStore<Move>>;
			sandbox: BytecodeSandbox<'rules'>;
	  }
	| undefined {
	if (played.every((seat) => seat.level === undefined)) return undefined;
	const records = world.deployments.get();
	const game = {
		address: records.contracts.Game.address,
		abi: records.contracts.Game.abi,
	};
	const sandbox = createBytecodeSandbox({
		provider: world.provider as never,
		...(options.node ? {node: options.node} : {}),
		contracts: {
			rules: {
				address:
					records.contracts.Game_Implementation_Router_Simulation_Route.address,
			},
		},
	});
	const publicClient = createPublicClient({
		chain: worldChain(world),
		transport: custom(world.provider as never),
	});
	const read = async <T>(functionName: string, args: unknown[]) =>
		(await publicClient.readContract({
			...game,
			functionName,
			args,
		} as never)) as T;
	const strategy = createChessStrategy({
		readArmy: async (army) =>
			armyViewOf(
				await read<Parameters<typeof armyViewOf>[0]>('getArmy', [army]),
			),
		readPieces: async ({minX, minY, maxX, maxY}) =>
			(
				await read<readonly [readonly Parameters<typeof pieceOf>[0][], bigint]>(
					'getPieces',
					[minX, minY, maxX, maxY],
				)
			)[0].map(pieceOf),
		wholeMove: (functionName, args) =>
			sandbox.call({
				contract: 'rules',
				abi: game.abi,
				functionName,
				args: args as never,
			}) as Promise<unknown>,
		maxPieceMoves: () =>
			readMaxPieceMoves((functionName) => read<bigint>(functionName, [])),
		materialOf: async (kind: PieceKind) =>
			Number(
				(await sandbox.call({
					contract: 'rules',
					abi: game.abi,
					functionName: 'materialOf',
					args: [kind],
				})) as unknown as bigint,
			),
	});
	const turns = createPlayedTurnStore<Move>({
		storage: options.storage ?? localStorage,
		key: PLAYED_TURNS_STORAGE_KEY,
		chainId: records.chain.id,
		contract: game.address,
		format: MOVE_STORAGE,
	});
	return {strategy, turns, sandbox};
}

/**
 * Send one call to the game as one of the world's wallet's accounts, and wait
 * for it to be mined. The burner signs for whichever of its accounts `from`
 * names and asks nobody (it auto-approves), so this is the people's own
 * account acting, without a prompt and without switching the selected one.
 */
function walletSender(
	world: Pick<EmbeddedWorld, 'provider' | 'deployments'>,
	wallet: EmbeddedWallet,
) {
	const chain = worldChain(world);
	const records = world.deployments.get();
	const publicClient = createPublicClient({
		chain,
		transport: custom(world.provider as never),
	});
	const walletClient = createWalletClient({
		chain,
		transport: custom(wallet.handle.walletProvider.underlyingProvider as never),
	});
	return async (
		address: `0x${string}`,
		request: Record<string, unknown>,
	): Promise<void> => {
		const hash = await walletClient.writeContract({
			address: records.contracts.Game.address,
			abi: records.contracts.Game.abi,
			account: address,
			...request,
		} as never);
		const receipt = await publicClient.waitForTransactionReceipt({hash});
		if (receipt.status !== 'success') {
			throw new Error(
				`the offline world's ${String(request.functionName)} reverted`,
			);
		}
	};
}

/**
 * Play a preset's opening on its fresh world (`$lib/offline-preset-setup`):
 * the people sign with the world's wallet, the world's seats with their keys.
 */
async function setUpPreset(params: {
	world: EmbeddedWorld;
	wallet: EmbeddedWallet;
	table: Table;
	demo: OfflinePreset;
	played: readonly OfflinePlayer[];
	booting: (what: string) => void;
}): Promise<void> {
	const {world, wallet, table, demo, played} = params;
	const owners = seatOwners(table, wallet.accounts);
	const asPerson = walletSender(world, wallet);
	const keys = createPlayedKeys({
		provider: world.provider as never,
		chain: worldChain(world),
		contract: {
			address: world.deployments.get().contracts.Game.address,
			abi: world.deployments.get().contracts.Game.abi,
		},
	});
	const keyOf = new Map(
		played.map((seat) => [seat.address.toLowerCase(), seat.privateKey]),
	);
	await playPresetSetup({
		provider: world.provider,
		deployments: world.deployments,
		config: resolveChessConfig(world.deployments.get()),
		armies: demo.armies.map((army) => ({
			owner: owners[army.seat],
			spawnPoint: squareAt(...army.spawn),
		})),
		cycles: [
			...demo.setup.map((cycle) =>
				cycle.map((turn) => ({army: turn.army, moves: movesOf(turn.moves)})),
			),
			// ONE QUIET CYCLE LAST, every army passing, so the board first shows
			// after a cycle in which nothing happened: the HUD reports the last
			// closed cycle's outcomes, and a setup's own capture ("a pawn was
			// captured by a knight") is not what the take is about.
			...(demo.setup.length > 0 ? [[]] : []),
		],
		sendAs: (owner, request) => {
			const key = keyOf.get(owner.toLowerCase());
			return key ? keys.send(key, request) : asPerson(owner, request);
		},
		onCycle: (done, of) =>
			params.booting(`setting up ${demo.name} (cycle ${done + 1} of ${of})`),
	});
}

/**
 * FETCH THE RULES SANDBOX'S WORKER ONCE, while the network is still there, so
 * a preset plays with it off (`$lib/offline-presets`: the demo is filmed with
 * the Wi-Fi off).
 *
 * The board checks every move against the contract's rules in a sandbox that
 * runs in a Worker of its own (`$lib/game/simulation`), created on the first
 * check. The app's service worker precaches every file of the build EXCEPT the
 * Worker bundles (SvelteKit's `build` list does not name them), and keeps what
 * it fetches at run time. So a sandbox first made with the network off has no
 * script to start from, the board never loads for the move check, and the move
 * is refused. One call here, at boot, makes the service worker keep it.
 * Non-fatal: the world plays without it, only not offline.
 */
async function warmTheRulesSandbox(world: EmbeddedWorld): Promise<void> {
	const records = world.deployments.get();
	const sandbox = createBytecodeSandbox({
		provider: world.provider as never,
		contracts: {
			rules: {
				address:
					records.contracts.Game_Implementation_Router_Simulation_Route.address,
			},
		},
	});
	try {
		await sandbox.call({
			contract: 'rules',
			abi: records.contracts.Game.abi,
			functionName: 'materialOf',
			args: [1],
		} as never);
	} catch (err) {
		console.warn('the rules sandbox could not be started ahead of play', err);
	} finally {
		sandbox.dispose();
	}
}

/**
 * A `Storage`-shaped map that lives as long as the world: where a preset's
 * world seats keep their decided turns, so nothing is written under the
 * normal world's `offline-world:played-turns`.
 */
function inMemoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
	const items = new Map<string, string>();
	return {
		getItem: (key) => items.get(key) ?? null,
		setItem: (key, value) => void items.set(key, value),
	};
}

/**
 * How the offline chain describes itself, for a preset's opener: the normal
 * world's (`$lib/offline-world`'s opener names it so too), the local chain's
 * own properties read out of the deploy config rather than typed again
 * (`expectedWorstGasPrice` and `creditsGasMultiplier` are what denominate the
 * play key's gas in MOVES, and a second copy of either is a number that can
 * drift into telling the player they have more turns than they do), with the
 * block time and the finality every in-tab chain has (`OFFLINE_CHAIN_TIMING`).
 */
const OFFLINE_CHAIN = {
	name: 'Offline',
	nativeCurrency: {name: 'Ether', symbol: 'ETH', decimals: 18},
	properties: {...config.chains[31337].properties, ...OFFLINE_CHAIN_TIMING},
};

/**
 * Boot a DEMO PRESET's world (`$lib/offline-presets`): the offline deployment on
 * the tight spawn grid, NEVER PERSISTED. No IndexedDB for the chain (its node
 * runs in a Worker as the normal world's does, with nothing to save to) and no
 * store for the deployment records, so there is no restore to check either:
 * every build is a first boot, and disposing the node is the end of it. Its
 * own opener for that reason: `$lib/offline-world`'s persists and restores.
 *
 * The people's wallet derives from a FIXED mnemonic, so the preset gives the
 * same accounts, and the same army ids, every time (`presetWallet`).
 */
async function openPresetWorld(
	booting: (what: string) => void,
	chainId: number,
	table: Table,
): Promise<EmbeddedWorld> {
	booting('starting a chain in this tab');
	const worldNode = offlineWorldNode({db: undefined});
	return createEmbeddedWorld({
		chainId,
		chain: OFFLINE_CHAIN,
		rocketh: {config, extensions},
		environment: OFFLINE_DEPLOYMENT.environment,
		scripts: [...OFFLINE_DEPLOYMENT.scripts],
		data: {...PRESET_DEPLOYMENT_DATA},
		accounts: {...OFFLINE_DEPLOYMENT.accounts},
		initialBalances: {...OFFLINE_DEPLOYMENT.initialBalances},
		createNode: worldNode.createNode,
		persistence: worldNode.persistence,
		provision: (params) =>
			provisionOfflinePlayer({
				...params,
				chainId,
				wallet: presetWallet,
				table,
				atTable: false,
				onStep: booting,
			}),
	});
}

/**
 * WHAT AN OFFLINE PLAYER OF THIS GAME IS GIVEN, which is the seam's whole
 * content and is this game's answer rather than the framework's.
 *
 * Three things, and the order matters because each needs the one before it:
 *
 * 1. **A wallet.** The world brings its own, so the player is never asked to
 *    pick one - and cannot pick one that has no account on this chain, which is
 *    every other wallet they own.
 * 2. **Gas**, by cheat call. The chain is in the tab; its ether is a number.
 * 3. **ONE ARMY'S STAKE**, in the account's reserve, which is what THIS game
 *    puts at risk. Bought through `StakeSale.purchase`, the same rail the
 *    online purchase uses, so the offline world exercises the contract path the
 *    online one depends on. It makes nobody a member: only armies are, so the
 *    world deploys an army with it for the person before the board shows
 *    (`$lib/offline-boot`), and every seat the world plays deploys one too
 *    (`$lib/offline-players`).
 * 4. **EVERYONE ELSE AT THE TABLE**, which is gas and a stake for every seat
 *    the lobby laid out and is the same three things over again. They are given
 *    exactly what the human is given and nothing more, so what the world can
 *    do, the human can do.
 *
 * WHAT IT STILL DOES NOT DO IS AUTHORISE THE BROWSER'S KEY, and this paragraph
 * used to go on to say that authorising was therefore the player's one press.
 * It is not any more, and the REASON given here was true and stays true: the
 * signer is derived in the tab from a wallet signature AFTER this runs (and
 * after the context exists at all), so provisioning cannot know its address,
 * let alone register it. What has changed is who does it once it exists. The
 * world does, in the step that asks for that signature and is therefore the
 * first moment there is an address to register - see `seatTheHumans`
 * (`$lib/game/offline`).
 *
 * ASKING WAS RIGHT WHEN THE WORLD HAD ONE MEMBER, AND IS NOT NOW. With one
 * member that press was the only thing in the whole world that the player was
 * asked for, so it read as the honest split: the world gives what only the
 * world can give - a chain, contracts, gas and a stake - and the browser gives
 * what only it can, a key and the authority to play with it. With a table of
 * members already provisioned and already waiting, the same press is one
 * dialog with one possible answer in front of a game that is otherwise ready:
 * both sides of "who pays" are the same wallet, on a chain in this tab,
 * holding money this file invented. A question with one answer is not consent,
 * it is a gate. The SPLIT is unchanged - the browser still supplies the key
 * and the authority - what went is being asked to confirm it.
 *
 * THE STIPEND IS ZERO HERE, and the sale refuses a stipend with nowhere to go,
 * so the two move together. There is still no key to forward gas to at this
 * point, for the reason above; the authorisation that happens later carries
 * its own gas with it, in the same transaction, exactly as the online one
 * does.
 */
async function provisionOfflinePlayer(params: {
	env: EmbeddedWorld['env'];
	node: {provider: WorldNodeProvider};
	chainId: number;
	/** The world's wallet: the player's own world's, or a preset's. */
	wallet: OfflineWallet;
	table: Table;
	/**
	 * Whether the world is a TABLE: then nobody is staked in the world's
	 * `Game`, and every seat is staked at the table once it exists (after the
	 * deploy, `openTheWorldsTable`).
	 */
	atTable: boolean;
	onStep: (what: string) => void;
}) {
	const {env, node, table} = params;

	// A WALLET AND GAS, for every seat (`$lib/game/offline`'s
	// `createOfflineWallet`, which says why gas is refilled on every boot and a
	// stake never is).
	params.onStep('handing the player a wallet');
	const announced = await params.wallet.announce({
		provider: node.provider,
		chainId: params.chainId,
		table,
		gas: PLAY_MONEY,
	});

	if (!params.atTable) {
		params.onStep('staking for everyone at the table');
		await stakeForEveryoneInTheWorld({
			env,
			player: announced.accounts[0],
			humans: announced.accounts,
			table,
		});
	}

	// HANDED BACK rather than announced-and-hoped-for. The connection this world
	// builds will use exactly this wallet, so the player is never asked to
	// choose one.
	return {wallets: [announced.handle]};
}

/**
 * GIVE EVERY SEAT AT THE TABLE AN ARMY'S STAKE.
 *
 * ONE FUNCTION RATHER THAN A CALL PER SEAT AT THE HOOK, because it is the half
 * of provisioning that can be asserted in node: `test/lib/embedded/world.test.ts`
 * calls exactly this, then deploys with it.
 *
 * A STAKE IS NOT MEMBERSHIP HERE. It sits in the account's reserve until the
 * seat deploys an army with it, and only the army is waited for. So this is
 * what lets every seat deploy, and the deployments are what make unanimity
 * mean something.
 */
export async function stakeForEveryoneInTheWorld(params: {
	env: EmbeddedWorld['env'];
	/**
	 * The human's address, which only exists once a wallet has been announced.
	 * Every other seat carries its own, because the world holds those keys.
	 */
	player: `0x${string}`;
	/**
	 * Every account of the world's wallet, in seat order, for the other people
	 * at this device (hotseat): a `local-human` seat is the account at its index.
	 */
	humans?: readonly `0x${string}`[];
	table: Table;
}): Promise<void> {
	await stakeEverySeat({
		table: params.table,
		you: params.player,
		...(params.humans ? {humans: params.humans} : {}),
		stake: ({player}) => stakeForOfflinePlayer({env: params.env, player}),
	});
}

/**
 * GIVE EVERY SEAT AT THE WORLD'S TABLE A SEAT: the stake bought AT THE TABLE
 * (`StakeSale.purchaseAt`, the rail an online seat is taken by), which creates
 * the seat's army and makes it a member of the closed roster, for each seat of
 * the table as {@link stakeForEveryoneInTheWorld} walks it, in seat order, so
 * each takes the next spawn point of the table's grid. Unless the seat already
 * has its army, for the reason {@link stakeForOfflinePlayer} gives: a stake
 * refilled by a reload is not a stake. Exported for the table test.
 */
export async function stakeForEveryoneAtTheTable(params: {
	env: EmbeddedWorld['env'];
	/** The table's address. */
	table: `0x${string}`;
	player: `0x${string}`;
	humans?: readonly `0x${string}`[];
	seats: Table;
}): Promise<void> {
	const env = params.env as unknown as {
		get: (name: string) => {abi: unknown};
		namedAccounts: Record<string, `0x${string}`>;
		read: (deployment: never, args: unknown) => Promise<unknown>;
		execute: (deployment: never, args: unknown) => Promise<unknown>;
	};
	const atTable = {
		address: params.table,
		abi: env.get('GameLobbyImplementation').abi,
	};
	await stakeEverySeat({
		table: params.seats,
		you: params.player,
		...(params.humans ? {humans: params.humans} : {}),
		stake: async ({player}) => {
			// SEATED ALREADY when its first army exists: at a table the stake that
			// seats an account creates its army (`GameTable`), so an account whose
			// next army is not its first has one.
			const next = (await env.read(atTable as never, {
				functionName: 'getNextArmy',
				args: [player],
			})) as bigint;
			if (next !== firstArmyOf(player)) return;
			await env.execute(env.get('StakeSale') as never, {
				account: env.namedAccounts.deployer,
				functionName: 'purchaseAt',
				args: [
					params.table,
					player,
					'0x0000000000000000000000000000000000000000',
					0n,
				],
				value: config.data.sale.default.price,
			});
		},
	});
}

/**
 * BOND THE STAKE, through the rail a purchase uses.
 *
 * Its own exported function because it is the half of provisioning that is
 * about THIS GAME rather than about a browser: the wallet and its gas are the
 * mechanism's shape and need a `window` to announce on, while what is at stake
 * is the game's and can be asserted in node. A world test that could only
 * check the deploy would not be checking the thing this file decides.
 */
export async function stakeForOfflinePlayer(params: {
	env: EmbeddedWorld['env'];
	player: `0x${string}`;
}): Promise<void> {
	const env = params.env as unknown as {
		get: (name: string) => never;
		namedAccounts: Record<string, `0x${string}`>;
		read: (deployment: never, args: unknown) => Promise<unknown>;
		execute: (deployment: never, args: unknown) => Promise<unknown>;
	};

	/**
	 * ONLY IF THEY HAVE NONE: no stake in the account's reserve and no army.
	 *
	 * Provisioning runs on every boot and a boot is not always a first boot: the
	 * chain and the deployment records both persist, so a reload restores the
	 * world and runs this hook again. Measured on the template: a reserve of 10
	 * became 20 on the second load. That is the stake becoming refillable by
	 * pressing F5, which is the one property the commit-reveal design rests on
	 * (`AGENTS.md`: something must be at stake). And here the account's reserve
	 * is EMPTY once its stake has moved into an army, so the army is asked about
	 * too, or every reload would buy one more.
	 *
	 * THE CHAIN IS ASKED RATHER THAN A FLAG KEPT: what is true is what the
	 * contract holds.
	 */
	const held = (await env.read(env.get('Game'), {
		functionName: 'getReserve',
		args: [BigInt(params.player)],
	})) as bigint;
	if (held > 0n) return;
	const next = (await env.read(env.get('Game'), {
		functionName: 'getNextArmy',
		args: [params.player],
	})) as bigint;
	if (next !== firstArmyOf(params.player)) return;
	await env.execute(env.get('StakeSale'), {
		// THE RESOLVED ADDRESS, not the private key the spec was written with.
		// rocketh resolves a named account to an address and keeps the signing
		// material against it (`privateKey:` protocol, which this config already
		// registers); handing it the key instead asks it to sign for an address
		// that does not exist, and the failure names the key as though it were
		// one. It cannot fall back to a node-held account either: an
		// execution-only chain answers `eth_accounts` with a real `-32601`.
		account: env.namedAccounts.deployer,
		functionName: 'purchase',
		// The player is an ARGUMENT rather than `msg.sender`: whoever sends this
		// pays and `player` is credited, which is what lets the deployer set up an
		// account that has never sent anything. Topping up somebody else's reserve
		// is a gift rather than an attack, because only its owner can withdraw it.
		//
		// THE STIPEND IS ZERO AND THE KEY IS THE ZERO ADDRESS, and the sale
		// refuses a stipend with nowhere to go, so the two move together. There is
		// no browser key to fund yet: it is derived after this runs.
		args: [params.player, '0x0000000000000000000000000000000000000000', 0n],
		// THE PRICE EXACTLY, read off the same config the sale was deployed with.
		// `purchase` subtracts the stipend from `msg.value` and then requires the
		// remainder to equal `PRICE` exactly, so a value computed anywhere else is
		// a value that can drift into `WrongPaymentAmount`.
		value: config.data.sale.default.price,
	});
}

/**
 * WHO AN ADDRESS PLAYS AS IN THIS WORLD: its FIRST ARMY, the one its first
 * deployment creates. An army id is `nonce << 160 | owner`, so this needs no
 * read; it is async, and takes the environment, so that a game whose identity
 * only the chain knows keeps the same signature.
 */
export async function offlineIdentityOf(params: {
	env: EmbeddedWorld['env'];
	player: `0x${string}`;
	/**
	 * THE GAME THE IDENTITY IS IN: the world's `Game` when omitted, or the
	 * world's table. Unused here, where an identity is the account's first army
	 * wherever it plays (at a table, the army its seat created); a game whose
	 * identity is a token held in a game's custody finds it in THIS game.
	 */
	game?: {address: `0x${string}`; abi: unknown};
}): Promise<bigint> {
	void params.env;
	void params.game;
	return firstArmyOf(params.player);
}

/** The seats the world plays, with the army each of their keys plays as. */
export async function playedByTheWorld(params: {
	env: EmbeddedWorld['env'];
	table: Table;
	/** The game they play in: see {@link offlineIdentityOf}. */
	game?: {address: `0x${string}`; abi: unknown};
}): Promise<readonly OfflinePlayer[]> {
	const resolved: OfflinePlayer[] = [];
	for (const played of seatsPlayedByTheWorld(params.table)) {
		resolved.push({
			privateKey: played.privateKey,
			address: played.address,
			identity: await offlineIdentityOf({
				env: params.env,
				player: played.address,
				...(params.game ? {game: params.game} : {}),
			}),
			seat: resolved.length,
			...(played.level !== undefined ? {level: played.level} : {}),
		});
	}
	return resolved;
}

/**
 * Stop announcing the offline wallet (the player's own world's and a
 * preset's).
 *
 * NOT a teardown of the world, deliberately: the chain outlives the page that
 * showed it, and disposing of it on unmount is how a router deletes somebody's
 * world.
 */
export function stopAnnouncingOfflineWallet(): void {
	wallet.stop();
	presetWallet.stop();
}
