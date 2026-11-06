import {Abi_GameToken} from '../../../generated/abis/GameToken.js';
import {Abi_IGame} from '../../../generated/abis/IGame.js';
import {Abi_StakeSale} from '../../../generated/abis/StakeSale.js';
import {
	artifacts,
	loadAndExecuteDeploymentsFromFiles,
} from '../../../rocketh/environment.js';
import {EthereumProvider} from 'hardhat/types/providers';
import {
	encodeAbiParameters,
	encodeFunctionData,
	keccak256,
	parseEther,
	zeroAddress,
} from 'viem';

/**
 * The rocketh environment these helpers act through.
 *
 * NAMED rather than left as `any`, and it is the difference between a helper
 * that type-checks and one that only runs: `deployGameWith` passes an explicit
 * `<Abi_IGame>` to `deployViaProxy`, and a type argument on an UNTYPED call is
 * an error (TS2347) rather than a hint. The suites run through tsx, which does
 * not type-check, so `pnpm --filter ./contracts typescript` was the only thing
 * that could see it - and nothing ran that until `dist` became a build input
 * for the web workspace.
 */
type DeploymentEnvironment = Awaited<
	ReturnType<typeof loadAndExecuteDeploymentsFromFiles>
>;

/**
 * One move, matching the contract's `Move` struct. A deployment is one too:
 * from and to the spawn point.
 */
export type Move = {from: bigint; to: bigint};

/** Pack a square the way `PositionUtils` does: y in the high 32 bits. */
export function squareAt(x: number, y: number): bigint {
	const ux = BigInt.asUintN(32, BigInt(x));
	const uy = BigInt.asUintN(32, BigInt(y));
	return (uy << 32n) + ux;
}

/** The inverse of {@link squareAt}. */
export function xyOf(square: bigint): {x: number; y: number} {
	return {
		x: Number(BigInt.asIntN(32, square & 0xffffffffn)),
		y: Number(BigInt.asIntN(32, square >> 32n)),
	};
}

/** The submission that deploys an army at `spawnPoint`. */
export function deploymentAt(spawnPoint: bigint): Move[] {
	return [{from: spawnPoint, to: spawnPoint}];
}

/**
 * THE CHUNK a game deployed by {@link deployGameWith} accepts.
 *
 * A suite that deploys its own game picks this rather than reading it back, so
 * it is named once here. A suite playing the SHIPPED deployment reads
 * `actionsPerReveal` off its record instead - see `setupFixtures` - because that
 * one is whatever the deploy config says and must not be assumed.
 *
 * THREE, the shipped chunk (`rocketh/config.ts`): a move is up to three
 * piece-moves (`docs/adr/0016`) and arrives in one reveal, so a harness that
 * chunked smaller would have every multi-piece reveal refused for the wrong
 * reason.
 */
export const DEFAULT_ACTIONS_PER_REVEAL = 3n;

/** What one army holds, in a game deployed by {@link deployGameWith}. */
export const DEFAULT_STAKE = parseEther('10');

/** `bytes24(0)`: what a chunk carries when there is nothing after it. */
export const NO_FURTHER_ACTIONS =
	'0x000000000000000000000000000000000000000000000000' as const;

/** One reveal transaction's worth of a turn, and what it promises after it. */
export type Chunk = {
	moves: Move[];
	furtherActions: `0x${string}`;
};

/**
 * THE HASH CHAIN, built the way a client has to build it.
 *
 * A commitment is the head of a chain: each reveal opens one chunk and rewrites
 * the head to the hash of the next, so the hashes are computed from the LAST
 * chunk BACKWARDS - the head cannot be known until everything after it is.
 *
 * It is written out here rather than asked of the contract, for the same reason
 * {@link cycleClock} is: a test that computed the hash by calling the thing it
 * is testing would assert nothing. The encoding must match
 * `UsingGameInternal._digest` exactly, and note that it is ONE encoding for
 * every chunk including the last, where `furtherActions` is zero and is hashed
 * in anyway.
 *
 * ONE COPY, SHARED BY EVERY SUITE HERE, deliberately. A mismatch between two
 * spellings of this is not a compile error and not a failed read: the commit
 * succeeds and the reveal reverts once the stake is bonded, so a second copy
 * would be a second chance at the one mistake that costs a player money.
 */
