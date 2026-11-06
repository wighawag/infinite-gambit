import {expect} from 'earl';
import {describe, it} from 'node:test'; // using node:test as hardhat v3 do not support vitest
import {network} from 'hardhat';
import {
	setupFixtures,
	deployGameWith,
	cycleClock,
	fundAccount,
	commitDeployment,
	revealDeployment,
	commitmentHashFor,
	commitmentChain,
	deploymentAt,
	revealTurn,
	idOf,
	squareAt,
	xyOf,
	CYCLE_POLICY,
	DEFAULT_STAKE,
	TURN_BOND,
	type CyclePolicy,
	type Move,
} from './utils/index.js';
import {zeroAddress} from 'viem';

/**
 * DEPLOYMENTS THAT CANNOT BE PLACED, and deployments that are never revealed
 * (stories 4, 5, 6). A deployment FAILS, and is refunded to its owner's
 * ACCOUNT reserve, when another deployment reveals the same spawn point in its
 * cycle, or when its footprint is not clear: a piece stands on it at the start
 * of the cycle, or arrives on it during the cycle. Both are decided from
 * order-free facts (`docs/adr/0002-order-free-lazy-resolution.md`). Cancelling
 * a deployment in its commit phase is free. A deployment never revealed has its
 * stake BURNED (`docs/adr/0005-missed-reveal-freezes-the-army.md`). And under a
 * cycle that advances, a dead army stops being waited for.
 *
 * The game is deployed on the tightest spawn grid (spacing 6), as in
 * `Moves.test.ts`: alice's army on (0,0) reaches x = 2, and the footprint of
 * the spawn point (6,0) starts at x = 4. A FOOTPRINT is the 21 squares of the
 * 5 by 5 square without its corners, the empty core square beside the king
 * included: (1,-6) for the spawn point (0,-6), which alice's rook (1,-1)
 * reaches down column 1 once her pawn (1,-2) has stepped aside.
 */

const {provider, networkHelpers} = await network.connect();
const {deployAll} = setupFixtures(provider);

const COMMIT_PHASE = 60n;
const REVEAL_PHASE = 30n;
const clock = cycleClock({
	startTime: 0,
	commitPhaseDuration: Number(COMMIT_PHASE),
	revealPhaseDuration: Number(REVEAL_PHASE),
});

const SECRET_A =
	'0x0000000000000000000000000000000000000000000000000000000000000a11';
const SECRET_B =
	'0x0000000000000000000000000000000000000000000000000000000000000b22';

const STATUS = {
	None: 0,
	Deploying: 1,
	Deployed: 2,
	Failed: 3,
	Unrevealed: 4,
	Cancelled: 5,
} as const;

const PASS: Move[] = [];
const at = (x: number, y: number) => squareAt(x, y);
const spawn = (i: number, j: number) => at(i * 6, j * 6);

type ArmyView = {
	id: bigint;
	owner: string;
	status: number;
	deployedIn: bigint;
	spawnPoint: bigint;
	king: bigint;
	stake: bigint;
};

async function deployTimed() {
	const f = await deployAll();
	const Game = await deployGameWith(f, {
		name: 'Game_collisions',
		cyclePolicy: CYCLE_POLICY.Timed,
		commitPhaseDuration: COMMIT_PHASE,
		revealPhaseDuration: REVEAL_PHASE,
		spawnSpacing: 6n,
	});
	return {...f, Game};
}

async function deployManual() {
	const f = await deployAll();
	const Game = await deployGameWith(f, {
		name: 'Game_collisions_manual',
		cyclePolicy: CYCLE_POLICY.Manual,
		commitPhaseDuration: 0n,
		revealPhaseDuration: 0n,
		spawnSpacing: 6n,
	});
	return {...f, Game};
}

