import {describe, it} from 'node:test';
import assert from 'node:assert';
import {network} from 'hardhat';
import {zeroAddress} from 'viem';
import {
	setupFixtures,
	fundAccount,
	commitDeployment,
	revealDeployment,
	commitmentChain,
	commitmentHashFor,
	squareAt,
	TURN_BOND,
	type Move,
} from './utils/index.js';
import {describePiece, type Piece} from './utils/moves-world.js';
import {
	profileTransaction,
	formatProfile,
	type Contracts,
	type Profile,
} from './utils/gas-profile.js';
import {loadFunctionIndex} from './utils/gas-functions.js';

/**
 * WHERE THE GAS OF A PLAIN MOVE GOES, transaction by transaction, folded from
 * the node's trace (`utils/gas-profile.ts`). The numbers are written up in
 * `docs/gas.md`; this is what reproduces them:
 *
 *   pnpm hardhat --network test test nodejs test/js/GasProfile.test.ts
 *
 * which prints every profile's buckets. Set `GAS_PROFILE=slots` to also print
 * every storage slot each transaction read or wrote, with what it cost, and
 * add `--build-profile production` (before `--network`) to measure the
 * optimised build a real deployment runs instead of the test build.
 *
 * IT MEASURES, it does not budget: `GasBudget.test.ts` is what holds the
 * declared figures to the worst case. What this asserts is only that every
 * profile adds up to its receipt's `gasUsed` (checked inside
 * `profileTransaction`) and that each move did what it is said to measure.
 *
 * THE SCENE: the first army of the shipped world, deployed on (0,0), alone,
 * one move a cycle and nothing to settle:
 *
 *   y= 2  . P P P .     x = -2 .. 2
 *   y= 1  P R N B P
 *   y= 0  P Q K . P
 *   y=-1  P B N R P
 *   y=-2  . P P P .
 *
 * "Fresh" squares have no record yet (the piece's first move off its
 * deployment, onto a square no reveal touched); "touched" squares, origin and
 * destination both, have a record from an earlier cycle, which the move folds.
 */

const {provider, networkHelpers} = await network.connect();
const {deployAll} = setupFixtures(provider);

const SECRET =
	'0x00000000000000000000000000000000000000000000000000000000000000a1';

const DETAIL = process.env.GAS_PROFILE ?? '';
const SLOTS = DETAIL.includes('slots');
/** How many functions to list, dearest (inclusive) first. */
const FUNCTIONS = DETAIL.includes('functions') ? 40 : 0;

const m = (from: [number, number], to: [number, number]): Move => ({
	from: squareAt(...from),
	to: squareAt(...to),
});