export function commitmentChain(
	moves: readonly Move[],
	secret: `0x${string}`,
	actionsPerReveal: number,
): {head: `0x${string}`; chunks: Chunk[]} {
	if (actionsPerReveal < 1) {
		throw new Error('a chunk of zero actions can never be revealed');
	}

	const split: Move[][] = [];
	for (let i = 0; i < moves.length; i += actionsPerReveal) {
		split.push(moves.slice(i, i + actionsPerReveal));
	}
	// An empty turn is still ONE chunk: it is committed, it is revealed, and it
	// resolves to nothing. Without this it would have no head at all.
	if (split.length === 0) split.push([]);

	const chunks: Chunk[] = [];
	let next: `0x${string}` = NO_FURTHER_ACTIONS;
	for (let i = split.length - 1; i >= 0; i--) {
		chunks.unshift({moves: split[i], furtherActions: next});
		next = hashChunk(split[i], secret, next);
	}

	return {head: next, chunks};
}

/** `bytes24(keccak256(abi.encode(secret, moves, furtherActions)))`. */
function hashChunk(
	moves: readonly Move[],
	secret: `0x${string}`,
	furtherActions: `0x${string}`,
): `0x${string}` {
	const encoded = encodeAbiParameters(
		[
			{type: 'bytes32'},
			{
				type: 'tuple[]',
				components: [
					{name: 'from', type: 'uint64'},
					{name: 'to', type: 'uint64'},
				],
			},
			{type: 'bytes24'},
		],
		[secret, moves as Move[], furtherActions],
	);
	return keccak256(encoded).slice(0, 50) as `0x${string}`;
}

/**
 * The commitment hash for a whole turn, at a given chunk size.
 *
 * What a `makeCommitment` call takes: the head of the chain, not the hash of
 * the turn.
 */
export function commitmentHashFor(
	moves: readonly Move[],
	secret: `0x${string}`,
	actionsPerReveal: number,
): `0x${string}` {
	return commitmentChain(moves, secret, actionsPerReveal).head;
}

/**
 * Reveal a whole turn, however many transactions that takes.
 *
 * A TEST THAT REVEALS BY HAND IS A TEST ABOUT THE CHAIN; every other test wants
 * "this player took this turn", so it says that. The transactions go in ORDER
 * and one at a time, which is not an optimisation to undo later: each one
 * rewrites the head the next is checked against.
 */
export async function revealTurn(
	fixtures: {env: any; Game: any},
	options: {
		account: `0x${string}`;
		identity: bigint;
		moves: readonly Move[];
		secret: `0x${string}`;
		actionsPerReveal: number;
		/** A deployment is revealed through its own entry point. */
		deployment?: boolean;
	},
): Promise<{gasUsed: bigint | string} | undefined> {
	const {env, Game} = fixtures;
	const {chunks} = commitmentChain(
		options.moves,
		options.secret,
		options.actionsPerReveal,
	);
	// The receipt of the last chunk, for a suite that measures it.
	let receipt: {gasUsed: bigint | string} | undefined;
	for (const chunk of chunks) {
		receipt = await env.execute(Game, {
			account: options.account,
			functionName: options.deployment ? 'revealDeployment' : 'reveal',
			args: [
				options.identity,
				chunk.moves,
				options.secret,
				chunk.furtherActions,
				zeroAddress,
			],
		});
	}
	return receipt;
}

/**
 * How the cycle advances. The contract's enum, by value.
 *
 * Mirrors `rocketh/config.ts`'s copy rather than importing it, because that one
 * is bigints for the deploy and these are the numbers a test asserts against.
 * Both mirror `UsingGameTypes.CyclePolicy`, whose ORDER is the only thing that
 * decides what a number means.
 */
