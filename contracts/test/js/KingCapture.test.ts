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
 * (0,0), bob at (6,0) facing East with his king on (6,1), carol at (0,6) and
 * dave at (6,6), both facing North. The only empty square next to bob's king
 * is (7,2), and the pieces brought to it are:
 *
 *   dave's queen (7,5), to (8,4) then (8,3): from there it reaches (7,2);
 *   carol's queen (1,5), to (3,3) then (7,3) (or (6,3)), next to (7,2);
 *   dave's pawn (7,4), facing South, to (7,3) then (7,2), from where it can
 *     take bob's king on (6,1) diagonally.
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

/** dave's queen to (8,3) and, unless told not to, carol's to (7,3). */
async function queensAround(s: Armies, order: Order, carol = true) {
	const {w, c, d} = s;
	await w.play(
		[
			{owner: w.dave, army: d, moves: [move([7, 5], [8, 4])]},
			...(carol
				? [{owner: w.carol, army: c, moves: [move([1, 5], [3, 3])]}]
				: []),
		],
		order,
	);
	await w.play(
		[
			{owner: w.dave, army: d, moves: [move([8, 4], [8, 3])]},
			...(carol
				? [{owner: w.carol, army: c, moves: [move([3, 3], [7, 3])]}]
				: []),
		],
		order,
	);
}

/**
 * dave's pawn onto (7,2), to stay there, carol's queen to (7,3) behind it, and
 * alice's queen round to (6,3): two enemies of bob's king that can reach the
 * square, with the pawn on it.
 */
async function pawnOnTheSquare(s: Armies, order: Order) {
	const {w, a, c, d} = s;
	await w.play(
		[
			{owner: w.dave, army: d, moves: [move([7, 4], [7, 3])]},
			{owner: w.carol, army: c, moves: [move([1, 5], [3, 3])]},
			{owner: w.alice, army: a, moves: [move([1, -1], [2, -2])]},
		],
		order,
	);
	await w.play(
		[
			{owner: w.dave, army: d, moves: [move([7, 3], [7, 2])]},
			{owner: w.carol, army: c, moves: [move([3, 3], [7, 3])]},
			{owner: w.alice, army: a, moves: [move([2, -2], [3, -1])]},
		],
		order,
	);
	await w.play([{owner: w.alice, army: a, moves: [move([3, -1], [3, 3])]}]);
	await w.play([{owner: w.alice, army: a, moves: [move([3, 3], [6, 3])]}]);
}

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
	return (await w.board()).filter((l) => l.includes(`#${army}:`));
}

/** dave's pawn walks to (7,2) and takes bob's king on (6,1). */
async function pawnTakesKing(order: Order) {
	const s = await fourArmies();
	const {w, b, d} = s;
	await w.play([{owner: w.dave, army: d, moves: [move([7, 4], [7, 3])]}]);
	await w.play([{owner: w.dave, army: d, moves: [move([7, 3], [7, 2])]}]);
	// bob passes in the capture cycle, so there is an order to replay.
	await w.play(
		[
			{owner: w.dave, army: d, moves: [move([7, 2], [6, 1])]},
			{owner: w.bob, army: b, moves: []},
		],
		order,
	);
	return s;
}

describe('capturing a king', function () {
	it('promotes the lone piece that takes a standing king to a queen, empties the captured army from the board and gives its captor its stake', async function () {
		const {w, b, d, stakes} = await inEveryOrder(pawnTakesKing);
		expect(await w.pieceAt(6, 1)).toEqual(`Q@6,1#${d}:N*`);
		// Every piece of bob's has left the board: none is anybody's now.
		expect(await piecesOf(w, b)).toEqual([]);
		expect(await w.pieceAt(4, 0)).toEqual(undefined);
		expect(await w.pieceAt(7, 0)).toEqual(undefined);
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
			`6,1 died=0 captured=K@6,1#${b}:E now=Q@6,1#${d}:N*`,
		]);
	});

	it("reads the captured army's pieces as empty squares on a path, and leaves it unable to commit", async function () {
		const {w, b, d} = await pawnTakesKing('forward');
		await expect(w.commit(w.bob, b, [])).toBeRejectedWith('NotInGame');
		// Through bob's bishop, knight and rook, onto his pawn's square.
		await w.play([{owner: w.dave, army: d, moves: [move([6, 1], [6, -3])]}]);
		expect(await w.pieceAt(6, -3)).toEqual(`Q@6,-3#${d}:N*`);
		// Nobody can move bob's pieces: they are not on the board.
		await expect(
			w.play([{owner: w.dave, army: d, moves: [move([4, 0], [3, 0])]}]),
		).toBeRejectedWith('IllegalMove');
	});
});

