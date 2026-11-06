import {expect} from 'earl';
import {describe, it} from 'node:test'; // using node:test as hardhat v3 do not support vitest
import {network} from 'hardhat';
import {setupFixtures} from './utils/index.js';
import {
	movesWorld,
	move,
	REVEAL_ORDERS,
	type RevealOrder,
} from './utils/moves-world.js';

/**
 * KING CAPTURE, WITHOUT MERGES (`docs/adr/0013-no-merges-a-captured-army-vanishes-and-its-captor-is-promoted.md`)
 * and the king rows of the collision table
 * (`docs/adr/0003-collision-table-king-survives-a-crowd.md`, its moving-king
 * row amended by 0013):
 *
 * | On the square       | Arrivals                     | Outcome                                             |
 * |---------------------|------------------------------|-----------------------------------------------------|
 * | empty               | a king + exactly 1 enemy     | the king dies, the enemy lands as a queen, with its stake |
 * | empty               | a king + 2+ enemies          | the king lands, they die                            |
 * | a piece that stayed | a king + exactly 1 enemy     | the king dies, the enemy lands as a queen on the piece |
 * | a king that stayed  | a king + exactly 1 enemy     | that enemy takes both kings, and both stakes        |
 * | a piece that stayed | a king + 2+ enemies          | the king captures it, the others die                |
 * | a king that stayed  | 1 piece                      | captured: the piece lands as a queen (a king stays a king) |
 * | a king that stayed  | 2+ pieces                    | it stays, they die                                  |
 *
 * A captured army's pieces leave the board from the next cycle, and its whole
 * stake is its captor's. EVERY SCENARIO IS PLAYED IN SEVERAL REVEAL ORDERS,
 * and the boards, registries (owner, status, stake, captured-by) and cycle
 * outcomes must be identical (`docs/adr/0002-order-free-lazy-resolution.md`).
 *
 * The world is `utils/moves-world.ts`'s, with a fourth army: alice at spawn
 * (0,0), bob at (6,0), carol at (0,6) and dave at (6,6), every king on its
 * spawn point. The only empty square next to alice's king is her empty core
 * square (1,0), and a knight is what reaches it, from (3,1), (2,2) or (3,-1):
 *
 *   dave's knight (6,5), by (4,4) and (2,3), to (3,1);
 *   carol's knight (0,5), by (1,3) and (3,4), to (2,2);
 *   bob's knight (6,-1), by (4,-2) and (2,-3), to (3,-1).
 *
 * A standing king is taken by dave's knight, which reaches bob's king (6,0)
 * by (7,3) and bob's pawn (5,2).
 */

const {provider, networkHelpers} = await network.connect();
const {deployAll} = setupFixtures(provider);
const world = movesWorld({
	deployAll,
	loadFixture: networkHelpers.loadFixture,
});

type World = Awaited<ReturnType<typeof world>>;
type Order = RevealOrder;

const DEPLOYED = 2;
const CAPTURED = 6;

/** alice, bob, carol and dave, deployed, at the top of the cycle they act in. */
async function fourArmies() {
	const w = await world();
	const [a, b, c, d] = await w.deploy([
		[w.alice, [0, 0]],
		[w.bob, [1, 0]],
		[w.carol, [0, 1]],
		[w.dave, [1, 1]],
	]);
	const stakes = new Map((await w.registry()).map((r) => [r.id, r.stake]));
	return {w, a, b, c, d, stakes};
}

type Armies = Awaited<ReturnType<typeof fourArmies>>;

type Knight = 'bob' | 'carol' | 'dave';
const KNIGHT_PATHS: Record<Knight, ReturnType<typeof move>[]> = {
	dave: [move([6, 5], [4, 4]), move([4, 4], [2, 3]), move([2, 3], [3, 1])],
	carol: [move([0, 5], [1, 3]), move([1, 3], [3, 4]), move([3, 4], [2, 2])],
	bob: [move([6, -1], [4, -2]), move([4, -2], [2, -3]), move([2, -3], [3, -1])],
};
/** Where each knight lands on alice's core square (1,0) from. */
const KNIGHT_AT: Record<Knight, [number, number]> = {
	dave: [3, 1],
	carol: [2, 2],
	bob: [3, -1],
};

