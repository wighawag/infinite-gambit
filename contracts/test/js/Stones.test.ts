import {expect} from 'earl';
import {describe, it} from 'node:test'; // using node:test as hardhat v3 do not support vitest
import {network} from 'hardhat';
import {setupFixtures} from './utils/index.js';
import {
	movesWorld,
	move,
	at,
	REVEAL_ORDERS,
	type RevealOrder,
	type Piece,
} from './utils/moves-world.js';

/**
 * STONES (`docs/adr/0014-a-capture-whose-captor-falls-the-same-cycle-leaves-a-stone.md`):
 * a king taken by a piece whose own army's king falls in the same cycle
 * (taken, or leaving through an exit) is a stone on its square, holding its
 * army's whole stake. It never moves, blocks like any piece, attacks nothing,
 * is not a king, and gives its stake, without promotion, to whoever captures
 * it.
 *
 * Every scenario is replayed in several reveal orders, and the board, the
 * registry and the outcomes must not change
 * (`docs/adr/0002-order-free-lazy-resolution.md`). The world is
 * `KingCapture.test.ts`'s: alice (0,0), bob (6,0), carol (0,6) and dave
 * (6,6), every king on its spawn point.
 */

const {provider, networkHelpers} = await network.connect();
const {deployAll} = setupFixtures(provider);
// Stakes BOUGHT through `StakeSale`, so an exit's payout can redeem them.
const world = movesWorld({
	deployAll,
	loadFixture: networkHelpers.loadFixture,
	buyStakes: true,
});

type World = Awaited<ReturnType<typeof world>>;

const DEPLOYED = 2;
const CAPTURED = 6;
const EXITED = 7;
const STONE = 7;

async function snapshot(w: World) {
	return {
		board: await w.board(),
		registry: await w.registry(),
		outcomes: (await w.outcomes()).lines,
	};
}

async function inEveryOrder<T extends {w: World}>(
	scenario: (order: RevealOrder) => Promise<T>,
): Promise<T> {
	let first: Awaited<ReturnType<typeof snapshot>> | undefined;
	let last: T | undefined;
	for (const order of REVEAL_ORDERS) {
		last = await scenario(order);
		const state = await snapshot(last.w);
		if (first) expect(state).toEqual(first);
		else first = state;
	}
	return last!;
}

async function entry(w: World, army: bigint) {
	const found = (await w.registry()).find((r) => r.id === army);
	if (!found) throw new Error(`no army ${army}`);
	return found;
}

async function piecesOf(w: World, army: bigint): Promise<string[]> {
	return (await w.board()).filter((l) => l.endsWith(`#${army}`));
}

/**
 * A CHAIN IN ONE CYCLE: dave's knight, by (7,3) and bob's pawn (5,2), takes
 * bob's king on (6,0), while carol's knight, by her empty corner (2,8) and
 * dave's pawn (4,7), takes dave's king on (6,6). dave's king fell in the
 * cycle his knight took bob's: bob's king is a stone.
 */
async function chain(order: RevealOrder) {
	const w = await world();
	const [a, b, c, d] = await w.deploy([
		[w.alice, [0, 0]],
		[w.bob, [1, 0]],
		[w.carol, [0, 1]],
		[w.dave, [1, 1]],
	]);
	const stakes = new Map((await w.registry()).map((r) => [r.id, r.stake]));
	await w.play([
		{owner: w.dave, army: d, moves: [move([6, 5], [7, 3])]},
		{owner: w.carol, army: c, moves: [move([0, 7], [2, 8])]},
	]);
	await w.play([
		{owner: w.dave, army: d, moves: [move([7, 3], [5, 2])]},
		{owner: w.carol, army: c, moves: [move([2, 8], [4, 7])]},
	]);
	await w.play(
		[
			{owner: w.dave, army: d, moves: [move([5, 2], [6, 0])]},
			{owner: w.carol, army: c, moves: [move([4, 7], [6, 6])]},
			{owner: w.bob, army: b, moves: []},
		],
		order,
	);
	return {w, a, b, c, d, stakes};
}

/**
 * After {chain}: carol's new queen steps down to (6,4), and alice's pawn
 * (2,1) walks East through bob's emptied squares to (5,1), diagonal to the
 * stone.
 */