describe('the collision table, king rows', function () {
	it('kills a moving king that meets exactly one enemy piece on an empty square, and lands that piece as a queen with its stake', async function () {
		const {w, b, d, stakes} = await inEveryOrder(async (order) => {
			const s = await fourArmies();
			await s.w.play([
				{owner: s.w.dave, army: s.d, moves: [move([7, 4], [7, 3])]},
			]);
			await s.w.play(
				[
					{owner: s.w.bob, army: s.b, moves: [move([6, 1], [7, 2])]},
					{owner: s.w.dave, army: s.d, moves: [move([7, 3], [7, 2])]},
				],
				order,
			);
			return s;
		});
		expect(await w.pieceAt(7, 2)).toEqual(`Q@7,2#${d}:N*`);
		expect(await w.pieceAt(6, 1)).toEqual(undefined);
		expect(await piecesOf(w, b)).toEqual([]);
		const bob = await entry(w, b);
		expect([bob.status, bob.capturedBy, bob.stake]).toEqual([CAPTURED, d, 0n]);
		expect((await entry(w, d)).stake).toEqual(stakes.get(d)! + stakes.get(b)!);
		expect((await w.outcomes()).lines).toEqual([
			`7,2 died=1 captured=- now=Q@7,2#${d}:N*`,
		]);
	});

	it('lands a moving king that meets two or more enemy pieces on an empty square, and kills them', async function () {
		const {w, b, stakes} = await inEveryOrder(async (order) => {
			const s = await fourArmies();
			await queensAround(s, order);
			await s.w.play(
				[
					{owner: s.w.bob, army: s.b, moves: [move([6, 1], [7, 2])]},
					{owner: s.w.dave, army: s.d, moves: [move([8, 3], [7, 2])]},
					{owner: s.w.carol, army: s.c, moves: [move([7, 3], [7, 2])]},
				],
				order,
			);
			return s;
		});
		expect(await w.pieceAt(7, 2)).toEqual(`K@7,2#${b}:E*`);
		expect(await w.pieceAt(7, 3)).toEqual(undefined);
		expect(await w.pieceAt(8, 3)).toEqual(undefined);
		const registry = await w.registry();
		expect(registry.map((r) => r.status)).toEqual([
			DEPLOYED,
			DEPLOYED,
			DEPLOYED,
			DEPLOYED,
		]);
		expect(registry.map((r) => r.stake)).toEqual([...stakes.values()]);
		expect((await entry(w, b)).king).toEqual({x: 7, y: 2});
		expect((await w.outcomes()).lines).toEqual([
			`7,2 died=2 captured=- now=K@7,2#${b}:E*`,
		]);
	});

	it('kills a moving king that meets exactly one enemy piece on a piece that stayed, and lands that piece as a queen, capturing it', async function () {
		const {w, b, c, d, stakes} = await inEveryOrder(async (order) => {
			const s = await fourArmies();
			await pawnOnTheSquare(s, order);
			await s.w.play(
				[
					{owner: s.w.bob, army: s.b, moves: [move([6, 1], [7, 2])]},
					{owner: s.w.carol, army: s.c, moves: [move([7, 3], [7, 2])]},
				],
				order,
			);
			return s;
		});
		expect(await w.pieceAt(7, 2)).toEqual(`Q@7,2#${c}:N*`);
		expect(await w.pieceAt(7, 3)).toEqual(undefined);
		expect(await piecesOf(w, b)).toEqual([]);
		const bob = await entry(w, b);
		expect([bob.status, bob.capturedBy, bob.stake]).toEqual([CAPTURED, c, 0n]);
		expect((await entry(w, c)).stake).toEqual(stakes.get(c)! + stakes.get(b)!);
		expect((await w.outcomes()).lines).toEqual([
			`7,2 died=1 captured=P@7,2#${d}:S* now=Q@7,2#${c}:N*`,
		]);
	});

	it('lets a moving king that meets two or more enemy pieces on a piece that stayed capture it, and kills the others', async function () {
		const {w, b, d} = await inEveryOrder(async (order) => {
			const s = await fourArmies();
			await pawnOnTheSquare(s, order);
			await s.w.play(
				[
					{owner: s.w.bob, army: s.b, moves: [move([6, 1], [7, 2])]},
					{owner: s.w.carol, army: s.c, moves: [move([7, 3], [7, 2])]},
					{owner: s.w.alice, army: s.a, moves: [move([6, 3], [7, 2])]},
				],
				order,
			);
			return s;
		});
		expect(await w.pieceAt(7, 2)).toEqual(`K@7,2#${b}:E*`);
		expect(await w.pieceAt(6, 3)).toEqual(undefined);
		expect(await w.pieceAt(7, 3)).toEqual(undefined);
		expect((await w.registry()).map((r) => r.status)).toEqual([
			DEPLOYED,
			DEPLOYED,
			DEPLOYED,
			DEPLOYED,
		]);
		expect((await w.outcomes()).lines).toEqual([
			`7,2 died=2 captured=P@7,2#${d}:S* now=K@7,2#${b}:E*`,
		]);
	});

	it('keeps a king that stayed when two or more pieces reach it, as any piece that stayed', async function () {
		const {w, b} = await inEveryOrder(async (order) => {
			const s = await fourArmies();
			await queensAround(s, order);
			await s.w.play(
				[{owner: s.w.bob, army: s.b, moves: [move([6, 1], [7, 2])]}],
				order,
			);
			await s.w.play(
				[
					{owner: s.w.dave, army: s.d, moves: [move([8, 3], [7, 2])]},
					{owner: s.w.carol, army: s.c, moves: [move([7, 3], [7, 2])]},
				],
				order,
			);
			return s;
		});
		expect(await w.pieceAt(7, 2)).toEqual(`K@7,2#${b}:E*`);
		expect((await entry(w, b)).status).toEqual(DEPLOYED);
		expect((await w.outcomes()).lines).toEqual([
			`7,2 died=2 captured=- now=K@7,2#${b}:E*`,
		]);
	});
});