/** The knights of `who`, brought round alice's core square in three cycles. */
async function knightsAround(s: Armies, order: Order, who: readonly Knight[]) {
	const {w} = s;
	const army = {bob: s.b, carol: s.c, dave: s.d};
	const owner = {bob: w.bob, carol: w.carol, dave: w.dave};
	for (let k = 0; k < 3; k++) {
		await w.play(
			who.map((name) => ({
				owner: owner[name],
				army: army[name],
				moves: [KNIGHT_PATHS[name][k]],
			})),
			order,
		);
	}
}

/** `name`'s knight, from where {knightsAround} left it, onto (1,0). */
function knightOnto(s: Armies, name: Knight) {
	const army = {bob: s.b, carol: s.c, dave: s.d};
	const owner = {bob: s.w.bob, carol: s.w.carol, dave: s.w.dave};
	return {
		owner: owner[name],
		army: army[name],
		moves: [move(KNIGHT_AT[name], [1, 0])],
	};
}

/** alice's king onto her empty core square (1,0). */
const aliceKing = (s: Armies) => ({
	owner: s.w.alice,
	army: s.a,
	moves: [move([0, 0], [1, 0])],
});

/** What a scenario left: the board, the registry and the cycle's outcomes. */
async function snapshot(w: World) {
	return {
		board: await w.board(),
		registry: await w.registry(),
		outcomes: (await w.outcomes()).lines,
	};
}

/**
 * Play `scenario` in every reveal order of `REVEAL_ORDERS`: the same state
 * each time. Returns the last run.
 */
