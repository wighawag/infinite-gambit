// ----------------------------------------------------------------------------
// Typed Config
// ----------------------------------------------------------------------------
import type {
	EnhancedEnvironment,
	UnknownDeployments,
	UserConfig,
} from 'rocketh/types';

// this one provide a protocol supporting private key as account
import {privateKey} from '@rocketh/signer';

import {parseEther} from 'viem';

/**
 * How the cycle advances. Mirrors `UsingGameTypes.CyclePolicy`, whose ORDER is
 * the contract's: these are the enum's numeric values and rearranging them here
 * would silently deploy a different policy from the one named.
 *
 * `Timed` is what a deployed game wants, and it is the only one that needs no
 * transaction to move: the cycle simply is what the clock says.
 *
 * `Manual` has no clock at all. Every phase moves because someone pushed it,
 * and only once every member the cycle waits for has acted - so a member who
 * goes silent freezes it, and the way out is to stop waiting for them rather
 * than to add a timer.
 *
 * `TimedWithEarlyAdvance` is the clock as a DEADLINE, with unanimity able to
 * bring the next phase forward. Never worse than `Timed` for anyone absent,
 * because an advance only ever widens a window.
 *
 * Changing this changes the game the client draws, because it is recorded in
 * the Game's `linkedData` and read back. The e2e suite plays a TIMED game and
 * its waits are sized against the durations below.
 */
export const CYCLE_POLICY = {
	Timed: 0n,
	Manual: 1n,
	TimedWithEarlyAdvance: 2n,
} as const;

