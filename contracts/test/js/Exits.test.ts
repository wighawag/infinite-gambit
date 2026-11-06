import {expect} from 'earl';
import {describe, it} from 'node:test'; // using node:test as hardhat v3 do not support vitest
import {network} from 'hardhat';
import {zeroAddress} from 'viem';
import {DEFAULT_STAKE, setupFixtures} from './utils/index.js';
import {movesWorld, move, type Piece} from './utils/moves-world.js';

/**
 * EXITS (stories 32 to 35, `docs/adr/0006-stake-erc20-reserve-exit-only.md`):
 * an exited army's pieces leave the board, and its exit pays its whole stake,
 * the stakes of the armies it took included (`docs/adr/0013`).
 *
 * On the tight grid (spacing 6) the exits are at (6i+3, 6j+3). alice's king,
 * deployed at (0,0), stands at (-2,0) and reaches the exit (-3,3) in three
 * steps; dave's, deployed at (6,6), stands at (4,6) and reaches (3,9) in three.
 * Every stake here is BOUGHT through `StakeSale`, so the sale holds the ETH the
 * payout redeems.
 */

const {provider, networkHelpers} = await network.connect();
const {deployAll} = setupFixtures(provider);
const world = movesWorld({
	deployAll,
	loadFixture: networkHelpers.loadFixture,
	buyStakes: true,
});
type World = Awaited<ReturnType<typeof world>>;

const CAPTURED = 6;
const EXITED = 7;
const ALICE_TO_EXIT = [
	move([-2, 0], [-3, 1]),
	move([-3, 1], [-3, 2]),
	move([-3, 2], [-3, 3]),
];

async function ethOf(address: `0x${string}`): Promise<bigint> {
	return BigInt(
		(await provider.request({
			method: 'eth_getBalance',
			params: [address, 'latest'],
		})) as string,
	);
}

function priceOf(w: World): bigint {
	return BigInt((w.StakeSale.linkedData as {price: string}).price);
}

async function isExited(w: World, army: bigint): Promise<boolean> {
	return (await w.env.read(w.Game, {
		functionName: 'isExited',
		args: [army],
	})) as boolean;
}

async function exit(w: World, army: bigint, account: `0x${string}`) {
	return w.env.execute(w.Game, {account, functionName: 'exit', args: [army]});
}

async function reserveOf(w: World, id: bigint): Promise<bigint> {
	return (await w.env.read(w.Game, {
		functionName: 'getReserve',
		args: [id],
	})) as bigint;
}

async function armyView(w: World, army: bigint) {
	return (await w.env.read(w.Game, {
		functionName: 'getArmy',
		args: [army],
	})) as {
		status: number;
		stake: bigint;
		capturedBy: bigint;
		owner: string;
		king: bigint;
	};
}

const piecesOf = (pieces: Piece[], army: bigint) =>
	pieces.filter((p) => p.army === army);

/** alice's king walks onto the exit, alone; bob passes every cycle. */
async function aliceExits(order: 'forward' | 'reverse' = 'forward') {
	const w = await world();
	const [a, b] = await w.deploy([
		[w.alice, [0, 0]],
		[w.bob, [1, 0]],
	]);
	for (const m of ALICE_TO_EXIT.slice(0, 2)) {
		await w.play([
			{owner: w.alice, army: a, moves: [m]},
			{owner: w.bob, army: b, moves: []},
		]);
	}
	// The landing cycle, by hand, to look at it before it closes.
	await w.commit(w.alice, a, [ALICE_TO_EXIT[2]]);
	await w.commit(w.bob, b, []);
	await w.toRevealPhase();
	const reveals: [`0x${string}`, bigint, ReturnType<typeof move>[]][] = [
		[w.alice, a, [ALICE_TO_EXIT[2]]],
		[w.bob, b, []],
	];
	if (order === 'reverse') reveals.reverse();
	for (const [owner, army, moves] of reveals) {
		await w.reveal(owner, army, moves);
	}
	return {w, a, b};
}

