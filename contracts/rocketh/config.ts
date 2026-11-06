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
 * MEASURED FOR CHESS (`chess-army-deployment`), on a local node. A submission
 * here is ONE action, so a reveal is one transaction, and today there are two
 * kinds: a deployment and a pass. The worst commit is a DEPLOYMENT's, which
 * creates the army (its registry entry), moves the stake from the account's
 * reserve into the army's, starts waiting for it and only then commits; the
 * worst reveal is a deployment's too, the first of its cycle, which writes the
 * open set of spawn points as well as the spawn point's record.
 *
 *   deployment commit (cold slots)           291,708
 *   deployment commit paying a fresh payee   326,148
 *   the first deployment reveal ever         230,649
 *
 * RE-MEASURED FOR DEPLOYMENT COLLISIONS (`chess-deployment-collisions`). A
 * deployment commit now settles the account's previous deployment first (the
 * refund of a failed one), and under a cycle that advances (the offline world,
 * which budgets with these same figures) it also remembers the new army for
 * the sweep of dead armies, a fresh array slot on the world's first one. A
 * deployment reveal now checks that its footprint is clear.
 *
 *   deployment commit (cold slots, timed)              300,102
 *   deployment commit paying a fresh payee (timed)     334,542
 *   first paid deployment commit, manual world         372,267
 *   the first deployment reveal ever                   347,288
 *   a king's move (the worst reveal)                   408,521
 *
 * So COMMIT_GAS is the manual world's paid case plus 15%. REVEAL_GAS is left at the
 * template's 600,000, 2.6 times the deployment's reveal: inside the band
 * `GasBudget.test.ts` allows, and room for the moves that come next rather
 * than a figure that has to be raised the day they land.
 *
 * The template's figures (a placement game, whose worst reveal was a chunk of
 * four fresh cells at 535,561) went with the template's game. The reveal's
 * figure WILL grow with moves (`chess-moves`): a move's worst case, a slider's
 * path over squares idle for many cycles, has to be measured then, because a
 * reveal that runs out of gas is a missed reveal, which freezes the army.
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
 *
 * The reveal's worst case is a move whose two resolved pieces (the mover and
 * its destination) each sit behind the longest chain of merges a read follows
 * (`MAX_CHAIN` in `UsingGameBoard.sol`, `chess-king-capture-merge`): about
 * 690,000, priced per merge in `GasBudget.test.ts`. Dearer still is a slider
 * whose own army is that far behind taking the king of a capture loop of
 * `MAX_CHAIN` armies (`chess-capture-loops`), which reads the whole loop and
 * folds it, writing every army of it: about 1,040,000, priced per army there.
 * Exits (`chess-exits-redeem`, `docs/adr/0011-...-leaves-rocks.md`) add what
 * the two touched squares' folds write (a captured reserve moved up into its
 * captor's, an exit kept) and an "exited?" read per occupied square: about
 * 1,220,000 in all, which is what raised this from 1,200,000 (and the
 * generosity ceiling of `GasBudget.test.ts`, three times the plainest reveal,
 * is what keeps it from going higher).
 */
const COMMIT_GAS = 430_000n;
const REVEAL_GAS = 1_345_000n;
/**
 * A TABLE'S REVEAL: the world's, plus listing every zone a reveal touches first
 * (`UsingGameTable._tally` counts the material at the cap from that list).
 * About 67,000 at worst (two zones, a slot each), so a table's worst reveal is
 * about 1,265,000 and this keeps 10% over it; priced in `GasBudget.test.ts`.
 */
const LOBBY_REVEAL_GAS = 1_400_000n;

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
 * ONE, IN CHESS, BECAUSE IT IS THE RULE: an army submits at most one move per
 * cycle (`CONTEXT.md`), and a deployment is one action too. So the expected
 * turn is exactly one commit and one reveal.
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
				// how a credit ends up priced against a game nobody runs.
				creditsGasMultiplier: COMMIT_GAS + REVEAL_GAS,
				supportsSendRawTransactionSync: false,
			},
			tags: ['local', 'memory', 'testnet'],
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
		 * ONE, for chess: an army submits at most one move per cycle, and a
		 * deployment is one action too, so no submission ever chains.
		 *
		 * `stake` is what one army holds, taken from the account's reserve when
		 * its deployment is committed. `spawnSpacing` (S) is the distance between
		 * spawn points on each axis, and `openSpawnPoints` (K) how many free spawn
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
				actionsPerReveal: 1n,
				stake: parseEther('10'),
				spawnSpacing: 16n,
				openSpawnPoints: 8n,
				cyclePolicy: CYCLE_POLICY.Timed,
				commitGas: COMMIT_GAS,
				revealGas: REVEAL_GAS,
				expectedActionsPerTurn: EXPECTED_ACTIONS_PER_TURN,
			},
			default: {
				commitPhaseDuration: 30n,
				revealPhaseDuration: 10n,
				actionsPerReveal: 1n,
				stake: parseEther('10'),
				spawnSpacing: 16n,
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
			default: {
				commitPhaseDuration: 45n,
				revealPhaseDuration: 15n,
				actionsPerReveal: 1n,
				stake: parseEther('10'),
				// A TIGHTER GRID than the world's, so a table's armies meet
				// quickly: a gap of four squares between two footprints.
				spawnSpacing: 10n,
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
