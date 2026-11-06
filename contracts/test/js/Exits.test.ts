import {expect} from 'earl';
import {describe, it} from 'node:test'; // using node:test as hardhat v3 do not support vitest
import {network} from 'hardhat';
import {zeroAddress} from 'viem';
import {DEFAULT_STAKE, setupFixtures} from './utils/index.js';
import {
	movesWorld,
	move,
	REVEAL_ORDERS,
	type Piece,
	type RevealOrder,
} from './utils/moves-world.js';

/**
 * EXITS (stories 32 to 35, `docs/adr/0006-stake-erc20-reserve-exit-only.md`):
 * an exited army's pieces leave the board, and its exit pays its whole stake,
 * the stakes of the armies it took included (`docs/adr/0013`).
 *
 * An exit is the 2 by 2 block at the centre of each spawn-grid cell
 * (`docs/adr/0015`): on the tight grid (spacing 6) the squares (6i+3 or 6i+4,
 * 6j+3 or 6j+4). alice's king, deployed on (0,0), reaches the block (3..4,
 * -3..-2) once her rook (1,-1) has stepped into her empty core square: by
 * (1,-1) and her empty corner (2,-2). dave's, deployed on (6,6), reaches the
 * exit (4,4), his own corner on this tight grid, once his bishop (5,5) is out
 * of the way.
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
/** alice's rook steps aside, and her king walks to (2,-2), beside the block. */
const ALICE_TO_THE_BLOCK = [
	move([1, -1], [1, 0]),
	move([0, 0], [1, -1]),
	move([1, -1], [2, -2]),
];
const ALICE_TO_EXIT = [...ALICE_TO_THE_BLOCK, move([2, -2], [3, -2])];
const LANDING = ALICE_TO_EXIT.length - 1;

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
	for (const m of ALICE_TO_EXIT.slice(0, LANDING)) {
		await w.play([
			{owner: w.alice, army: a, moves: [m]},
			{owner: w.bob, army: b, moves: []},
		]);
	}
	// The landing cycle, by hand, to look at it before it closes.
	await w.commit(w.alice, a, [ALICE_TO_EXIT[LANDING]]);
	await w.commit(w.bob, b, []);
	await w.toRevealPhase();
	const reveals: [`0x${string}`, bigint, ReturnType<typeof move>[]][] = [
		[w.alice, a, [ALICE_TO_EXIT[LANDING]]],
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

	/**
	 * alice's king lands alone on `square` of the block, by `path` from
	 * (2,-2), its last move revealed in `order` with bob's pass.
	 */
	async function aliceExitsOn(
		path: ReturnType<typeof move>[],
		order: 'forward' | 'reverse',
	) {
		const w = await world();
		const [a, b] = await w.deploy([
			[w.alice, [0, 0]],
			[w.bob, [1, 0]],
		]);
		const moves = [...ALICE_TO_THE_BLOCK, ...path];
		for (let k = 0; k < moves.length; k++) {
			await w.play(
				[
					{owner: w.alice, army: a, moves: [moves[k]]},
					{owner: w.bob, army: b, moves: []},
				],
				k === moves.length - 1 ? order : 'forward',
			);
		}
		return {w, a, b, board: await w.board()};
	}

	const BLOCK: [string, ReturnType<typeof move>[]][] = [
		['(3,-2)', [move([2, -2], [3, -2])]],
		['(3,-3)', [move([2, -2], [3, -3])]],
		['(4,-2)', [move([2, -2], [3, -1]), move([3, -1], [4, -2])]],
		[
			'(4,-3)',
			[move([2, -2], [2, -3]), move([2, -3], [3, -4]), move([3, -4], [4, -3])],
		],
	];
	for (const [name, path] of BLOCK) {
		it(`lets a king that lands alone on ${name}, a square of the 2 by 2 block, leave, whatever the order`, async function () {
			const forward = await aliceExitsOn(path, 'forward');
			expect(await isExited(forward.w, forward.a)).toEqual(true);
			expect((await armyView(forward.w, forward.a)).status).toEqual(EXITED);
			expect(piecesOf(await forward.w.pieces(), forward.a)).toEqual([]);
			const reverse = await aliceExitsOn(path, 'reverse');
			expect(reverse.board).toEqual(forward.board);
			expect(await isExited(reverse.w, reverse.a)).toEqual(true);
		});
	}

	it('never counts the squares around the block as an exit', async function () {
		// The king's last stops on its way to (4,-3), and (2,-2) beside the
		// block, are squares like any other.
		const w = await world();
		const [a] = await w.deploy([[w.alice, [0, 0]]]);
		for (const m of [
			...ALICE_TO_THE_BLOCK,
			move([2, -2], [2, -3]),
			move([2, -3], [3, -4]),
			move([3, -4], [2, -5]),
		]) {
			await w.play([{owner: w.alice, army: a, moves: [m]}]);
			expect(await isExited(w, a)).toEqual(false);
		}
		expect(await w.pieceAt(2, -5)).toEqual(`K@2,-5#${a}`);
	});

	it('lets two kings that land alone on two squares of one block both leave, whatever the order', async function () {
		// bob's bishop (5,-1) slides out through the block to (1,-5), his king
		// steps onto (5,-1), and in alice's landing cycle he lands on (4,-2)
		// beside her (3,-2). Neither king stood next to the other's destination
		// at the start of the cycle, so both moves are legal.
		async function run(order: RevealOrder) {
			const w = await world();
			const [a, b] = await w.deploy([
				[w.alice, [0, 0]],
				[w.bob, [1, 0]],
			]);
			const bob = [
				[move([5, -1], [1, -5])],
				[move([6, 0], [5, -1])],
				[],
				[move([5, -1], [4, -2])],
			];
			for (let k = 0; k < ALICE_TO_EXIT.length; k++) {
				await w.play(
					[
						{owner: w.alice, army: a, moves: [ALICE_TO_EXIT[k]]},
						{owner: w.bob, army: b, moves: bob[k]},
					],
					order,
				);
			}
			return {
				w,
				a,
				b,
				board: await w.board(),
				registry: await w.registry(),
			};
		}
		const forward = await run('forward');
		expect(await isExited(forward.w, forward.a)).toEqual(true);
		expect(await isExited(forward.w, forward.b)).toEqual(true);
		expect(forward.board).toEqual([]);
		for (const order of REVEAL_ORDERS.slice(1)) {
			const other = await run(order);
			expect(other.board).toEqual(forward.board);
			expect(other.registry).toEqual(forward.registry);
			expect(await isExited(other.w, other.a)).toEqual(true);
			expect(await isExited(other.w, other.b)).toEqual(true);
		}
	});

	it('does not let a king whose arrival on an exit collides leave: the collision table decides', async function () {
		// bob's knight reaches the exit the cycle alice's king lands there: a
		// king meeting a single piece dies, and that piece lands as a queen with
		// its stake (`docs/adr/0013`).
		const w = await world();
		const [a, b] = await w.deploy([
			[w.alice, [0, 0]],
			[w.bob, [1, 0]],
		]);
		const knight = [[move([6, -1], [5, -3])], [], [], [move([5, -3], [3, -2])]];
		for (let k = 0; k < ALICE_TO_EXIT.length; k++) {
			await w.play([
				{owner: w.bob, army: b, moves: knight[k]},
				{owner: w.alice, army: a, moves: [ALICE_TO_EXIT[k]]},
			]);
		}
		expect(await isExited(w, a)).toEqual(false);
		expect(await w.pieceAt(3, -2)).toEqual(`Q@3,-2#${b}`);
		const view = await armyView(w, a);
		expect(view.status).toEqual(CAPTURED);
		expect(view.capturedBy).toEqual(b);
		await expect(exit(w, a, w.alice)).toBeRejectedWith(/NotExited/);
	});

	it('gives the same payout and the same board whether the exit is claimed before or after a capture attempt on the exited king', async function () {
		// bob's knight arrives on the exit the cycle AFTER alice's king left
		// it: the square is empty, so it simply lands, and nothing is taken.
		async function run(claim: 'before' | 'after') {
			const w = await world();
			const [a, b] = await w.deploy([
				[w.alice, [0, 0]],
				[w.bob, [1, 0]],
			]);
			for (let k = 0; k < ALICE_TO_EXIT.length; k++) {
				await w.play([
					{
						owner: w.bob,
						army: b,
						moves: k === 0 ? [move([6, -1], [5, -3])] : [],
					},
					{owner: w.alice, army: a, moves: [ALICE_TO_EXIT[k]]},
				]);
			}
			const aliceBefore = await ethOf(w.alice);
			if (claim === 'before') await exit(w, a, w.bob);
			await w.play([{owner: w.bob, army: b, moves: [move([5, -3], [3, -2])]}]);
			if (claim === 'after') await exit(w, a, w.bob);
			return {
				paid: (await ethOf(w.alice)) - aliceBefore,
				board: await w.board(),
				bob: (({status, stake, king, capturedBy}) => ({
					status,
					stake,
					king,
					capturedBy,
				}))((await armyView(w, b)) as any),
				knight: await w.pieceAt(3, -2),
			};
		}
		const before = await run('before');
		const after = await run('after');
		expect(before.paid).toEqual(DEFAULT_STAKE / 10n ** 9n);
		expect(after).toEqual(before);
		expect(before.knight?.startsWith('N@3,-2')).toEqual(true);
		expect(before.bob.stake).toEqual(DEFAULT_STAKE);
	});

	it('pays the stake of the army it took too, collected in parts if asked, and the same whether the capture was folded first', async function () {
		// dave's knight, by (7,3) and bob's pawn (5,2), takes bob's king on
		// (6,0) and becomes a queen; dave's king then walks to the exit (4,4)
		// behind his bishop. Folding bob's capture (a move off its square)
		// moves bob's reserve up into dave's; not folding it leaves the exit to
		// collect it.
		async function run(fold: boolean) {
			const w = await world();
			const [, b, , d] = await w.deploy([
				[w.alice, [0, 0]],
				[w.bob, [1, 0]],
				[w.carol, [0, 1]],
				[w.dave, [1, 1]],
			]);
			const daveMoves = [
				move([6, 5], [7, 3]),
				move([7, 3], [5, 2]),
				move([5, 2], [6, 0]),
			];
			if (fold) daveMoves.push(move([6, 0], [7, 0]));
			daveMoves.push(
				move([5, 5], [3, 3]),
				move([6, 6], [5, 5]),
				move([5, 5], [4, 4]),
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