/**
 * Gas to allow for ONE TRANSACTION of each kind: a commit, and one reveal step.
 *
 * THESE BELONG TO THE CONTRACTS AND THEREFORE TO THIS FILE, which is the change
 * that matters rather than the numbers. They used to be constants in
 * the template game's client config, and that file is INHERITED down this
 * template tree while contracts are NOT: every game writes its own. So a
 * descendant ran its own contracts while reading gas figures measured against
 * somebody else's, in a file whose text did not differ at all. That is not
 * hypothetical - `with/nft-identity` measures 99,102 and 374,085 for the same
 * two transactions `main` measures at 116,898 and 535,561, because a placement
 * costs nothing there so a reveal writes no stake.
 *
 * Declared here, they travel with the contracts they were measured against:
 * they are recorded in the Game's `linkedData` by `deploy/010_deploy_game.ts`
 * and read off the deployment by the client, exactly as `actionsPerReveal` and
 * `stake` already are. A game that writes its own contracts cannot
 * inherit a wrong figure, because there is nothing to inherit.
 *
 * They are NOT in the Solidity `Config` struct, deliberately. The contract never
 * reads a gas figure, and putting one in constructor storage would cost gas
 * forever for a number only the client budgets with. `linkedData` is the
 * established channel for what the client must agree with the deploy about.
 *
 * MEASURED FOR CHESS, on the test build `GasBudget.test.ts` runs (no optimiser;
 * the optimised build a chain runs costs 4% to 25% less, the safe direction,
 * `docs/gas.md`). Re-measured for THREE PIECE-MOVES
 * (`three-piece-moves-gas-limits`, `docs/adr/0016`): a move is now up to three
 * piece-moves, all in one reveal, so the worst reveal is three piece-moves,
 * each as dear as the rules allow. NO REVEAL WALKS A CHAIN (merges, capture
 * chains and loops are gone, `docs/adr/0013`, `docs/adr/0014`), so what a
 * capture adds is bounded by the two squares each piece-move touches and the
 * armies on the squares it reads. Re-measured again for the table's toggle
 * (`three-piece-moves-table-toggle`): every reveal now reads the game's
 * options to know its cap, about 3,000 more on every reveal of the world.
 *
 *   the worst commit: a first paid deployment commit in a manual world,
 *   which settles the previous deployment and pays a fresh payee     370,098
 *   a plain move's commit (one piece-move or three: it stores a hash)  85,823
 *   the first deployment reveal ever                                  300,623
 *   the two-victim square (the dearest capture measured)              357,306
 *   the dearest plain move: the king's first step and two 7-square
 *   sliders over stale squares, in one reveal                         679,074
 *   the worst reveal: that move with each of its three piece-moves
 *   folding a two-victim square at its origin and at its destination
 *   and noting three candidates for a stake, and with each of the 22
 *   squares it reads holding a piece of a different fallen army whose
 *   fall is not folded yet (the vanish check, cold)                 1,834,764
 *
 * Each figure is its worst case plus `GasBudget.test.ts`'s minimum headroom
 * (10%), rounded up to ten thousand: COMMIT_GAS 410,000 (unchanged: a commit
 * stores a hash, whatever the move holds), REVEAL_GAS 2,020,000 (was 770,000,
 * priced on one piece-move a reveal; 720,000 and 1,100,000 before that). Under
 * the generosity ceiling too, now three times the dearest PLAIN move, the
 * three piece-moves above (2,037,222). The window is narrow: the figure is
 * 1,760 above the required 2,018,240 and 17,222 below that ceiling. Gas added
 * to EVERY reveal widens it (the ceiling rises three times as fast as the
 * worst), as the options read did; about 1,600 added to the worst alone
 * makes the rounded figure 2,030,000, still under the ceiling, and about
 * 10,700 closes it (the figure would round to 2,040,000) (`docs/gas.md`, "The declared figures").
 *
 * WHAT IT COSTS PLAYERS. `creditsGasMultiplier` below is COMMIT_GAS +
 * REVEAL_GAS, 2,430,000 where it was 1,180,000, so a credit is about twice the
 * gas it was and every player is shown about half the credits for the same
 * balance: in the world, and at every table, those that turn three
 * piece-moves off included, since a table's figure prices the same worst
 * (`LOBBY_REVEAL_GAS` below). The stipend a purchase gives the playing key, and
 * the prepayment fuzd takes to reveal for a player (each transaction's declared
 * gas at the chain's `expectedWorstGasPrice`), rise with `revealGas` the same
 * way. Nothing is SPENT beyond what a reveal uses: the figure is a limit and a
 * reservation, and a plain move still costs what it costs (`docs/gas.md`).
 *
 * Both carry a margin over the reading, because they size a RESERVATION: over
 * reserving costs a slightly larger first payment, under reserving costs a
 * player their gas mid-turn. `contracts/test/js/GasBudget.test.ts` fails if a
 * contract change outgrows either, which is what stops the margin being a
 * guess that rots.
 *
 * THEY ARE THE GAS LIMITS. The client passes `commitGas` as the limit of every
 * commit and `revealGas` as the limit of every reveal step (the base's adapter,
 * `web/src/lib/game/core/commit-reveal/adapter.ts`: "THE LIMIT, DECLARED BY THE
 * DEPLOYMENT"), rather than estimating. So a figure that is too low is not a
 * slow turn or a smaller stipend: it is a transaction that runs out of gas. On a
 * commit that is a turn not taken; on a reveal it is a missed reveal, which
 * takes the stake and blocks the next cycle until it is acknowledged. That is
 * why each covers the WORST case of its transaction, the paid commit included,
 * with headroom, and why `GasBudget.test.ts` pins both. A turn of several chunks
 * is bounded per transaction by this, and as a whole by `expectedActionsPerTurn`
 * below.
 */
const COMMIT_GAS = 410_000n;
const REVEAL_GAS = 2_020_000n;
/**
 * A TABLE'S REVEAL: the world's, plus listing every zone a reveal touches first
 * (`UsingGameTable._tally` counts the material at the cap from that list). A
 * move of three piece-moves touches up to six squares, so it lists up to six
 * zones: 67,571 at worst (four measured at 44,141, two more, and one more
 * fresh slot of the list), so a table's worst reveal is 1,901,611 and this is
 * that plus the minimum headroom (10%), rounded up (2,090,000 before the
 * options read; 840,000 priced on one piece-move listing two zones; 790,000
 * and 1,150,000 before that). A
 * table that turns three piece-moves off still declares it: one figure per
 * deployment, shared by every clone. Priced in `GasBudget.test.ts`, whose
 * generosity ceiling is three times a table's plain three-piece-move reveal
 * (about 2,238,000).
 */
const LOBBY_REVEAL_GAS = 2_100_000n;