/** The game on `policy`, at the top of a commit phase, with helpers. */
async function world(policy: CyclePolicy = CYCLE_POLICY.Timed) {
	const manual = policy === CYCLE_POLICY.Manual;
	const f = await networkHelpers.loadFixture(
		manual ? deployManual : deployTimed,
	);
	let cycle = clock.getCycleNumber(await f.getTimestamp()).cycleNumber + 1;
	if (!manual) await f.advanceToTime(clock.cycleStartTime(cycle), true);
	const [alice, bob, carol, dave] = f.unnamedAccounts as `0x${string}`[];
	const actionsPerReveal = 1;
	const read = <T>(functionName: string, args: unknown[] = []) =>
		f.env.read(f.Game, {functionName, args}) as Promise<T>;

	const w = {
		...f,
		alice,
		bob,
		carol,
		dave,
		async advance() {
			await f.env.execute(f.Game, {
				account: carol,
				functionName: 'advanceCycle',
				args: [],
			});
		},
		async toRevealPhase() {
			if (manual) return w.advance();
			await f.advanceToTime(clock.revealStartTime(cycle), true);
		},
		async toNextCycle() {
			if (manual) return w.advance();
			cycle += 1;
			await f.advanceToTime(clock.cycleStartTime(cycle), true);
		},
		/** Fund `owner` (unless told not to) and commit a deployment. */
		async commitDeployment(
			owner: `0x${string}`,
			[i, j]: [number, number],
			secret: `0x${string}` = SECRET_A,
			fund = true,
		): Promise<bigint> {
			if (fund) await fundAccount(f, owner);
			const {army} = await commitDeployment(f, {
				owner,
				spawnPoint: spawn(i, j),
				secret,
				actionsPerReveal,
			});
			return army;
		},
		revealDeployment(
			owner: `0x${string}`,
			army: bigint,
			[i, j]: [number, number],
			secret: `0x${string}` = SECRET_A,
		) {
			return revealDeployment(f, {
				account: owner,
				army,
				spawnPoint: spawn(i, j),
				secret,
				actionsPerReveal,
			});
		},
		commit(
			owner: `0x${string}`,
			army: bigint,
			moves: readonly Move[],
			secret: `0x${string}` = SECRET_A,
		) {
			return f.env.execute(f.Game, {
				account: owner,
				functionName: 'makeCommitment',
				args: [
					army,
					commitmentHashFor(moves, secret, actionsPerReveal),
					TURN_BOND,
					zeroAddress,
				],
			});
		},
		reveal(
			owner: `0x${string}`,
			army: bigint,
			moves: readonly Move[],
			secret: `0x${string}` = SECRET_A,
		) {
			return revealTurn(f, {
				account: owner,
				identity: army,
				moves,
				secret,
				actionsPerReveal,
			});
		},
		settle(by: `0x${string}`, army: bigint) {
			return f.env.execute(f.Game, {
				account: by,
				functionName: 'settleDeployment',
				args: [army],
			});
		},
		army: (id: bigint) => read<ArmyView>('getArmy', [id]),
		reserve: (id: bigint) => read<bigint>('getReserve', [id]),
		attendance: () =>
			read<{waitedFor: bigint; committed: bigint; revealed: bigint}>(
				'getAttendance',
			),
		async open() {
			const [points] = await read<[bigint[], bigint]>('getOpenSpawnPoints');
			return points.map(xyOf);
		},
		async pieces(minX: number, minY: number, maxX: number, maxY: number) {
			const [pieces] = await read<[{position: bigint; army: bigint}[], bigint]>(
				'getPieces',
				[minX, minY, maxX, maxY],
			);
			return pieces;
		},
		supply: () =>
			f.env.read(f.GameToken, {functionName: 'totalSupply'}) as Promise<bigint>,
		balance: (account: `0x${string}`) =>
			f.env.read(f.GameToken, {
				functionName: 'balanceOf',
				args: [account],
			}) as Promise<bigint>,
	};
	return w;
}