async function aroundTheStone(order: RevealOrder) {
	const s = await chain(order);
	const {w, a, c} = s;
	await w.play(
		[
			{owner: w.carol, army: c, moves: [move([6, 6], [6, 4])]},
			{owner: w.alice, army: a, moves: [move([2, 1], [3, 1])]},
		],
		order,
	);
	await w.play([{owner: w.alice, army: a, moves: [move([3, 1], [4, 1])]}]);
	await w.play([{owner: w.alice, army: a, moves: [move([4, 1], [5, 1])]}]);
	return s;
}

describe('a capture whose captor falls in the same cycle', function () {
	it('leaves the king it took as a stone holding its stake, and gives the captor army to its own captor', async function () {
		const {w, b, c, d, stakes} = await inEveryOrder(chain);
		expect(await w.pieceAt(6, 0)).toEqual(`S@6,0#${b}`);
		expect(await w.pieceAt(6, 6)).toEqual(`Q@6,6#${c}`);
		expect(await piecesOf(w, d)).toEqual([]);
		// bob's pieces but the stone are gone.
		expect(await piecesOf(w, b)).toEqual([`S@6,0#${b}`]);
		const bob = await entry(w, b);
		expect([bob.status, bob.capturedBy, bob.stake]).toEqual([
			CAPTURED,
			0n,
			stakes.get(b)!,
		]);
		const dave = await entry(w, d);
		expect([dave.status, dave.capturedBy, dave.stake]).toEqual([
			CAPTURED,
			c,
			0n,
		]);
		expect((await entry(w, c)).stake).toEqual(stakes.get(c)! + stakes.get(d)!);
	});

	it('gives the stone, and its stake, to a lone piece that captures it, without promotion', async function () {
		const {w, a, b, stakes} = await inEveryOrder(async (order) => {
			const s = await aroundTheStone(order);
			await s.w.play(
				[
					{owner: s.w.alice, army: s.a, moves: [move([5, 1], [6, 0])]},
					{owner: s.w.carol, army: s.c, moves: []},
				],
				order,
			);
			return s;
		});
		// On its diagonal, onto the stone.
		expect(await w.pieceAt(6, 0)).toEqual(`P@6,0#${a}`);
		expect(await piecesOf(w, b)).toEqual([]);
		const bob = await entry(w, b);
		expect([bob.status, bob.capturedBy, bob.stake]).toEqual([CAPTURED, a, 0n]);
		expect((await entry(w, a)).stake).toEqual(stakes.get(a)! + stakes.get(b)!);
		expect((await w.outcomes()).lines).toEqual([
			`6,0 died=0 captured=S@6,0#${b} now=P@6,0#${a}`,
		]);
	});

	it('keeps the stone when two pieces arrive on it: the collision table decides', async function () {
		const {w, b, stakes} = await inEveryOrder(async (order) => {
			const s = await aroundTheStone(order);
			await s.w.play(
				[
					{owner: s.w.alice, army: s.a, moves: [move([5, 1], [6, 0])]},
					{owner: s.w.carol, army: s.c, moves: [move([6, 4], [6, 0])]},
				],
				order,
			);
			return s;
		});
		expect(await w.pieceAt(6, 0)).toEqual(`S@6,0#${b}`);
		expect(await w.pieceAt(5, 1)).toEqual(undefined);
		expect(await w.pieceAt(6, 4)).toEqual(undefined);
		expect((await entry(w, b)).stake).toEqual(stakes.get(b)!);
		expect((await w.outcomes()).lines).toEqual([
			`6,0 died=2 captured=- now=S@6,0#${b}`,
		]);
	});

	it('reads the same stakes before and after each capture square is folded', async function () {
		// Folding a square is a reveal that touches it: carol's queen leaving
		// (6,6) folds dave's capture, and the two pieces failing on the stone
		// fold bob's. TWO SOURCES, ONE ANSWER: nothing a registry says moves.
		const holdings = async (w: World) =>
			(await w.registry()).map((r) => [r.status, r.stake, r.capturedBy]);
		const s = await chain('forward');
		const {w, a, b, c, stakes} = s;
		const before = await holdings(w);
		const reserves = async () =>
			Promise.all(
				[b, c, s.d].map(
					(id) =>
						w.env.read(w.Game, {
							functionName: 'getReserve',
							args: [id],
						}) as Promise<bigint>,
				),
			);
		expect(await reserves()).toEqual([
			stakes.get(b)!,
			stakes.get(c)!,
			stakes.get(s.d)!,
		]);
		await w.play([
			{owner: w.carol, army: c, moves: [move([6, 6], [6, 4])]},
			{owner: w.alice, army: a, moves: [move([2, 1], [3, 1])]},
		]);
		expect(await holdings(w)).toEqual(before);
		// dave's capture is folded: his reserve moved up into carol's.
		expect(await reserves()).toEqual([
			stakes.get(b)!,
			stakes.get(c)! + stakes.get(s.d)!,
			0n,
		]);
		await w.play([{owner: w.alice, army: a, moves: [move([3, 1], [4, 1])]}]);
		await w.play([{owner: w.alice, army: a, moves: [move([4, 1], [5, 1])]}]);
		// The two arrivals touch the stone's square, folding bob's capture:
		// it is a stone, so his reserve stays where it is.
		await w.play([
			{owner: w.alice, army: a, moves: [move([5, 1], [6, 0])]},
			{owner: w.carol, army: c, moves: [move([6, 4], [6, 0])]},
		]);
		expect(await holdings(w)).toEqual(before);
		expect((await reserves())[0]).toEqual(stakes.get(b)!);
	});
});