describe('exits', function () {
	it('lets a king that lands alone on an exit leave with its whole stake, paid in ETH by anyone, once', async function () {
		const {w, a, b} = await aliceExits();

		// NOT BEFORE THE LANDING CYCLE CLOSES: a capture could still race it.
		expect(await isExited(w, a)).toEqual(false);
		await expect(exit(w, a, w.bob)).toBeRejectedWith(/NotExited/);

		await w.toNextCycle();
		expect(await isExited(w, a)).toEqual(true);
		// Its army has left the board, and it is dead: it may not commit.
		expect(piecesOf(await w.pieces(), a)).toEqual([]);
		expect(piecesOf(await w.pieces(), b).length).toEqual(20);
		const view = await armyView(w, a);
		expect(view.status).toEqual(EXITED);
		expect(view.stake).toEqual(DEFAULT_STAKE);
		await expect(w.commit(w.alice, a, [])).toBeRejectedWith(/NotInGame/);

		// Paid by ANYONE, to the owner only, in ETH at the sale's price.
		const price = priceOf(w);
		const aliceBefore = await ethOf(w.alice);
		const saleBefore = await ethOf(w.StakeSale.address);
		const supplyBefore = (await w.env.read(w.GameToken, {
			functionName: 'totalSupply',
		})) as bigint;
		await exit(w, a, w.bob);
		expect(await ethOf(w.alice)).toEqual(aliceBefore + price);
		expect(await ethOf(w.StakeSale.address)).toEqual(saleBefore - price);
		expect(
			await w.env.read(w.GameToken, {functionName: 'totalSupply'}),
		).toEqual(supplyBefore - DEFAULT_STAKE);
		expect(await reserveOf(w, a)).toEqual(0n);
		expect((await armyView(w, a)).stake).toEqual(0n);

		// Once.
		await expect(exit(w, a, w.bob)).toBeRejectedWith(/AlreadyPaid/);
		await expect(exit(w, a, w.alice)).toBeRejectedWith(/AlreadyPaid/);
	});

	it('gives the same board whatever order the landing cycle is revealed in', async function () {
		const forward = await aliceExits('forward');
		await forward.w.toNextCycle();
		const reverse = await aliceExits('reverse');
		await reverse.w.toNextCycle();
		expect(await reverse.w.board()).toEqual(await forward.w.board());
		expect(await isExited(reverse.w, reverse.a)).toEqual(true);
	});

	it('does not let a king whose arrival on an exit collides leave: the collision table decides', async function () {
		// carol's knight reaches the exit in four moves, the cycle alice's king
		// lands there: a king meeting a single piece dies, and that piece lands
		// as a queen with its stake (`docs/adr/0013`).
		const w = await world();
		const [a, , c] = await w.deploy([
			[w.alice, [0, 0]],
			[w.bob, [1, 0]],
			[w.carol, [0, 1]],
		]);
		const knight = [
			move([-1, 5], [-3, 4]),
			move([-3, 4], [-4, 6]),
			move([-4, 6], [-5, 4]),
			move([-5, 4], [-3, 3]),
		];
		const king = [[], ...ALICE_TO_EXIT.map((m) => [m])];
		for (let k = 0; k < 4; k++) {
			await w.play([
				{owner: w.carol, army: c, moves: [knight[k]]},
				{owner: w.alice, army: a, moves: king[k]},
			]);
		}
		expect(await isExited(w, a)).toEqual(false);
		expect(await w.pieceAt(-3, 3)).toEqual(`Q@-3,3#${c}:N*`);
		const view = await armyView(w, a);
		expect(view.status).toEqual(CAPTURED);
		expect(view.capturedBy).toEqual(c);
		await expect(exit(w, a, w.alice)).toBeRejectedWith(/NotExited/);
	});

	it('gives the same payout and the same board whether the exit is claimed before or after a capture attempt on the exited king', async function () {
		// carol's knight arrives on the exit the cycle AFTER alice's king left
		// it: the square is empty, so it simply lands, and nothing is taken.
		async function run(claim: 'before' | 'after') {
			const w = await world();
			const [a, , c] = await w.deploy([
				[w.alice, [0, 0]],
				[w.bob, [1, 0]],
				[w.carol, [0, 1]],
			]);
			const knight = [
				move([-1, 5], [-3, 4]),
				move([-3, 4], [-4, 6]),
				move([-4, 6], [-5, 4]),
			];
			for (let k = 0; k < 3; k++) {
				await w.play([
					{owner: w.carol, army: c, moves: [knight[k]]},
					{owner: w.alice, army: a, moves: [ALICE_TO_EXIT[k]]},
				]);
			}
			const aliceBefore = await ethOf(w.alice);
			if (claim === 'before') await exit(w, a, w.carol);
			await w.play([
				{owner: w.carol, army: c, moves: [move([-5, 4], [-3, 3])]},
			]);
			if (claim === 'after') await exit(w, a, w.carol);
			return {
				paid: (await ethOf(w.alice)) - aliceBefore,
				board: await w.board(),
				carol: (({status, stake, king, capturedBy}) => ({
					status,
					stake,
					king,
					capturedBy,
				}))((await armyView(w, c)) as any),
				knight: await w.pieceAt(-3, 3),
			};
		}
		const before = await run('before');
		const after = await run('after');
		expect(before.paid).toEqual(DEFAULT_STAKE / 10n ** 9n);
		expect(after).toEqual(before);
		expect(before.knight?.startsWith('N@-3,3')).toEqual(true);
		expect(before.carol.stake).toEqual(DEFAULT_STAKE);
	});

	it('pays the stake of the army it took too, collected in parts if asked, and the same whether the capture was folded first', async function () {
		// dave's queen takes bob's king on (6,1); dave's king then walks to the
		// exit (3,9). Folding bob's capture (a move off its square) moves bob's
		// reserve up into dave's; not folding it leaves the exit to collect it.
		async function run(fold: boolean) {
			const w = await world();
			const [, b, , d] = await w.deploy([
				[w.alice, [0, 0]],
				[w.bob, [1, 0]],
				[w.carol, [0, 1]],
				[w.dave, [1, 1]],
			]);
			const daveMoves = [
				move([7, 5], [8, 4]),
				move([8, 4], [8, 3]),
				move([8, 3], [6, 1]),
			];
			if (fold) daveMoves.push(move([6, 1], [7, 2]));
			daveMoves.push(
				move([4, 6], [3, 7]),
				move([3, 7], [3, 8]),
				move([3, 8], [3, 9]),
			);
			for (const m of daveMoves) {
				await w.play([{owner: w.dave, army: d, moves: [m]}]);
			}
			expect(await reserveOf(w, b)).toEqual(fold ? 0n : DEFAULT_STAKE);
			expect((await armyView(w, d)).stake).toEqual(2n * DEFAULT_STAKE);
			expect(await isExited(w, d)).toEqual(true);
			// Every piece of both armies has left the board.
			const pieces = await w.pieces();
			expect(piecesOf(pieces, d)).toEqual([]);
			expect(piecesOf(pieces, b)).toEqual([]);
			expect(pieces.length).toEqual(40);
			// One army per call: dave's own reserve, then bob's.
			const collect = () =>
				w.env.execute(w.Game, {
					account: w.alice,
					functionName: 'collect',
					args: [d, 1n],
				});
			await collect();
			expect(await reserveOf(w, d)).toEqual(0n);
			await collect();
			expect(await reserveOf(w, b)).toEqual(0n);
			const daveBefore = await ethOf(w.dave);
			await exit(w, d, w.alice);
			return {paid: (await ethOf(w.dave)) - daveBefore};
		}
		const unfolded = await run(false);
		const folded = await run(true);
		expect(unfolded.paid).toEqual(2n * (DEFAULT_STAKE / 10n ** 9n));
		expect(folded).toEqual(unfolded);
	});

	it('never lets an army reserve be withdrawn directly, while the account reserve can be', async function () {
		const w = await world();
		const [a] = await w.deploy([[w.alice, [0, 0]]]);
		await expect(
			w.env.execute(w.Game, {
				account: w.alice,
				functionName: 'withdrawFromReserve',
				args: [1n],
			}),
		).toBeRejectedWith(/ReserveTooLow/);
		expect(await reserveOf(w, a)).toEqual(DEFAULT_STAKE);
		const price = priceOf(w);
		await w.env.execute(w.StakeSale, {
			account: w.alice,
			functionName: 'purchaseAt',
			args: [w.Game.address, w.alice, zeroAddress, 0n],
			value: price,
		});
		await w.env.execute(w.Game, {
			account: w.alice,
			functionName: 'withdrawFromReserve',
			args: [DEFAULT_STAKE],
		});
		expect(
			await w.env.read(w.GameToken, {
				functionName: 'balanceOf',
				args: [w.alice],
			}),
		).toEqual(DEFAULT_STAKE);
	});
});

const offline = movesWorld({
	deployAll,
	loadFixture: networkHelpers.loadFixture,
	manual: true,
	buyStakes: true,
});

describe('an exit in the offline world', function () {
	it('keeps the world advancing: an exited army is dead, and no longer waited for', async function () {
		const w = await offline();
		const [a, b] = await w.deploy([
			[w.alice, [0, 0]],
			[w.bob, [1, 0]],
		]);
		for (const m of ALICE_TO_EXIT) {
			await w.play([
				{owner: w.alice, army: a, moves: [m]},
				{owner: w.bob, army: b, moves: []},
			]);
		}
		expect(await isExited(w as unknown as World, a)).toEqual(true);
		const attendance = (await w.env.read(w.Game, {
			functionName: 'getAttendance',
		})) as {waitedFor: bigint};
		expect(attendance.waitedFor).toEqual(1n);
		// alice never commits again, and the world goes on without her.
		await w.play([{owner: w.bob, army: b, moves: []}]);
		await w.play([{owner: w.bob, army: b, moves: []}]);
		await exit(w as unknown as World, a, w.bob);
	});
});