/**
 * HOW MANY SPAWN POINTS THE OFFLINE WORLD OPENS (K), which is the one thing
 * `web/src/lib/offline.ts` changes about the open set: enough for every seat
 * of the largest table the lobby offers (`MOST_SEATS` in
 * `web/src/lib/game/lobby/seats.ts`, ten) to deploy on its own spawn point in
 * one cycle, which is how a fresh offline world starts
 * (`offline-world-pre-deploys-every-seat`). The online world and tables keep
 * their 8.
 *
 * HERE rather than in the web app, because the gas budget is measured against
 * it: the first deployment reveal writes the whole open set, so a larger K is a
 * dearer reveal under the same declared `revealGas`, and
 * `test/js/GasBudget.test.ts` measures a whole table deploying at exactly this
 * K. A copy in either place would be a measurement of a number nobody uses.
 */
export const OFFLINE_OPEN_SPAWN_POINTS = 10n;

/**
 * How many actions a player is EXPECTED to submit in one turn.
 *
 * AN EXPECTATION AND NOT A MAXIMUM, which is the whole reason it has to be
 * stated rather than derived. `REVEAL_GAS` bounds a TRANSACTION, and that is a
 * real bound in every game on every chain - it is what the chunk buys. What
 * nothing bounds is a TURN: a turn arrives in `ceil(actions / actionsPerReveal)`
 * transactions, and wherever an action costs nothing there is no worst case for
 * how many. So anything answering the player's actual question - how many more
 * TURNS can I play - cannot be computed from a maximum, because there is not
 * one. It has to be sized from a number the game states out loud.
 *
 * The alternative is to price everything PER TRANSACTION, which is exact and
 * gives up the thing being measured: "you have 40 of something" is not an
 * answer when the player does not know how many of that something a turn costs.
 * An average with its expectation written down is worth more than an exact
 * figure with no unit.
 *
 * ONE, IN CHESS, because what it sizes is how many TRANSACTIONS a turn takes,
 * and a chess turn is exactly one commit and one reveal whatever it holds. A
 * move is now up to three piece-moves (`docs/adr/0016`), three actions, but it
 * must arrive in ONE chunk: the contract refuses a chained one
 * (`OneMovePerCycle`), and `actionsPerReveal` is three so that a whole move
 * fits. So `ceil(1 / 3)` and `ceil(3 / 3)` are both one reveal, a pass and a
 * deployment are one too, and raising this to three would size the same
 * stipend while claiming a turn is three of something it is not. What three
 * piece-moves DID change is the cost of that one reveal, and that is
 * `REVEAL_GAS` above (about two and a half times what it was), which the
 * stipend already multiplies.
 *
 * It sizes the gas stipend and nothing else today. It is deliberately NOT used
 * to price a credit: a credit count is shown to the player as what they can
 * still do, so it has to be a FLOOR, and an expectation is not one. See the
 * stipend in `web/src/lib/chess/config.ts`.
 */
const EXPECTED_ACTIONS_PER_TURN = 1n;