export const CYCLE_POLICY = {
	Timed: 0,
	Manual: 1,
	TimedWithEarlyAdvance: 2,
} as const;

export type CyclePolicy = (typeof CYCLE_POLICY)[keyof typeof CYCLE_POLICY];

/**
 * The cycle arithmetic, in the client's terms, for a game whose anchor has not
 * moved.
 *
 * It exists twice on purpose: the contract computes it and so does this, so a
 * test that agreed with the contract by asking it would be asserting nothing.
 */
export function cycleClock(config: {
	startTime: number;
	commitPhaseDuration: number;
	revealPhaseDuration: number;
}) {
	const cycleDuration = config.commitPhaseDuration + config.revealPhaseDuration;
	return {
		cycleDuration,
		getCycleNumber(time: number): {cycleNumber: number; commiting: boolean} {
			if (time < config.startTime) {
				throw new Error('Game not started');
			}
			const timePassed = time - config.startTime;
			const cycleNumber = Math.floor(timePassed / cycleDuration) + 2;
			return {
				cycleNumber,
				commiting:
					timePassed - (cycleNumber - 2) * cycleDuration <
					config.commitPhaseDuration,
			};
		},
		cycleStartTime(cycleNumber: number): number {
			return config.startTime + (cycleNumber - 2) * cycleDuration;
		},
		revealStartTime(cycleNumber: number): number {
			return (
				config.startTime +
				(cycleNumber - 2) * cycleDuration +
				config.commitPhaseDuration
			);
		},
	};
}

/**
 * A SECOND GAME, ON A DIFFERENT CYCLE POLICY, beside the deployed one.
 *
 * The deployment this repo ships is timed, because that is what a real game
 * wants; the other two policies still have to be played, and the cheapest
 * honest way to play one is to deploy it. Everything else - entering,
 * committing, revealing, the board - is the same code and the same suites,
 * which is the point being asserted: the policy is a policy and not a mode.
 *
 * EVERY DEPLOYMENT GETS A NAME OF ITS OWN, and that is not tidiness. The
 * fixture is memoised by `loadFixture`, so every test shares ONE environment
 * while the chain underneath it is rolled back between them: a repeated name
 * would find a record of a proxy that no longer exists on chain and try to
 * upgrade it, which fails in a way that says nothing about the test.
 */
let deploymentSequence = 0;

export async function deployGameWith(
	fixtures: {env: DeploymentEnvironment; GameToken: any},
	options: {
		name: string;
		cyclePolicy: CyclePolicy;
		commitPhaseDuration: bigint;
		revealPhaseDuration: bigint;
		startTime?: bigint;
		/** THE CHUNK. Deliberately overridable: see `deployedActionsPerReveal`. */
		actionsPerReveal?: bigint;
		/**
		 * The spawn grid's spacing (9 by default, the world's). A suite about
		 * moves deploys at 6, the tightest grid, so armies meet in a cycle.
		 */
		spawnSpacing?: bigint;
		/** How many spawn points are open at once (8 by default, the world's). */
		openSpawnPoints?: bigint;
	},
) {
	const {env} = fixtures;
	const config = {
		startTime: options.startTime ?? 0n,
		commitPhaseDuration: options.commitPhaseDuration,
		revealPhaseDuration: options.revealPhaseDuration,
		time: zeroAddress,
		// WHAT THE GAME IS MADE OF COMES OUT OF THE FIXTURES, not out of the
		// caller's hand. A suite about the cycle should not have to know what
		// this game puts at stake, because that is the thing each branch of
		// this repo changes - and a caller that spelled it out would be the
		// line every branch has to rewrite.
		tokens: fixtures.GameToken.address,
		stake: DEFAULT_STAKE,
		spawnSpacing: options.spawnSpacing ?? 9n,
		openSpawnPoints: options.openSpawnPoints ?? 8n,
		actionsPerReveal: options.actionsPerReveal ?? DEFAULT_ACTIONS_PER_REVEAL,
		cyclePolicy: BigInt(options.cyclePolicy),
	};

	const routes = [
		{name: 'Getters', artifact: artifacts.GameGetters, args: [config]},
		{name: 'Registry', artifact: artifacts.GameRegistry, args: [config]},
		{name: 'Commit', artifact: artifacts.GameCommit, args: [config]},
		// Buying in (`addToReserve`), and a table's seats and payout: its own
		// route because a table's seat creates an army, which no longer fits
		// beside the commitments under the deployed-size limit.
		{name: 'Table', artifact: artifacts.GameTable, args: [config]},
		{name: 'Reveal', artifact: artifacts.GameReveal, args: [config]},
		{
			name: 'DeploymentReveal',
			artifact: artifacts.GameDeploymentReveal,
			args: [config],
		},
		{name: 'Exit', artifact: artifacts.GameExit, args: [config]},
		{name: 'Simulation', artifact: artifacts.GameSimulation, args: [config]},
		{name: 'Delegation', artifact: artifacts.GameDelegation, args: []},
	];

	deploymentSequence++;
	return await env.deployViaProxy<Abi_IGame>(
		`${options.name}_${deploymentSequence}`,
		{
			account: env.namedAccounts.deployer,
			artifact: (name: string, params: any) =>
				env.deployViaRouter<Abi_IGame>(name, params, routes, {
					// As the deploy scripts: the router that routes past 48
					// selectors (src/vendor/router/Router10X60.sol).
					routerContract: {type: 'custom', artifact: artifacts.Router10X60},
				}),
			args: [config],
		},
		{owner: env.namedAccounts.admin, linkedData: config},
	);
}