/**
 * KINGS FACE TO FACE: alice's king (-2,0) and carol's (-2,6) walk until they
 * stand next to each other, alice's on (-2,3) and carol's on (-3,4), both
 * moving in the cycle they meet (kings may END a cycle adjacent). carol's
 * West pawn first takes the East pawn of dave, deployed at (-6,6), to clear
 * her king's way; dave's other East pawn, on (-4,5), then reaches (-3,4)
 * diagonally.
 */
async function kingsFaceToFace(order: Order) {
	const w = await world();
	const [a, c, d] = await w.deploy([
		[w.alice, [0, 0]],
		[w.carol, [0, 1]],
		[w.dave, [-1, 1]],
	]);
	const stakes = new Map((await w.registry()).map((r) => [r.id, r.stake]));
	const walks = [
		[move([-2, 0], [-3, 1]), move([-3, 5], [-4, 6])],
		[move([-3, 1], [-2, 2]), move([-2, 6], [-3, 5])],
		[move([-2, 2], [-2, 3]), move([-3, 5], [-3, 4])],
	];
	for (const [alice, carol] of walks) {
		await w.play(
			[
				{owner: w.alice, army: a, moves: [alice]},
				{owner: w.carol, army: c, moves: [carol]},
			],
			order,
		);
	}
	return {w, a, c, d, stakes};
}

describe('a king that takes a king', function () {
	it('stays a king, and takes the stake', async function () {
		const {w, a, c, stakes} = await inEveryOrder(async (order) => {
			const s = await kingsFaceToFace(order);
			await s.w.play(
				[
					{owner: s.w.alice, army: s.a, moves: [move([-2, 3], [-3, 4])]},
					{owner: s.w.carol, army: s.c, moves: []},
				],
				order,
			);
			return s;
		});
		expect(await w.pieceAt(-3, 4)).toEqual(`K@-3,4#${a}:N*`);
		expect(await piecesOf(w, c)).toEqual([]);
		expect((await entry(w, c)).capturedBy).toEqual(a);
		expect((await entry(w, a)).stake).toEqual(stakes.get(a)! + stakes.get(c)!);
	});
});

describe('the two-victim square', function () {
	it("gives both kings, and both stakes, to the one piece that meets a moving king on a king's square", async function () {
		const {w, a, c, d, stakes} = await inEveryOrder(async (order) => {
			const s = await kingsFaceToFace(order);
			await s.w.play(
				[
					{owner: s.w.alice, army: s.a, moves: [move([-2, 3], [-3, 4])]},
					{owner: s.w.dave, army: s.d, moves: [move([-4, 5], [-3, 4])]},
					{owner: s.w.carol, army: s.c, moves: []},
				],
				order,
			);
			return s;
		});
		expect(await w.pieceAt(-3, 4)).toEqual(`Q@-3,4#${d}:N*`);
		expect(await piecesOf(w, a)).toEqual([]);
		expect(await piecesOf(w, c)).toEqual([]);
		const registry = await w.registry();
		expect(registry.map((r) => [r.status, r.capturedBy])).toEqual([
			[CAPTURED, d],
			[CAPTURED, d],
			[DEPLOYED, 0n],
		]);
		expect((await entry(w, d)).stake).toEqual(
			stakes.get(a)! + stakes.get(c)! + stakes.get(d)!,
		);
		expect((await w.outcomes()).lines).toEqual([
			`-3,4 died=1 captured=K@-3,4#${c}:N* now=Q@-3,4#${d}:N*`,
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
		await cycle([move([7, 5], [8, 4])]);
		await cycle([move([8, 4], [8, 3])]);
		await cycle([move([8, 3], [6, 1])]);
		expect((await w.registry())[1].status).toEqual(CAPTURED);

		const attendance = (await w.env.read(w.Game, {
			functionName: 'getAttendance',
		})) as {waitedFor: bigint};
		expect(attendance.waitedFor).toEqual(3n);
		// bob never commits again, and the world goes on without him.
		const alive = armies.filter((army) => army !== b);
		await cycle([move([6, 1], [6, -3])], alive);
		await cycle([], alive);
		expect(await w.pieceAt(6, -3)).toEqual(`Q@6,-3#${d}:N*`);
	});
});