describe('Deployment collisions', function () {
	it('fails and refunds both deployments revealing one spawn point, whatever order they reveal in', async function () {
		const outcomes: unknown[] = [];
		for (const order of ['forward', 'reverse'] as const) {
			const w = await world();
			const a = await w.commitDeployment(w.alice, [0, 0], SECRET_A);
			const b = await w.commitDeployment(w.bob, [0, 0], SECRET_B);
			// The stake has left both account reserves for the armies.
			expect(await w.reserve(idOf(w.alice))).toEqual(0n);
			await w.toRevealPhase();
			const reveals = [
				() => w.revealDeployment(w.alice, a, [0, 0], SECRET_A),
				() => w.revealDeployment(w.bob, b, [0, 0], SECRET_B),
			];
			if (order === 'reverse') reveals.reverse();
			for (const reveal of reveals) await reveal();
			await w.toNextCycle();

			// Failed, the refund pending: the army still holds it.
			for (const army of [a, b]) {
				const view = await w.army(army);
				expect(view.status).toEqual(STATUS.Failed);
				expect(view.stake).toEqual(DEFAULT_STAKE);
			}
			// Written by anyone: carol settles both.
			await w.settle(w.carol, a);
			await w.settle(w.carol, b);
			// Settling again does nothing.
			await w.settle(w.carol, a);
			const reserves = {
				aliceAccount: await w.reserve(idOf(w.alice)),
				bobAccount: await w.reserve(idOf(w.bob)),
				aliceArmy: await w.reserve(a),
				bobArmy: await w.reserve(b),
			};
			expect(reserves).toEqual({
				aliceAccount: DEFAULT_STAKE,
				bobAccount: DEFAULT_STAKE,
				aliceArmy: 0n,
				bobArmy: 0n,
			});
			// The spawn point is free again, and nothing stands on it.
			expect((await w.open())[0]).toEqual({x: 0, y: 0});
			expect(await w.pieces(-6, -6, 6, 6)).toEqual([]);
			outcomes.push({
				reserves,
				statuses: [(await w.army(a)).status, (await w.army(b)).status],
				open: await w.open(),
			});
		}
		expect(outcomes[1]).toEqual(outcomes[0]);
	});

	/**
	 * The two ways alice's army reaches a square of a footprint it does not
	 * stand on yet: `setup` is played in the cycles before, `arrive` lands the
	 * piece. Her east pawn steps into the gap (3,0), then onto (4,0), a pawn's
	 * square of the spawn point (6,0); or her pawn (1,-2) steps aside into her
	 * empty corner (2,-2), then her rook slides from (1,-1) onto (1,-6), the
	 * EMPTY core square of the spawn point (0,-6).
	 */
	const FOOTPRINT_SQUARES = [
		{
			name: 'a pawn square',
			spawnPoint: [1, 0] as [number, number],
			setup: [{from: at(2, 0), to: at(3, 0)}] as Move[],
			arrive: [{from: at(3, 0), to: at(4, 0)}] as Move[],
		},
		{
			name: 'the empty core square',
			spawnPoint: [0, -1] as [number, number],
			setup: [{from: at(1, -2), to: at(2, -2)}] as Move[],
			arrive: [{from: at(1, -1), to: at(1, -6)}] as Move[],
		},
	];

	for (const square of FOOTPRINT_SQUARES) {
		it(`fails and refunds a deployment whose footprint is occupied at the start of its cycle, on ${square.name}`, async function () {
			const w = await world();
			const a = await w.commitDeployment(w.alice, [0, 0]);
			await w.toRevealPhase();
			await w.revealDeployment(w.alice, a, [0, 0]);
			await w.toNextCycle();
			for (const moves of [square.setup, square.arrive]) {
				await w.commit(w.alice, a, moves);
				await w.toRevealPhase();
				await w.reveal(w.alice, a, moves);
				await w.toNextCycle();
			}
			const [i, j] = square.spawnPoint;
			const isTheSpawnPoint = (p: {x: number; y: number}) =>
				p.x === i * 6 && p.y === j * 6;
			expect((await w.open()).some(isTheSpawnPoint)).toEqual(true);

			// bob deploys there anyway, in the next cycle.
			const b = await w.commitDeployment(w.bob, square.spawnPoint);
			await w.toRevealPhase();
			await w.revealDeployment(w.bob, b, square.spawnPoint);
			await w.toNextCycle();

			expect((await w.army(b)).status).toEqual(STATUS.Failed);
			// Only alice's army is on the board, her piece where it went.
			const board = await w.pieces(-12, -12, 12, 6);
			expect(board.length).toEqual(20);
			expect(board.every((p) => p.army === a)).toEqual(true);
			expect(board.some((p) => p.position === square.arrive[0].to)).toEqual(
				true,
			);
			// Free again, and the refund written by anyone.
			expect((await w.open()).some(isTheSpawnPoint)).toEqual(true);
			await w.settle(w.carol, b);
			expect(await w.reserve(idOf(w.bob))).toEqual(DEFAULT_STAKE);
			expect(await w.reserve(b)).toEqual(0n);
		});

		it(`fails and refunds a deployment a piece arrives on during its cycle, on ${square.name}, whatever the order`, async function () {
			const outcomes: unknown[] = [];
			for (const order of ['forward', 'reverse'] as const) {
				const w = await world();
				const a = await w.commitDeployment(w.alice, [0, 0]);
				await w.toRevealPhase();
				await w.revealDeployment(w.alice, a, [0, 0]);
				await w.toNextCycle();
				await w.commit(w.alice, a, square.setup);
				await w.toRevealPhase();
				await w.reveal(w.alice, a, square.setup);
				await w.toNextCycle();
				// alice's piece arrives in the very cycle bob deploys.
				await w.commit(w.alice, a, square.arrive);
				const b = await w.commitDeployment(w.bob, square.spawnPoint);
				await w.toRevealPhase();
				const reveals = [
					() => w.reveal(w.alice, a, square.arrive),
					() => w.revealDeployment(w.bob, b, square.spawnPoint),
				];
				if (order === 'reverse') reveals.reverse();
				for (const reveal of reveals) await reveal();
				await w.toNextCycle();

				expect((await w.army(b)).status).toEqual(STATUS.Failed);
				await w.settle(w.carol, b);
				expect(await w.reserve(idOf(w.bob))).toEqual(DEFAULT_STAKE);
				const board = await w.pieces(-12, -12, 12, 6);
				expect(board.some((p) => p.position === square.arrive[0].to)).toEqual(
					true,
				);
				outcomes.push({
					board: board.map((p) => ({
						...xyOf(p.position),
						mine: p.army === a,
					})),
					status: (await w.army(b)).status,
				});
			}
			expect(outcomes[1]).toEqual(outcomes[0]);
		});
	}

	it('lands a deployment beside a piece standing on a corner of its square, which is not its footprint', async function () {
		const w = await world();
		const a = await w.commitDeployment(w.alice, [0, 0]);
		await w.toRevealPhase();
		await w.revealDeployment(w.alice, a, [0, 0]);
		await w.toNextCycle();
		// alice's knight, by (2,-2) and (3,0), onto (4,-2): the bottom-left
		// corner of the 5 by 5 square of the spawn point (6,0).
		for (const moves of [
			[{from: at(0, -1), to: at(2, -2)}],
			[{from: at(2, -2), to: at(3, 0)}],
			[{from: at(3, 0), to: at(4, -2)}],
		]) {
			await w.commit(w.alice, a, moves);
			await w.toRevealPhase();
			await w.reveal(w.alice, a, moves);
			await w.toNextCycle();
		}
		const b = await w.commitDeployment(w.bob, [1, 0]);
		await w.toRevealPhase();
		await w.revealDeployment(w.bob, b, [1, 0]);
		await w.toNextCycle();
		expect((await w.army(b)).status).toEqual(STATUS.Deployed);
		expect((await w.pieces(-6, -6, 12, 6)).length).toEqual(40);
	});

	it('writes the refund automatically on the next deployment, which it pays for', async function () {
		const w = await world();
		const a = await w.commitDeployment(w.alice, [0, 0], SECRET_A);
		const b = await w.commitDeployment(w.bob, [0, 0], SECRET_B);
		await w.toRevealPhase();
		await w.revealDeployment(w.alice, a, [0, 0], SECRET_A);
		await w.revealDeployment(w.bob, b, [0, 0], SECRET_B);
		await w.toNextCycle();

		// bob's account reserve is empty; his pending refund pays for this.
		expect(await w.reserve(idOf(w.bob))).toEqual(0n);
		const again = await w.commitDeployment(w.bob, [0, 0], SECRET_B, false);
		expect(again).not.toEqual(b);
		expect(await w.reserve(b)).toEqual(0n);
		expect(await w.reserve(again)).toEqual(DEFAULT_STAKE);
		await w.toRevealPhase();
		await w.revealDeployment(w.bob, again, [0, 0], SECRET_B);
		await w.toNextCycle();
		expect((await w.army(again)).status).toEqual(STATUS.Deployed);
		expect((await w.army(b)).status).toEqual(STATUS.Failed);
	});

	it('writes the refund automatically on a withdrawal, so it can be withdrawn', async function () {
		const w = await world();
		const a = await w.commitDeployment(w.alice, [0, 0], SECRET_A);
		const b = await w.commitDeployment(w.bob, [0, 0], SECRET_B);
		await w.toRevealPhase();
		await w.revealDeployment(w.alice, a, [0, 0], SECRET_A);
		await w.revealDeployment(w.bob, b, [0, 0], SECRET_B);
		await w.toNextCycle();

		const before = await w.balance(w.bob);
		await w.env.execute(w.Game, {
			account: w.bob,
			functionName: 'withdrawFromReserve',
			args: [DEFAULT_STAKE],
		});
		expect(await w.balance(w.bob)).toEqual(before + DEFAULT_STAKE);
		expect(await w.reserve(b)).toEqual(0n);
		expect(await w.reserve(idOf(w.bob))).toEqual(0n);
	});

	it('refuses a commitment from a failed army', async function () {
		const w = await world();
		const a = await w.commitDeployment(w.alice, [0, 0], SECRET_A);
		const b = await w.commitDeployment(w.bob, [0, 0], SECRET_B);
		await w.toRevealPhase();
		await w.revealDeployment(w.alice, a, [0, 0], SECRET_A);
		await w.revealDeployment(w.bob, b, [0, 0], SECRET_B);
		await w.toNextCycle();
		await expect(w.commit(w.alice, a, PASS)).toBeRejectedWith('NotInGame');
	});

	for (const path of ['acknowledgeMissedReveal', 'forfeitMissedReveal']) {
		it(`burns the stake of a deployment never revealed, settled by ${path}`, async function () {
			const w = await world();
			const a = await w.commitDeployment(w.alice, [0, 0]);
			const supply = await w.supply();
			const before = await w.attendance();
			await w.toRevealPhase();
			await w.toNextCycle();
			expect((await w.army(a)).status).toEqual(STATUS.Unrevealed);

			if (path === 'acknowledgeMissedReveal') {
				// Shown the deployment, by anyone.
				const {chunks} = commitmentChain(
					deploymentAt(spawn(0, 0)),
					SECRET_A,
					1,
				);
				await w.env.execute(w.Game, {
					account: w.bob,
					functionName: path,
					args: [a, chunks[0].moves, SECRET_A, chunks[0].furtherActions],
				});
			} else {
				await w.env.execute(w.Game, {
					account: w.alice,
					functionName: path,
					args: [a],
				});
			}

			// A real burn: the supply is smaller by the whole stake.
			expect(await w.supply()).toEqual(supply - DEFAULT_STAKE);
			expect(await w.reserve(a)).toEqual(0n);
			expect(await w.reserve(idOf(w.alice))).toEqual(0n);
			// Nothing to refund, and no army on the board.
			await w.settle(w.carol, a);
			expect(await w.reserve(idOf(w.alice))).toEqual(0n);
			const view = await w.army(a);
			expect(view.status).toEqual(STATUS.Unrevealed);
			expect(view.stake).toEqual(0n);
			expect(await w.pieces(-6, -6, 6, 6)).toEqual([]);
			expect((await w.attendance()).waitedFor).toEqual(before.waitedFor - 1n);
		});
	}

	it('cancels a deployment for free: the whole stake back, and the army no longer waited for', async function () {
		const w = await world();
		const before = await w.attendance();
		const a = await w.commitDeployment(w.alice, [0, 0]);
		expect((await w.attendance()).waitedFor).toEqual(before.waitedFor + 1n);
		expect((await w.attendance()).committed).toEqual(before.committed + 1n);

		await w.env.execute(w.Game, {
			account: w.alice,
			functionName: 'cancelCommitment',
			args: [a],
		});
		expect(await w.reserve(idOf(w.alice))).toEqual(DEFAULT_STAKE);
		expect(await w.reserve(a)).toEqual(0n);
		expect(await w.attendance()).toEqual(before);
		expect((await w.army(a)).status).toEqual(STATUS.Cancelled);
		// It cannot be committed for again; the next deployment is a new army.
		await expect(w.commit(w.alice, a, PASS)).toBeRejectedWith('NotInGame');
		const next = await w.commitDeployment(w.alice, [0, 0], SECRET_A, false);
		expect(next).not.toEqual(a);
		await w.toRevealPhase();
		await w.revealDeployment(w.alice, next, [0, 0]);
		await w.toNextCycle();
		expect((await w.army(next)).status).toEqual(STATUS.Deployed);
		expect((await w.army(a)).status).toEqual(STATUS.Cancelled);
	});
});