/**
 * The id an ACCOUNT's reserve is kept under: its address, widened.
 *
 * Accounts hold stake not yet deployed (`addToReserve` credits one), and are
 * never members: at a table too the seat is an army. Deliberately not applied to `GameToken.mint`
 * or `approve`: those really do take an address.
 */
export function idOf(account: `0x${string}`): bigint {
	return BigInt(account);
}

/**
 * The id of `owner`'s `nonce`th army (`nonce << 160 | owner`), which is who
 * plays: every army id is above any address-derived one.
 */
export function armyIdOf(owner: `0x${string}`, nonce: number): bigint {
	return (BigInt(nonce) << 160n) | BigInt(owner);
}

/**
 * WHAT A PASS BONDS: nothing. An army's stake is its reserve and the freeze is
 * what a missed reveal costs it, so a submission after the deployment bonds
 * nothing. A suite about the ROUND names this rather than a number.
 */
export const TURN_BOND = 0n;

/**
 * MINT `amount` OF THE GAME TOKEN TO `to`, THE TEST-ONLY WAY: as the token's
 * one minter (`StakeSale`), impersonated on the test node. There is no public
 * mint (`docs/adr/0006-stake-erc20-reserve-exit-only.md`), and buying through
 * the sale comes in whole stakes only, while suites need odd amounts. Tokens
 * minted this way are NOT backed by ETH in the sale, so a suite about
 * `redeem` buys through the sale instead.
 */
export async function mintTokens(
	fixtures: {env: any; GameToken: any},
	to: `0x${string}`,
	amount: bigint,
): Promise<void> {
	const {env, GameToken} = fixtures;
	const provider = env.network.provider;
	const minter = (await env.read(GameToken, {
		functionName: 'minter',
	})) as `0x${string}`;
	await provider.request({
		method: 'hardhat_impersonateAccount',
		params: [minter],
	});
	// Gas for the impersonated sale, given and then taken back, so the ETH
	// the sale holds (what backs `redeem`) is exactly what purchases paid.
	const balance = (await provider.request({
		method: 'eth_getBalance',
		params: [minter, 'latest'],
	})) as string;
	await provider.request({
		method: 'hardhat_setBalance',
		params: [minter, `0x${(BigInt(balance) + parseEther('1')).toString(16)}`],
	});
	const hash = await provider.request({
		method: 'eth_sendTransaction',
		params: [
			{
				from: minter,
				to: GameToken.address,
				data: encodeFunctionData({
					abi: GameToken.abi,
					functionName: 'mint',
					args: [to, amount],
				}),
			},
		],
	});
	await provider.request({
		method: 'hardhat_stopImpersonatingAccount',
		params: [minter],
	});
	await provider.request({
		method: 'hardhat_setBalance',
		params: [minter, balance],
	});
	const receipt = (await provider.request({
		method: 'eth_getTransactionReceipt',
		params: [hash],
	})) as {status: string} | null;
	if (receipt?.status !== '0x1') throw new Error('test mint failed');
}