async function inEveryOrder<T extends {w: World}>(
	scenario: (order: Order) => Promise<T>,
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

/** The registry entry of `army`. */
async function entry(w: World, army: bigint) {
	const found = (await w.registry()).find((r) => r.id === army);
	if (!found) throw new Error(`no army ${army}`);
	return found;
}

/** Every piece of `army` on the board, as lines. */
async function piecesOf(w: World, army: bigint): Promise<string[]> {
	return (await w.board()).filter((l) => l.endsWith(`#${army}`));
}

/**
 * dave's knight jumps to (7,3), takes bob's pawn on (5,2), and takes bob's
 * king on (6,0).
 */
async function knightTakesKing(order: Order) {
	const s = await fourArmies();
	const {w, b, d} = s;
	await w.play([{owner: w.dave, army: d, moves: [move([6, 5], [7, 3])]}]);
	await w.play([{owner: w.dave, army: d, moves: [move([7, 3], [5, 2])]}]);
	// bob passes in the capture cycle, so there is an order to replay.
	await w.play(
		[
			{owner: w.dave, army: d, moves: [move([5, 2], [6, 0])]},
			{owner: w.bob, army: b, moves: []},
		],
		order,
	);
	return s;
}

describe('capturing a king', function () {
	it('promotes the lone piece that takes a standing king to a queen, empties the captured army from the board and gives its captor its stake', async function () {
		const {w, b, d, stakes} = await inEveryOrder(knightTakesKing);
		expect(await w.pieceAt(6, 0)).toEqual(`Q@6,0#${d}`);
		// Every piece of bob's has left the board: none is anybody's now.
		expect(await piecesOf(w, b)).toEqual([]);
		expect(await w.pieceAt(4, 0)).toEqual(undefined);
		expect(await w.pieceAt(8, 0)).toEqual(undefined);
		expect((await piecesOf(w, d)).length).toEqual(20);

		const bob = await entry(w, b);
		expect([bob.status, bob.capturedBy, bob.owner, bob.stake]).toEqual([
			CAPTURED,
			d,
			w.bob,
			0n,
		]);
		const dave = await entry(w, d);
		expect([dave.status, dave.capturedBy]).toEqual([DEPLOYED, 0n]);
		expect(dave.stake).toEqual(stakes.get(d)! + stakes.get(b)!);
		expect((await w.outcomes()).lines).toEqual([
			`6,0 died=0 captured=K@6,0#${b} now=Q@6,0#${d}`,
		]);
	});

	it("reads the captured army's pieces as empty squares on a path, and leaves it unable to commit", async function () {
		const {w, b, d} = await knightTakesKing('forward');
		await expect(w.commit(w.bob, b, [])).toBeRejectedWith('NotInGame');
		// Through bob's knight and pawn, into the gap below.
		await w.play([{owner: w.dave, army: d, moves: [move([6, 0], [6, -3])]}]);
		expect(await w.pieceAt(6, -3)).toEqual(`Q@6,-3#${d}`);
		// Nobody can move bob's pieces: they are not on the board.
		await expect(
			w.play([{owner: w.dave, army: d, moves: [move([4, 0], [3, 0])]}]),
		).toBeRejectedWith('IllegalMove');
	});
});

describe('the collision table, king rows', function () {
	it('kills a moving king that meets exactly one enemy piece on an empty square, and lands that piece as a queen with its stake', async function () {
		const {w, a, d, stakes} = await inEveryOrder(async (order) => {
			const s = await fourArmies();
			await knightsAround(s, order, ['dave']);
			await s.w.play([aliceKing(s), knightOnto(s, 'dave')], order);
			return s;
		});
		expect(await w.pieceAt(1, 0)).toEqual(`Q@1,0#${d}`);
		expect(await w.pieceAt(0, 0)).toEqual(undefined);
		expect(await piecesOf(w, a)).toEqual([]);
		const alice = await entry(w, a);
		expect([alice.status, alice.capturedBy, alice.stake]).toEqual([
			CAPTURED,
			d,
			0n,
		]);
		expect((await entry(w, d)).stake).toEqual(stakes.get(d)! + stakes.get(a)!);
		expect((await w.outcomes()).lines).toEqual([
			`1,0 died=1 captured=- now=Q@1,0#${d}`,
		]);
	});

	it('lands a moving king that meets two or more enemy pieces on an empty square, and kills them', async function () {
		const {w, a, stakes} = await inEveryOrder(async (order) => {
			const s = await fourArmies();
			await knightsAround(s, order, ['dave', 'carol']);
			await s.w.play(
				[aliceKing(s), knightOnto(s, 'dave'), knightOnto(s, 'carol')],
				order,
			);
			return s;
		});
		expect(await w.pieceAt(1, 0)).toEqual(`K@1,0#${a}`);
		expect(await w.pieceAt(3, 1)).toEqual(undefined);
		expect(await w.pieceAt(2, 2)).toEqual(undefined);
		const registry = await w.registry();
		expect(registry.map((r) => r.status)).toEqual([
			DEPLOYED,
			DEPLOYED,
			DEPLOYED,
			DEPLOYED,
		]);
		expect(registry.map((r) => r.stake)).toEqual([...stakes.values()]);
		expect((await entry(w, a)).king).toEqual({x: 1, y: 0});
		expect((await w.outcomes()).lines).toEqual([
			`1,0 died=2 captured=- now=K@1,0#${a}`,
		]);
	});

	/** All three knights round, and bob's lands on (1,0), to stay there. */
	async function knightOnTheSquare(s: Armies, order: Order) {
		await knightsAround(s, order, ['bob', 'carol', 'dave']);
		await s.w.play([knightOnto(s, 'bob')], order);
	}

	it('kills a moving king that meets exactly one enemy piece on a piece that stayed, and lands that piece as a queen, capturing it', async function () {
		const {w, a, b, d, stakes} = await inEveryOrder(async (order) => {
			const s = await fourArmies();
			await knightOnTheSquare(s, order);
			await s.w.play([aliceKing(s), knightOnto(s, 'dave')], order);
			return s;
		});
		expect(await w.pieceAt(1, 0)).toEqual(`Q@1,0#${d}`);
		expect(await w.pieceAt(3, 1)).toEqual(undefined);
		expect(await piecesOf(w, a)).toEqual([]);
		const alice = await entry(w, a);
		expect([alice.status, alice.capturedBy, alice.stake]).toEqual([
			CAPTURED,
			d,
			0n,
		]);
		expect((await entry(w, d)).stake).toEqual(stakes.get(d)! + stakes.get(a)!);
		expect((await w.outcomes()).lines).toEqual([
			`1,0 died=1 captured=N@1,0#${b} now=Q@1,0#${d}`,
		]);
	});

	it('lets a moving king that meets two or more enemy pieces on a piece that stayed capture it, and kills the others', async function () {
		const {w, a, b} = await inEveryOrder(async (order) => {
			const s = await fourArmies();
			await knightOnTheSquare(s, order);
			await s.w.play(
				[aliceKing(s), knightOnto(s, 'dave'), knightOnto(s, 'carol')],
				order,
			);
			return s;
		});
		expect(await w.pieceAt(1, 0)).toEqual(`K@1,0#${a}`);
		expect(await w.pieceAt(3, 1)).toEqual(undefined);
		expect(await w.pieceAt(2, 2)).toEqual(undefined);
		expect((await w.registry()).map((r) => r.status)).toEqual([
			DEPLOYED,
			DEPLOYED,
			DEPLOYED,
			DEPLOYED,
		]);
		expect((await w.outcomes()).lines).toEqual([
			`1,0 died=2 captured=N@1,0#${b} now=K@1,0#${a}`,
		]);
	});

	it('keeps a king that stayed when two or more pieces reach it, as any piece that stayed', async function () {
		const {w, a} = await inEveryOrder(async (order) => {
			const s = await fourArmies();
			await knightsAround(s, order, ['dave', 'carol']);
			await s.w.play([aliceKing(s)], order);
			await s.w.play([knightOnto(s, 'dave'), knightOnto(s, 'carol')], order);
			return s;
		});
		expect(await w.pieceAt(1, 0)).toEqual(`K@1,0#${a}`);
		expect((await entry(w, a)).status).toEqual(DEPLOYED);
		expect((await w.outcomes()).lines).toEqual([
			`1,0 died=2 captured=- now=K@1,0#${a}`,
		]);
	});
});

/**
 * KINGS FACE TO FACE: alice's bishop and carol's rook step aside, then
 * alice's king (0,0) and carol's (0,6) walk until they stand next to each
 * other, alice's on (2,2) and carol's on (2,3), both moving in the cycle they
 * meet (kings may END a cycle adjacent). bob's knight, by his empty corner
 * (4,2), is then one jump from (2,3).
 *
 * `withDave` deploys dave too, at (6,6), and brings his knight by (7,3) to
 * bob's pawn (5,2), one jump from bob's king (6,0). alice's bishop then steps
 * aside to (4,4) rather than onto dave's bishop (5,5).
 */
async function kingsFaceToFace(order: Order, withDave = false) {
	const w = await world();
	const [a, b, c, d] = await w.deploy([
		[w.alice, [0, 0]],
		[w.bob, [1, 0]],
		[w.carol, [0, 1]],
		...(withDave
			? [[w.dave, [1, 1]] as [`0x${string}`, [number, number]]]
			: []),
	]);
	const stakes = new Map((await w.registry()).map((r) => [r.id, r.stake]));
	const alice = (m: ReturnType<typeof move>) => ({
		owner: w.alice,
		army: a,
		moves: [m],
	});
	const carol = (m: ReturnType<typeof move>) => ({
		owner: w.carol,
		army: c,
		moves: [m],
	});
	const bob = (m: ReturnType<typeof move>) => ({
		owner: w.bob,
		army: b,
		moves: [m],
	});
	const dave = (m: ReturnType<typeof move>) =>
		withDave ? [{owner: w.dave, army: d, moves: [m]}] : [];
	const cycles = [
		[
			alice(move([1, 1], withDave ? [4, 4] : [5, 5])),
			carol(move([1, 5], [1, 6])),
			bob(move([6, 1], [4, 2])),
			...dave(move([6, 5], [7, 3])),
		],
		[carol(move([0, 6], [1, 5])), ...dave(move([7, 3], [5, 2]))],
		[alice(move([0, 0], [1, 1])), carol(move([1, 5], [2, 4]))],
		[alice(move([1, 1], [2, 2])), carol(move([2, 4], [2, 3]))],
	];
	for (const submissions of cycles) await w.play(submissions, order);
	return {w, a, b, c, d, stakes};
}

describe('a king that takes a king', function () {
	it('stays a king, and takes the stake', async function () {
		const {w, a, c, stakes} = await inEveryOrder(async (order) => {
			const s = await kingsFaceToFace(order);
			await s.w.play(
				[
					{owner: s.w.alice, army: s.a, moves: [move([2, 2], [2, 3])]},
					{owner: s.w.carol, army: s.c, moves: []},
				],
				order,
			);
			return s;
		});
		expect(await w.pieceAt(2, 3)).toEqual(`K@2,3#${a}`);
		expect(await piecesOf(w, c)).toEqual([]);
		expect((await entry(w, c)).capturedBy).toEqual(a);
		expect((await entry(w, a)).stake).toEqual(stakes.get(a)! + stakes.get(c)!);
	});
});

describe('the two-victim square', function () {
	it("gives both kings, and both stakes, to the one piece that meets a moving king on a king's square", async function () {
		const {w, a, b, c, stakes} = await inEveryOrder(async (order) => {
			const s = await kingsFaceToFace(order);
			await s.w.play(
				[
					{owner: s.w.alice, army: s.a, moves: [move([2, 2], [2, 3])]},
					{owner: s.w.bob, army: s.b, moves: [move([4, 2], [2, 3])]},
					{owner: s.w.carol, army: s.c, moves: []},
				],
				order,
			);
			return s;
		});
		expect(await w.pieceAt(2, 3)).toEqual(`Q@2,3#${b}`);
		expect(await piecesOf(w, a)).toEqual([]);
		expect(await piecesOf(w, c)).toEqual([]);
		const registry = await w.registry();
		expect(registry.map((r) => [r.status, r.capturedBy])).toEqual([
			[CAPTURED, b],
			[DEPLOYED, 0n],
			[CAPTURED, b],
		]);
		expect((await entry(w, b)).stake).toEqual(
			stakes.get(a)! + stakes.get(c)! + stakes.get(b)!,
		);
		expect((await w.outcomes()).lines).toEqual([
			`2,3 died=1 captured=K@2,3#${c} now=Q@2,3#${b}`,
		]);
	});

	/**
	 * As above, but in the same cycle dave's knight takes bob's king on
	 * (6,0): the piece that meets alice's king on carol's square is bob's, and
	 * bob's king falls with it.
	 */
	async function captorFalls(order: Order) {
		const s = await kingsFaceToFace(order, true);
		await s.w.play(
			[
				{owner: s.w.alice, army: s.a, moves: [move([2, 2], [2, 3])]},
				{owner: s.w.bob, army: s.b, moves: [move([4, 2], [2, 3])]},
				{owner: s.w.carol, army: s.c, moves: []},
				{owner: s.w.dave, army: s.d, moves: [move([5, 2], [6, 0])]},
			],
			order,
		);
		return s;
	}

	const reserves = (w: World, armies: bigint[]) =>
		Promise.all(
			armies.map(
				(id) =>
					w.env.read(w.Game, {
						functionName: 'getReserve',
						args: [id],
					}) as Promise<bigint>,
			),
		);
	const sum = (values: bigint[]) => values.reduce((x, y) => x + y, 0n);

	it("leaves the king that stood there as the stone, holding the moving king's stake too, when the captor's own king falls that cycle", async function () {
		// One stone per square (`docs/adr/0014`): carol's king stays as the
		// stone, alice's stake goes into carol's army, and bob's knight vanishes
		// with bob, whose stake is dave's.
		const {w, a, b, c, d, stakes} = await inEveryOrder(captorFalls);
		expect(await w.pieceAt(2, 3)).toEqual(`S@2,3#${c}`);
		expect(await w.pieceAt(6, 0)).toEqual(`Q@6,0#${d}`);
		expect(await piecesOf(w, a)).toEqual([]);
		expect(await piecesOf(w, b)).toEqual([]);
		expect(await piecesOf(w, c)).toEqual([`S@2,3#${c}`]);
		const registry = await w.registry();
		expect(registry.map((r) => [r.status, r.capturedBy, r.stake])).toEqual([
			[CAPTURED, c, 0n],
			[CAPTURED, d, 0n],
			[CAPTURED, 0n, stakes.get(c)! + stakes.get(a)!],
			[DEPLOYED, 0n, stakes.get(d)! + stakes.get(b)!],
		]);
		// Nothing is stranded or lost.
		const total = sum([...stakes.values()]);
		expect(sum(registry.map((r) => r.stake))).toEqual(total);
		expect(sum(await reserves(w, [a, b, c, d]))).toEqual(total);
		expect((await w.outcomes()).lines).toEqual([
			`2,3 died=1 captured=K@2,3#${c} now=S@2,3#${c}`,
			`6,0 died=0 captured=K@6,0#${b} now=Q@6,0#${d}`,
		]);
	});

	it('reads the same stakes before and after the square is folded, when the captor falls', async function () {
		const holdings = async (w: World) =>
			(await w.registry()).map((r) => [r.status, r.stake, r.capturedBy]);
		const s = await captorFalls('forward');
		const {w, a, b, c, d, stakes} = s;
		const before = await holdings(w);
		// Nothing folded yet: every reserve is where it was.
		expect(await reserves(w, [a, b, c, d])).toEqual([
			stakes.get(a)!,
			stakes.get(b)!,
			stakes.get(c)!,
			stakes.get(d)!,
		]);
		// dave's queen leaving (6,0) folds bob's capture.
		await w.play([{owner: w.dave, army: d, moves: [move([6, 0], [6, 3])]}]);
		expect(await holdings(w)).toEqual(before);
		expect(await reserves(w, [a, b, c, d])).toEqual([
			stakes.get(a)!,
			0n,
			stakes.get(c)!,
			stakes.get(d)! + stakes.get(b)!,
		]);
		// Taking the stone touches (2,3), folding the two-victim capture first:
		// alice's reserve goes into carol's, which the stone then gives dave.
		await w.play([{owner: w.dave, army: d, moves: [move([6, 3], [2, 3])]}]);
		expect(await w.pieceAt(2, 3)).toEqual(`Q@2,3#${d}`);
		const after = await holdings(w);
		expect([after[0], after[1]]).toEqual([before[0], before[1]]);
		expect(after[2]).toEqual([CAPTURED, 0n, d]);
		expect(after[3]).toEqual([
			DEPLOYED,
			(before[3][1] as bigint) + (before[2][1] as bigint),
			0n,
		]);
		expect(await reserves(w, [a, b, c, d])).toEqual([
			0n,
			0n,
			stakes.get(c)! + stakes.get(a)!,
			stakes.get(d)! + stakes.get(b)!,
		]);
	});
});

const offline = movesWorld({
	deployAll,
	loadFixture: networkHelpers.loadFixture,
	manual: true,
});

describe('a capture in the offline world', function () {
	it('keeps the world advancing: the captured army is no longer waited for', async function () {
		const w = await offline();
		const armies = await w.deploy([
			[w.alice, [0, 0]],
			[w.bob, [1, 0]],
			[w.carol, [0, 1]],
			[w.dave, [1, 1]],
		]);
		const [, b, , d] = armies;
		const owners = [w.alice, w.bob, w.carol, w.dave];
		/** One cycle in which dave plays `moves` and every other army passes. */
		async function cycle(moves: ReturnType<typeof move>[], alive = armies) {
			await w.play(
				alive.map((army) => ({
					owner: owners[armies.indexOf(army)],
					army,
					moves: army === d ? moves : [],
				})),
			);
		}
		await cycle([move([6, 5], [7, 3])]);
		await cycle([move([7, 3], [5, 2])]);
		await cycle([move([5, 2], [6, 0])]);
		expect((await w.registry())[1].status).toEqual(CAPTURED);

		const attendance = (await w.env.read(w.Game, {
			functionName: 'getAttendance',
		})) as {waitedFor: bigint};
		expect(attendance.waitedFor).toEqual(3n);
		// bob never commits again, and the world goes on without him.
		const alive = armies.filter((army) => army !== b);
		await cycle([move([6, 0], [6, -3])], alive);
		await cycle([], alive);
		expect(await w.pieceAt(6, -3)).toEqual(`Q@6,-3#${d}`);
	});
});