describe('the gas profile of a plain move', function () {
	it('folds every commit and reveal of a deployment and its moves into where the gas goes', async function () {
		const f = await networkHelpers.loadFixture(deployAll);
		const {env, Game, actionsPerReveal} = f;
		const contracts = contractsOf(env);
		const profiles: {title: string; profile: Profile}[] = [];
		async function profile(
			title: string,
			receipt: {transactionHash: `0x${string}`},
		) {
			const p = await profileTransaction(
				provider,
				receipt.transactionHash,
				contracts,
			);
			profiles.push({title, profile: p});
			console.log(
				formatProfile(title, p, {slots: SLOTS, functions: FUNCTIONS}),
			);
			return p;
		}

		const player = f.unnamedAccounts[0] as `0x${string}`;
		const {cycleNumber: start} = f.getCycleNumber(await f.getTimestamp());
		let cycle = start + 2;
		await f.advanceToCycleNumber(cycle, true);
		await fundAccount(f, player);

		const spawnPoint = squareAt(0, 0);
		const {army, receipt: deployCommit} = await commitDeployment(f, {
			owner: player,
			spawnPoint,
			secret: SECRET,
			actionsPerReveal,
		});
		await profile('deployment commit (the first ever)', deployCommit);
		await f.advanceToRevealPhase(cycle, true);
		const deployReveal = await revealDeployment(f, {
			account: player,
			army,
			spawnPoint,
			secret: SECRET,
			actionsPerReveal,
		});
		await profile('deployment reveal (the first ever)', deployReveal);

		/** One move in the next cycle: its commit's receipt and its reveal's. */
		async function play(move: Move) {
			cycle += 1;
			await f.advanceToCycleNumber(cycle, true);
			const commit = await env.execute(Game, {
				account: player,
				functionName: 'makeCommitment',
				args: [
					army,
					commitmentHashFor([move], SECRET, actionsPerReveal),
					TURN_BOND,
					zeroAddress,
				],
			});
			await f.advanceToRevealPhase(cycle, true);
			const {chunks} = commitmentChain([move], SECRET, actionsPerReveal);
			const reveal = await env.execute(Game, {
				account: player,
				functionName: 'reveal',
				args: [
					army,
					chunks[0].moves,
					SECRET,
					chunks[0].furtherActions,
					zeroAddress,
				],
			});
			return {commit, reveal};
		}
		async function pieceAt(x: number, y: number): Promise<string | undefined> {
			const [pieces] = (await env.read(Game, {
				functionName: 'getPieces',
				args: [x, y, x, y],
			})) as [Piece[], bigint];
			return pieces.length === 0
				? undefined
				: describePiece(pieces[0]).replace(/#\d+/, '');
		}
		/** Play `move`, profile its reveal, and check it landed. */
		async function measure(
			title: string,
			move: Move,
			landed: string,
			to: [number, number],
		) {
			const {commit, reveal} = await play(move);
			const p = await profile(title, reveal);
			await f.advanceToCycleNumber(cycle + 1, true);
			assert.strictEqual(
				await pieceAt(...to),
				landed,
				`${title}: the move did not land`,
			);
			return {commit, reveal: p};
		}

		// A PAWN, fresh: its first step, onto a square nobody touched.
		const first = await measure(
			'pawn step, fresh squares',
			m([0, 2], [0, 3]),
			'P@0,3',
			[0, 3],
		);
		await profile(
			'plain move commit (the army first commit after its deployment)',
			first.commit,
		);
		// The knight touches (0,4) and leaves it, so the pawn's next step is
		// from a touched square onto a touched square.
		await play(m([0, 1], [1, 3]));
		await play(m([1, 3], [2, 5]));
		await play(m([2, 5], [0, 4]));
		await play(m([0, 4], [1, 6]));
		await measure(
			'pawn step, touched squares',
			m([0, 3], [0, 4]),
			'P@0,4',
			[0, 4],
		);

		// A BISHOP, 7 squares up the open diagonal past the empty corner, and
		// back: fresh, then touched (its path is only read, never touched).
		await measure(
			'7-square slider, fresh squares',
			m([1, 1], [8, 8]),
			'B@8,8',
			[8, 8],
		);
		await measure(
			'7-square slider, touched squares',
			m([8, 8], [1, 1]),
			'B@1,1',
			[1, 1],
		);

		// THE KING, into its empty core square and back.
		await measure(
			'king step, fresh squares',
			m([0, 0], [1, 0]),
			'K@1,0',
			[1, 0],
		);
		const last = await measure(
			'king step, touched squares',
			m([1, 0], [0, 0]),
			'K@0,0',
			[0, 0],
		);
		await profile('plain move commit (a later cycle)', last.commit);

		// Every profile accounts for its whole receipt (asserted inside), and
		// the reveals of a plain move are what this suite is about.
		assert.strictEqual(profiles.length, 10);
		for (const {title, profile} of profiles) {
			assert.ok(profile.execution > 0, `${title}: no execution traced`);
		}
	});
});

/**
 * The contracts a trace runs through, named from the deployments: the proxy
 * and its router only dispatch; every route is the game's own code.
 */
function contractsOf(env: {
	deployments: Record<string, {address: string}>;
}): Contracts {
	const names = new Map<string, string>();
	const artifactOf = new Map<string, string>();
	const dispatch = new Set<string>();
	const game = new Set<string>();
	for (const [name, d] of Object.entries(env.deployments)) {
		const address = d.address.toLowerCase();
		const route = /_Router_(\w+)_Route$/.exec(name);
		names.set(
			address,
			route
				? `${name.startsWith('GameLobby') ? 'Lobby' : 'Game'}.${route[1]}`
				: name,
		);
		if (name === 'Game' || name === 'Game_Implementation')
			dispatch.add(address);
		if (route) {
			game.add(address);
			artifactOf.set(address, `Game${route[1]}`);
		}
	}
	const functions = FUNCTIONS
		? loadFunctionIndex([...new Set(artifactOf.values())])
		: undefined;
	return {names, dispatch, game, artifacts: artifactOf, functions};
}