/**
 * PUT STAKE IN AN ACCOUNT'S RESERVE, paid by `payer` (the account itself by
 * default). Stake bought, not yet deployed: it makes nobody a member. At a
 * table the same call buys a seat, which is a new army (`utils/table-world.ts`).
 */
export async function fundAccount(
	fixtures: {env: any; Game: any; GameToken: any},
	account: `0x${string}`,
	options?: {amount?: bigint; payer?: `0x${string}`},
): Promise<bigint> {
	const {env, Game, GameToken} = fixtures;
	const amount = options?.amount ?? DEFAULT_STAKE;
	const payer = options?.payer ?? account;

	await mintTokens({env, GameToken}, payer, amount);
	await env.execute(GameToken, {
		account: payer,
		functionName: 'approve',
		args: [Game.address, amount],
	});
	await env.execute(Game, {
		account: payer,
		functionName: 'addToReserve',
		args: [idOf(account), amount],
	});

	return idOf(account);
}

/**
 * COMMIT A DEPLOYMENT, which creates the army: the owner's next army id, its
 * stake moved out of the owner's reserve, waited for from this cycle. Sent by
 * `sender` (the owner by default; a delegate of the owner works too). Returns
 * the army.
 */
export async function commitDeployment(
	fixtures: {env: any; Game: any},
	options: {
		owner: `0x${string}`;
		sender?: `0x${string}`;
		spawnPoint: bigint;
		secret: `0x${string}`;
		actionsPerReveal: number;
		bond?: bigint;
		payee?: `0x${string}`;
		value?: bigint;
	},
): Promise<{army: bigint; receipt: any}> {
	const {env, Game} = fixtures;
	const army = (await env.read(Game, {
		functionName: 'getNextArmy',
		args: [options.owner],
	})) as bigint;
	const receipt = await env.execute(Game, {
		account: options.sender ?? options.owner,
		functionName: 'makeCommitment',
		args: [
			army,
			commitmentHashFor(
				deploymentAt(options.spawnPoint),
				options.secret,
				options.actionsPerReveal,
			),
			options.bond ?? DEFAULT_STAKE,
			options.payee ?? zeroAddress,
		],
		...(options.value ? {value: options.value} : {}),
	});
	return {army, receipt};
}

/** Reveal an army's deployment at `spawnPoint`. */
export async function revealDeployment(
	fixtures: {env: any; Game: any},
	options: {
		account: `0x${string}`;
		army: bigint;
		spawnPoint: bigint;
		secret: `0x${string}`;
		actionsPerReveal: number;
	},
): Promise<any> {
	const {env, Game} = fixtures;
	const {chunks} = commitmentChain(
		deploymentAt(options.spawnPoint),
		options.secret,
		options.actionsPerReveal,
	);
	return env.execute(Game, {
		account: options.account,
		// `reveal`, as a client sends it: forwarded to `revealDeployment`.
		functionName: 'reveal',
		args: [
			options.army,
			chunks[0].moves,
			options.secret,
			chunks[0].furtherActions,
			zeroAddress,
		],
	});
}