describe('two armies of one owner taking each other', function () {
	it("gains that owner nothing: both kings are stones, each holding its own army's stake", async function () {
		// alice owns both: P at (0,0) and Q at (0,6). P's king steps into its
		// empty core square (1,0), and P's knight goes round to (0,3); Q's
		// rook steps aside, Q's king walks out to its corner (2,4), and Q's
		// knight goes round to (2,2). Then both knights take.
		const {w, p, q, stakes, account} = await inEveryOrder(async (order) => {
			const w = await world();
			const [p, q] = await w.deploy([
				[w.alice, [0, 0]],
				[w.alice, [0, 1]],
			]);
			const stakes = new Map((await w.registry()).map((r) => [r.id, r.stake]));
			const walks: [ReturnType<typeof move>[], ReturnType<typeof move>[]][] = [
				[[move([0, 1], [2, 2])], [move([1, 5], [1, 6])]],
				[[move([2, 2], [0, 3])], [move([0, 6], [1, 5])]],
				[[move([0, 0], [1, 0])], [move([1, 5], [2, 4])]],
				[[], [move([0, 5], [1, 3])]],
				[[], [move([1, 3], [3, 4])]],
				[[], [move([3, 4], [2, 2])]],
				[[move([0, 3], [2, 4])], [move([2, 2], [1, 0])]],
			];
			for (const [pMoves, qMoves] of walks) {
				await w.play(
					[
						{owner: w.alice, army: p, moves: pMoves},
						{owner: w.alice, army: q, moves: qMoves},
					],
					order,
				);
			}
			const account = (await w.env.read(w.Game, {
				functionName: 'getReserve',
				args: [BigInt(w.alice)],
			})) as bigint;
			return {w, p, q, stakes, account};
		});
		expect(await w.board()).toEqual([`S@1,0#${p}`, `S@2,4#${q}`].sort());
		const registry = await w.registry();
		expect(registry.map((r) => [r.status, r.capturedBy, r.stake])).toEqual([
			[CAPTURED, 0n, stakes.get(p)!],
			[CAPTURED, 0n, stakes.get(q)!],
		]);
		expect(account).toEqual(0n);
	});
});

/**
 * A KING CAPTURING ONTO AN EXIT. carol's king walks out by her corner (2,4)
 * and lands on the exit (3,3) with two other pieces (bob's pawn and dave's
 * bishop), so it survives the crowd and does NOT exit. alice's king arrives
 * next to it, on (3,2), in that cycle, and in the next steps alone onto it:
 * it takes carol's king and exits in the same move, so the king it took
 * stays a stone on the exit.
 */