// we define our config and export it as "config"
export const config = {
	// Chain properties are exported with the deployments and read by the web app
	// (see web/src/lib/context/config.ts).
	//
	// Adding `creditsGasMultiplier` here is what denominates the local signer's
	// gas balance as CREDITS - "12 credits" instead of "0.0012 ETH" - so a player
	// reads how many moves they can still make rather than a wei figure. It is
	// the gas ONE user action costs, so for this game it is the worst-case gas
	// of a commit plus a reveal, and `creditsPerTopUp` (optional, default 100)
	// is how many credits a top-up buys. Neither is defaulted: half a
	// configuration would produce a confident, wrong move count, so
	// web/src/lib/core/connection/credits.ts falls back to native currency
	// unless it knows what an action actually costs.
	//
	// A CREDIT IS A WORST-CASE MOVE, so it is a floor: since a move became up
	// to three piece-moves the worst reveal is about two and a half times
	// dearer (see REVEAL_GAS), and the same balance shows about half the
	// credits it did, for every player, whether they move one piece or three.
	// A plain move spends a fraction of it (`docs/gas.md`), so in practice a
	// player makes more moves than their credits say.
	chains: {
		// A LAN box (github:wighawag/ethereum-lan-node): its dev chain, which no
		// public chain list knows. nix/lan.nix deploys for it at build time, as
		// the `lan` environment (contracts/scripts/deploy-lan-build.ts).
		19216801: {
			info: {
				id: 19216801,
				name: 'LAN',
				nativeCurrency: {name: 'Ether', symbol: 'ETH', decimals: 18},
				rpcUrls: {default: {http: ['http://ethereum.local:8545']}},
				testnet: true,
			},
			properties: {
				// The box's genesis starts the base fee at 1 gwei
				// (`baseFeePerGas` 0x3b9aca00 in ethereum-lan-node's
				// nix/genesis.json), and on a quiet dev chain it only falls from
				// there, so 1 gwei is the worst it charges. WITHOUT IT the chain
				// falls back on `defaultChainProperties`, a thousandth of a gwei:
				// credits were priced a million times too cheap and a purchase's
				// stipend for the playing key came to almost nothing, so the key
				// could not even authorise itself (measured in reveal-or-die's
				// LAN rehearsal, 2026-11-04).
				expectedWorstGasPrice: parseEther('1', 'gwei'),
				creditsGasMultiplier: COMMIT_GAS + REVEAL_GAS,
				supportsSendRawTransactionSync: false,
			},
		},
		31337: {
			properties: {
				// The worst gas price this chain is expected to charge, in wei.
				// Pessimistic on purpose: it makes a credit count a floor the
				// player always gets, rather than one that drifts down with the
				// mempool while they sit still.
				expectedWorstGasPrice: parseEther('1', 'gwei'), // TODO use same value from hardhat config
				// Gas ONE USER ACTION costs, which since the reveal became chunked is
				// a commit plus ONE REVEAL STEP rather than a commit plus a whole
				// turn. A turn is no longer a transaction: it arrives in
				// `ceil(actions / actionsPerReveal)` reveals, so a long turn honestly
				// costs more credits than a short one, and a credit that still meant
				// "one turn" would be a number with no fixed gas behind it.
				//
				// One commit plus one reveal step, both at their declared worst
				// case (see COMMIT_GAS): derived from the one measurement rather
				// than typed out again, because two copies of one measurement is
				// how a credit ends up priced against a game nobody runs. In
				// chess a move is always one reveal step, its three piece-moves
				// included, so a credit is one move.
				creditsGasMultiplier: COMMIT_GAS + REVEAL_GAS,
				supportsSendRawTransactionSync: false,
			},
			tags: ['local', 'memory', 'testnet'],
		},
		// sepolia
		11155111: {
			properties: {
				// Measured 2026-11-06 over the last 1024 blocks: base fee 14-26
				// WEI, the node's suggested tip 2 wei, the median tip actually
				// paid about 1 gwei (blocks are far from full, so that is habit,
				// not competition). Half a gwei is still millions of times the
				// base fee, and it is ALSO the most fuzd may pay per gas for a
				// scheduled reveal (web/src/lib/fuzd/config.ts), so it must stay a
				// worst case and not a typical one. Higher costs players faucet
				// ETH: it prices their credits and fuzd's prepayment.
				expectedWorstGasPrice: parseEther('0.5', 'gwei'),
				creditsGasMultiplier: COMMIT_GAS + REVEAL_GAS,
				supportsSendRawTransactionSync: false,
			},
		},
		// mega-eth testnet
		6342: {
			properties: {
				expectedWorstGasPrice: parseEther('0.003', 'gwei'),
				supportsSendRawTransactionSync: false,
			},
		},
		// somnia testnet
		50312: {
			properties: {
				expectedWorstGasPrice: parseEther('8', 'gwei'),
				supportsSendRawTransactionSync: false,
			},
		},
		// celo sepolia testnet
		11142220: {
			properties: {
				expectedWorstGasPrice: parseEther('25', 'gwei'),
				supportsSendRawTransactionSync: false,
			},
		},
	},
	defaultChainProperties: {
		// if not specified, fallback on:
		expectedWorstGasPrice: parseEther('0.000001', 'gwei'),
		supportsSendRawTransactionSync: false,
	},
	accounts: {
		deployer: {
			default: 0,
		},
		admin: {
			default: 0, // TODO give the admin its own account
		},
	},
	environments: {
		localhost: {
			chain: 31337,
			overrides: {
				autoMine: true,
			},
		},
	},
	data: {
		/**
		 * What one stake costs and how much of it you get.
		 *
		 * `price` is in the chain's own currency and is checked EXACTLY by
		 * `StakeSale.purchase`, so it belongs on the sale's deployment and nowhere
		 * else. It is deliberately not zero even here: a free purchase would never
		 * exercise the value split that lets one transaction pay for the stake and
		 * fund the key that plays with it.
		 *
		 * `amount` is ONE ARMY'S STAKE (`Game.stake` below): one purchase is one
		 * deployment. The two are separate numbers on separate contracts, so keep
		 * them equal by hand.
		 */
		sale: {
			default: {
				price: parseEther('0.00000001'),
				amount: parseEther('10'),
			},
		},
		/**
		 * Phase durations, and how much of a turn one transaction may carry.
		 *
		 * `actionsPerReveal` IS THE CHUNK, and it is here rather than in the
		 * contract because the two things that decide it are a property of the GAME
		 * (how expensive one action is to resolve) and of the CHAIN (what fits in a
		 * transaction there). A turn longer than this arrives in several reveals;
		 * the turn itself is not capped, and capping it is a game rule this
		 * framework deliberately does not take a position on.
		 *
		 * THREE, for chess: an army submits at most one move per cycle, and a
		 * move is up to three piece-moves, each one action
		 * (`docs/adr/0016-an-army-moves-up-to-three-pieces-a-cycle-simultaneously.md`),
		 * so a whole move arrives in one reveal and no submission ever chains: the
		 * game refuses a chained fourth (`OneMovePerCycle`). A deployment is one
		 * action and the whole move of its cycle. A one-action submission is one
		 * chunk at any chunk size, so its commitment hash and its bond are what
		 * they were at a chunk of one.
		 *
		 * `stake` is what one army holds, taken from the account's reserve when
		 * its deployment is committed. `spawnSpacing` (S) is the distance between
		 * spawn points on each axis (9 on every grid, tables included, so two
		 * neighbouring 5-wide armies have exactly 4 empty squares between them,
		 * `docs/adr/0015`), and `openSpawnPoints` (K) how many free spawn
		 * points are open at once, the K nearest the origin in spiral order: few
		 * enough that the world stays dense as it grows.
		 *
		 * The reveal phase is the one to be careful with, and it used to be 3-4
		 * seconds. That is not survivable: a client has to NOTICE the phase turned
		 * over (the chain-synced clock ticks once a second), estimate gas, sign,
		 * broadcast, and then be MINED, all inside the window - and the contract
		 * judges the attempt by the timestamp of the block it lands in, not by when
		 * it was sent. Measured against a local node, a reveal fired the instant the
		 * phase opened still landed about 5 seconds later and reverted with
		 * `InCommitmentPhase`, forfeiting the bond.
		 *
		 * A missed reveal costs the player their stake, so this cannot be tuned
		 * optimistically. Size the reveal phase to comfortably exceed one block time
		 * plus a client round trip; ten seconds is generous on a local chain and is
		 * the floor to think from on a real one.
		 */
		Game: {
			localhost: {
				commitPhaseDuration: 30n,
				revealPhaseDuration: 10n,
				actionsPerReveal: 3n,
				stake: parseEther('10'),
				spawnSpacing: 9n,
				openSpawnPoints: 8n,
				cyclePolicy: CYCLE_POLICY.Timed,
				commitGas: COMMIT_GAS,
				revealGas: REVEAL_GAS,
				expectedActionsPerTurn: EXPECTED_ACTIONS_PER_TURN,
			},
			/**
			 * SEPOLIA: 10 minutes to commit, 5 to reveal. Blocks are about 12
			 * seconds, and fuzd reveals from a once-a-minute cron after waiting
			 * for a drand round, so a scheduled reveal can land a minute or two
			 * into the phase; the browser's own fallback fires at half of it.
			 * Five minutes leaves room for both. The slow-chain alternative
			 * settled on for this game is 23h+1h (a move a day), which suits a
			 * persistent world but not a demo someone watches resolve.
			 */
			11155111: {
				commitPhaseDuration: 600n,
				revealPhaseDuration: 300n,
				actionsPerReveal: 3n,
				stake: parseEther('10'),
				spawnSpacing: 9n,
				openSpawnPoints: 8n,
				cyclePolicy: CYCLE_POLICY.Timed,
				commitGas: COMMIT_GAS,
				revealGas: REVEAL_GAS,
				expectedActionsPerTurn: EXPECTED_ACTIONS_PER_TURN,
			},
			default: {
				commitPhaseDuration: 30n,
				revealPhaseDuration: 10n,
				actionsPerReveal: 3n,
				stake: parseEther('10'),
				spawnSpacing: 9n,
				openSpawnPoints: 8n,
				cyclePolicy: CYCLE_POLICY.Timed,
				commitGas: COMMIT_GAS,
				revealGas: REVEAL_GAS,
				expectedActionsPerTurn: EXPECTED_ACTIONS_PER_TURN,
			},
		},
		/**
		 * GAMES FOR A FIXED SET OF PLAYERS: the lobby implementation every table
		 * is a clone of (`deploy/030_deploy_lobby.ts`), so these are every
		 * table's rules, fixed per deployment (a clone cannot carry its own).
		 *
		 * `TimedWithEarlyAdvance`, because a table has a closed set to be
		 * unanimous about: the reveal phase opens the moment everyone has
		 * committed, the next cycle the moment everyone has revealed, and the
		 * clock is what keeps a table moving when a member vanishes. The phases
		 * are longer than the world's because two people at two screens are
		 * slower than one, and only the absent pay for the length.
		 *
		 * The commit gas is the world's: a table runs the same routes behind a
		 * clone. Its reveal gas is `LOBBY_REVEAL_GAS`, the world's worst plus a
		 * table's listing of the zones it touches (`test/js/GasBudget.test.ts`).
		 * Measured by `test/js/Lobby.test.ts`: the start of a two-member table
		 * about 173,000.
		 */
		Lobby: {
			/**
			 * SEPOLIA: the same reasoning as the world's, shorter because a table
			 * advances early once every member has acted, so the clock only runs
			 * out on the absent. Two minutes still covers fuzd's minute of lag.
			 */
			11155111: {
				commitPhaseDuration: 180n,
				revealPhaseDuration: 120n,
				actionsPerReveal: 3n,
				stake: parseEther('10'),
				spawnSpacing: 9n,
				openSpawnPoints: 8n,
				cyclePolicy: CYCLE_POLICY.TimedWithEarlyAdvance,
				commitGas: COMMIT_GAS,
				revealGas: LOBBY_REVEAL_GAS,
				expectedActionsPerTurn: EXPECTED_ACTIONS_PER_TURN,
			},
			default: {
				commitPhaseDuration: 45n,
				revealPhaseDuration: 15n,
				actionsPerReveal: 3n,
				stake: parseEther('10'),
				// THE WORLD'S GRID (`docs/adr/0015`): four empty squares between
				// two neighbouring armies on both axes.
				spawnSpacing: 9n,
				openSpawnPoints: 8n,
				cyclePolicy: CYCLE_POLICY.TimedWithEarlyAdvance,
				commitGas: COMMIT_GAS,
				revealGas: LOBBY_REVEAL_GAS,
				expectedActionsPerTurn: EXPECTED_ACTIONS_PER_TURN,
			},
		},
	},
	signerProtocols: {
		privateKey,
	},
} as const satisfies UserConfig;

// then we import each extensions we are interested in using in our deploy script or elsewhere

// this one provide a deploy function
import * as deployExtension from '@rocketh/deploy';
// this one provide read,execute functions
import * as readExecuteExtension from '@rocketh/read-execute';
// this one provide a deployViaProxy function that let you declaratively
//  deploy proxy based contracts
import * as deployProxyExtension from '@rocketh/proxy';
// this one provide a deployViaRouter function, used by the Game which is
//  split across several route contracts (see src/game/routes)
import * as deployRouterExtension from '@rocketh/router';
// this one provide a viem handle to clients and contracts
import * as viemExtension from '@rocketh/viem';

// and export them as a unified object
const extensions = {
	...deployExtension,
	...readExecuteExtension,
	...deployProxyExtension,
	...deployRouterExtension,
	...viemExtension,
};
export {extensions};

// then we also export the types that our config exhibit so other can use it

type Extensions = typeof extensions;
type Accounts = typeof config.accounts;
type Data = typeof config.data;
type Environment = EnhancedEnvironment<
	Accounts,
	Data,
	UnknownDeployments,
	Extensions
>;

export type {Extensions, Accounts, Data, Environment};