export function setupFixtures(provider: EthereumProvider) {
	return {
		async deployAll() {
			const env = await loadAndExecuteDeploymentsFromFiles({
				provider: provider,
			});

			const Game = env.get<Abi_IGame>('Game');
			const GameToken = env.get<Abi_GameToken>('GameToken');
			const StakeSale = env.get<Abi_StakeSale>('StakeSale');

			const linkedData = Game.linkedData as {
				startTime: string;
				commitPhaseDuration: string;
				revealPhaseDuration: string;
				time: `0x${string}`;
				stake: string;
				spawnSpacing: string;
				openSpawnPoints: string;
				actionsPerReveal: string;
				// NOT members of the on-chain `Config`: the contract never reads a
				// gas figure. They are recorded on the deployment because they are
				// measured against THESE contracts and the client that budgets with
				// them is inherited from a template that does not run them. See
				// `GasBudget.test.ts`.
				commitGas: string;
				revealGas: string;
			};

			let _timeOverride: {timestamp: number; whenMs: number} | undefined;

			async function advanceToTime(time: number, mine?: boolean) {
				await provider.request({
					method: 'evm_setNextBlockTimestamp',
					params: [time],
				});
				_timeOverride = {timestamp: time, whenMs: Date.now()};
				if (mine) {
					await provider.request({method: 'evm_mine'});
				}
			}

			async function getTimestamp(): Promise<number> {
				if (_timeOverride) {
					const block = await provider.request({
						method: 'eth_getBlockByNumber',
						params: ['latest', false],
					});
					const blockTimestamp: number = (block as any).timestamp;
					if (blockTimestamp > _timeOverride.timestamp) {
						_timeOverride = undefined;
						return blockTimestamp;
					}
					return (
						_timeOverride.timestamp +
						Math.floor((Date.now() - _timeOverride.whenMs) / 1000)
					);
				}
				return Math.floor(Date.now() / 1000);
			}

			function getCycleNumber(time: number): {
				cycleNumber: number;
				commiting: boolean;
			} {
				const cycleDuration =
					Number(linkedData.commitPhaseDuration) +
					Number(linkedData.revealPhaseDuration);
				const startTime = Number(linkedData.startTime);
				if (time < startTime) {
					throw new Error('Game not started');
				}
				const timePassed = time - startTime;
				const cycleNumber = Math.floor(timePassed / cycleDuration + 2);
				const commiting =
					timePassed - (cycleNumber - 2) * cycleDuration <
					Number(linkedData.commitPhaseDuration);

				return {cycleNumber, commiting};
			}

			function getCycleStartTime(cycleNumber: number): number {
				const cycleDuration =
					Number(linkedData.commitPhaseDuration) +
					Number(linkedData.revealPhaseDuration);
				return Number(linkedData.startTime) + (cycleNumber - 2) * cycleDuration;
			}

			async function advanceToCycleNumber(cycleNumber: number, mine?: boolean) {
				await advanceToTime(getCycleStartTime(cycleNumber), mine);
			}

			async function advanceToRevealPhase(cycleNumber: number, mine?: boolean) {
				await advanceToTime(
					getCycleStartTime(cycleNumber) +
						Number(linkedData.commitPhaseDuration),
					mine,
				);
			}

			return {
				env,
				Game,
				GameToken,
				StakeSale,
				linkedData,
				/**
				 * THE CHUNK THE DEPLOYED GAME WILL ACCEPT, read off its own record.
				 *
				 * Never a literal in a suite. It is a deployment parameter, so a
				 * test that spelled the number out would go on passing while the
				 * deployment said something else - which is the exact failure the
				 * parameter exists to make impossible for the client.
				 */
				actionsPerReveal: Number(linkedData.actionsPerReveal),
				/** What one army holds, read off the deployment's record. */
				stake: BigInt(linkedData.stake),
				getCycleNumber,
				getTimestamp,
				// Exposed because a game deployed INSIDE a test has a schedule of
				// its own: the two helpers above answer for the deployment's
				// durations, and a cycle policy suite is the one thing that
				// deploys a game with different ones.
				advanceToTime,
				advanceToRevealPhase,
				advanceToCycleNumber,
				namedAccounts: env.namedAccounts,
				unnamedAccounts: env.unnamedAccounts,
			};
		},
	};
}