async function kingOntoAnExit(order: RevealOrder) {
	const w = await world();
	const [a, b, c, d] = await w.deploy([
		[w.alice, [0, 0]],
		[w.bob, [1, 0]],
		[w.carol, [0, 1]],
		[w.dave, [1, 1]],
	]);
	const stakes = new Map((await w.registry()).map((r) => [r.id, r.stake]));
	const cycles: [bigint, ReturnType<typeof move>][][] = [
		[
			[a, move([2, 1], [3, 1])],
			[c, move([1, 5], [1, 6])],
			[b, move([4, 1], [4, 2])],
		],
		[
			[a, move([0, 0], [1, 0])],
			[c, move([0, 6], [1, 5])],
			[b, move([4, 2], [4, 3])],
		],
		[
			[a, move([1, 0], [2, 1])],
			[c, move([1, 5], [2, 4])],
		],
		[
			[a, move([2, 1], [3, 2])],
			[c, move([2, 4], [3, 3])],
			[b, move([4, 3], [3, 3])],
			[d, move([5, 5], [3, 3])],
		],
	];
	const owner = new Map([
		[a, w.alice],
		[b, w.bob],
		[c, w.carol],
		[d, w.dave],
	]);
	for (const moves of cycles) {
		await w.play(
			moves.map(([army, m]) => ({owner: owner.get(army)!, army, moves: [m]})),
			order,
		);
	}
	return {w, a, b, c, d, stakes};
}

describe('a king capturing onto an exit', function () {
	it('takes the king there and exits, leaving what it took as a stone that its exit does not pay', async function () {
		const {w, a, c, stakes} = await inEveryOrder(async (order) => {
			const s = await kingOntoAnExit(order);
			expect(await s.w.pieceAt(3, 3)).toEqual(`K@3,3#${s.c}`);
			await s.w.play(
				[
					{owner: s.w.alice, army: s.a, moves: [move([3, 2], [3, 3])]},
					{owner: s.w.carol, army: s.c, moves: []},
				],
				order,
			);
			return s;
		});
		expect(await w.pieceAt(3, 3)).toEqual(`S@3,3#${c}`);
		expect(await piecesOf(w, a)).toEqual([]);
		expect(await piecesOf(w, c)).toEqual([`S@3,3#${c}`]);
		const alice = await entry(w, a);
		expect([alice.status, alice.stake]).toEqual([EXITED, stakes.get(a)!]);
		const carol = await entry(w, c);
		expect([carol.status, carol.capturedBy, carol.stake]).toEqual([
			CAPTURED,
			0n,
			stakes.get(c)!,
		]);
		await w.env.execute(w.Game, {
			account: w.bob,
			functionName: 'exit',
			args: [a],
		});
		expect(
			await w.env.read(w.Game, {functionName: 'getReserve', args: [c]}),
		).toEqual(stakes.get(c)!);
	});
});

describe("a stone's own moves", function () {
	const piece = (x: number, y: number, army: bigint, kind: number): Piece => ({
		position: at(x, y),
		army,
		kind,
	});

	it('never moves, may have a king beside it, blocks a path and can be captured', async function () {
		const w = await world();
		const board = [
			piece(0, 0, 1n, 6), // a king
			piece(2, 0, 2n, STONE),
			piece(5, 0, 1n, 4), // a rook
		];
		const legal = async (x: number, y: number) =>
			(
				(await w.env.read(w.Game, {
					functionName: 'legalMoves',
					args: [board, at(x, y)],
				})) as bigint[]
			).length;
		expect(await legal(2, 0)).toEqual(0);
		// All eight of the king's squares, (1,0) next to the stone included.
		expect(await legal(0, 0)).toEqual(8);
		// The rook reaches (4,0), (3,0) and the stone, not beyond.
		const rook = (await w.env.read(w.Game, {
			functionName: 'legalMoves',
			args: [board, at(5, 0)],
		})) as bigint[];
		expect(rook.includes(at(2, 0))).toEqual(true);
		expect(rook.includes(at(1, 0))).toEqual(false);
		expect(
			await w.env.read(w.Game, {functionName: 'materialOf', args: [STONE]}),
		).toEqual(0n);
	});
});