describe('Dead armies under a manual cycle', function () {
	it('keeps advancing after deployments fail: the dead are swept by the advance', async function () {
		const w = await world(CYCLE_POLICY.Manual);
		// alice and bob collide on (0,0); carol lands on (1,0).
		const a = await w.commitDeployment(w.alice, [0, 0], SECRET_A);
		const b = await w.commitDeployment(w.bob, [0, 0], SECRET_B);
		const c = await w.commitDeployment(w.carol, [1, 0], SECRET_A);
		await w.toRevealPhase();
		await w.revealDeployment(w.alice, a, [0, 0], SECRET_A);
		await w.revealDeployment(w.bob, b, [0, 0], SECRET_B);
		await w.revealDeployment(w.carol, c, [1, 0], SECRET_A);
		await w.toNextCycle();

		expect((await w.army(a)).status).toEqual(STATUS.Failed);
		// The attendance already counts only carol, as the advance will.
		expect((await w.attendance()).waitedFor).toEqual(1n);
		await w.commit(w.carol, c, PASS);
		await w.advance();
		await w.reveal(w.carol, c, PASS);
		await w.advance();
		// And on, with nobody settling anything.
		await w.commit(w.carol, c, PASS);
		await w.advance();
		const cycle = (await w.env.read(w.Game, {functionName: 'getCycle'})) as {
			commiting: boolean;
		};
		expect(cycle.commiting).toEqual(false);
	});

	it('keeps advancing after a deployment is cancelled', async function () {
		const w = await world(CYCLE_POLICY.Manual);
		const c = await w.commitDeployment(w.carol, [1, 0]);
		const d = await w.commitDeployment(w.dave, [0, 0]);
		await w.env.execute(w.Game, {
			account: w.dave,
			functionName: 'cancelCommitment',
			args: [d],
		});
		expect((await w.attendance()).waitedFor).toEqual(1n);
		await w.toRevealPhase();
		await w.revealDeployment(w.carol, c, [1, 0]);
		await w.toNextCycle();
		expect((await w.army(c)).status).toEqual(STATUS.Deployed);
		expect(await w.reserve(idOf(w.dave))).toEqual(DEFAULT_STAKE);
	});
});
