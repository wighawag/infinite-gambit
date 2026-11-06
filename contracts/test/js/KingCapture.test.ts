import {expect} from 'earl';
import {describe, it} from 'node:test'; // using node:test as hardhat v3 do not support vitest
import {network} from 'hardhat';
import {setupFixtures} from './utils/index.js';
import {movesWorld, move} from './utils/moves-world.js';

/**
 * KING CAPTURE AND THE MERGE (`docs/adr/0001-one-move-per-army-merge-on-capture.md`)
 * and the king rows of the collision table
 * (`docs/adr/0003-collision-table-king-survives-a-crowd.md`):
 *
 * | On the square       | Arrivals                     | Outcome                                          |
 * |---------------------|------------------------------|--------------------------------------------------|
 * | empty               | a king + exactly 1 enemy     | both die, the king's army merges into the enemy's |
 * | empty               | a king + 2+ enemies          | the king lands, they die                         |
 * | a piece that stayed | a king + exactly 1 enemy     | both die and merge as above, the piece stays     |
 * | a piece that stayed | a king + 2+ enemies          | the king captures it, the others die             |
 * | a king that stayed  | 1 piece                      | captured: its army merges into the captor's      |
 * | a king that stayed  | 2+ pieces                    | it stays, they die                               |
 *
 * EVERY SCENARIO IS PLAYED TWICE, its reveals in commit order and reversed,
 * and the two boards, registries (owner, status, stake, merged-into) and cycle
 * outcomes must be identical (`docs/adr/0002-order-free-lazy-resolution.md`).
 *
 * The world is `utils/moves-world.ts`'s, with a fourth army: alice at spawn
 * (0,0), bob at (6,0) facing East with his king on (6,1), carol at (0,6) and
 * dave at (6,6), both facing North. The only empty square next to bob's king
 * is (7,2), and the pieces brought to it are:
 *
 *   dave's queen (7,5), to (8,4) then (8,3): from there it reaches (7,2), and
 *     bob's king on (6,1) through it;
 *   carol's queen (1,5), to (3,3) then (7,3) (or (6,3)), next to (7,2);
 *   dave's pawn (7,4), facing South, to (7,3) then (7,2), to stand there;
 *   dave's king (4,6), to the empty (3,7), where carol's pawn on (2,6),
 *     facing East, can capture it.
 */

const {provider, networkHelpers} = await network.connect();
const {deployAll} = setupFixtures(provider);
const world = movesWorld({
	deployAll,
	loadFixture: networkHelpers.loadFixture,
});

type World = Awaited<ReturnType<typeof world>>;
type Order = 'forward' | 'reverse';

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
	return {w, a, b, c, d};
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

/** See `Collisions.test.ts`: forward, then reversed, the same state. */
async function inBothOrders<T extends {w: World}>(
	scenario: (order: Order) => Promise<T>,
): Promise<T> {
	const forward = await scenario('forward');
	const forwardState = await snapshot(forward.w);
	const reverse = await scenario('reverse');
	expect(await snapshot(reverse.w)).toEqual(forwardState);
	return reverse;
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

describe('capturing a king', function () {
	it('moves the stake and the pieces of a king taken by a lone piece to the captor army', async function () {
		const {w, b, d, stakes, bobPieces} = await inBothOrders(async (order) => {
			const s = await fourArmies();
			const stakes = new Map(
				(await s.w.registry()).map((r) => [r.id, r.stake]),
			);
			const bobPieces = (await piecesOf(s.w, s.b)).length;
			await queensAround(s, order, false);
			await s.w.play(
				[{owner: s.w.dave, army: s.d, moves: [move([8, 3], [6, 1])]}],
				order,
			);
			return {...s, stakes, bobPieces};
		});
		expect(await w.pieceAt(6, 1)).toEqual(`Q@6,1#${d}:N*`);
		expect(await piecesOf(w, b)).toEqual([]);
		// bob's pieces, his king aside, are dave's now: pawns keep their way.
		expect(await w.pieceAt(4, 0)).toEqual(`P@4,0#${d}:W`);
		expect(await w.pieceAt(7, 0)).toEqual(`P@7,0#${d}:E`);
		// All of them but the king that was taken.
		expect((await piecesOf(w, d)).length).toEqual(2 * bobPieces - 1);

		const bob = await entry(w, b);
		expect(bob.status).toEqual(CAPTURED);
		expect(bob.mergedInto).toEqual(d);
		expect(bob.owner).toEqual(w.dave);
		expect(bob.stake).toEqual(0n);
		const dave = await entry(w, d);
		expect(dave.status).toEqual(DEPLOYED);
		expect(dave.mergedInto).toEqual(d);
		expect(dave.stake).toEqual(stakes.get(d)! + stakes.get(b)!);
		expect((await w.outcomes()).lines).toEqual([
			`6,1 died=0 captured=K@6,1#${b}:E now=Q@6,1#${d}:N*`,
		]);
	});

	it('leaves the merged army one move a cycle, made by the captor: the captured army can no longer commit', async function () {
		const s = await fourArmies();
		const {w, b, d} = s;
		await queensAround(s, 'forward', false);
		await w.play([{owner: w.dave, army: d, moves: [move([8, 3], [6, 1])]}]);

		await expect(w.commit(w.bob, b, [])).toBeRejectedWith('NotInGame');
		// dave moves one of the pieces that were bob's, with his one move.
		await w.play([{owner: w.dave, army: d, moves: [move([4, 0], [3, 0])]}]);
		expect(await w.pieceAt(3, 0)).toEqual(`P@3,0#${d}:W*`);
		// And the captured army is not a second commitment for dave: he plays
		// its pieces as his own army's, never as bob's.
		await expect(w.commit(w.dave, b, [])).toBeRejectedWith('NotDelegate');
	});
});

describe('the collision table, king rows', function () {
	it("kills a moving king and the one enemy piece it meets on an empty square, and merges its army into that piece's", async function () {
		const {w, b, d, stakes} = await inBothOrders(async (order) => {
			const s = await fourArmies();
			const stakes = new Map(
				(await s.w.registry()).map((r) => [r.id, r.stake]),
			);
			await queensAround(s, order, false);
			await s.w.play(
				[
					{owner: s.w.bob, army: s.b, moves: [move([6, 1], [7, 2])]},
					{owner: s.w.dave, army: s.d, moves: [move([8, 3], [7, 2])]},
				],
				order,
			);
			return {...s, stakes};
		});
		expect(await w.pieceAt(7, 2)).toEqual(undefined);
		expect(await w.pieceAt(6, 1)).toEqual(undefined);
		expect(await w.pieceAt(8, 3)).toEqual(undefined);
		expect(await w.pieceAt(4, 0)).toEqual(`P@4,0#${d}:W`);
		const bob = await entry(w, b);
		expect([bob.status, bob.mergedInto, bob.stake]).toEqual([CAPTURED, d, 0n]);
		expect((await entry(w, d)).stake).toEqual(stakes.get(d)! + stakes.get(b)!);
		expect((await w.outcomes()).lines).toEqual(['7,2 died=2 captured=- now=-']);
	});

	it('lands a moving king that meets two or more enemy pieces on an empty square, and kills them', async function () {
		const {w, b, stakes} = await inBothOrders(async (order) => {
			const s = await fourArmies();
			const stakes = (await s.w.registry()).map((r) => r.stake);
			await queensAround(s, order);
			await s.w.play(
				[
					{owner: s.w.bob, army: s.b, moves: [move([6, 1], [7, 2])]},
					{owner: s.w.dave, army: s.d, moves: [move([8, 3], [7, 2])]},
					{owner: s.w.carol, army: s.c, moves: [move([7, 3], [7, 2])]},
				],
				order,
			);
			return {...s, stakes};
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
		expect(registry.map((r) => r.stake)).toEqual(stakes);
		expect((await entry(w, b)).king).toEqual({x: 7, y: 2});
		expect((await w.outcomes()).lines).toEqual([
			`7,2 died=2 captured=- now=K@7,2#${b}:E*`,
		]);
	});

	it("kills a moving king and the one enemy piece it meets on a piece that stayed, which survives, and merges the king's army", async function () {
		const {w, b, c, d, stakes} = await inBothOrders(async (order) => {
			const s = await fourArmies();
			const stakes = new Map(
				(await s.w.registry()).map((r) => [r.id, r.stake]),
			);
			await pawnOnTheSquare(s, order);
			await s.w.play(
				[
					{owner: s.w.bob, army: s.b, moves: [move([6, 1], [7, 2])]},
					{owner: s.w.carol, army: s.c, moves: [move([7, 3], [7, 2])]},
				],
				order,
			);
			return {...s, stakes};
		});
		expect(await w.pieceAt(7, 2)).toEqual(`P@7,2#${d}:S*`);
		expect(await w.pieceAt(7, 3)).toEqual(undefined);
		expect(await w.pieceAt(4, 0)).toEqual(`P@4,0#${c}:W`);
		const bob = await entry(w, b);
		expect([bob.status, bob.mergedInto, bob.stake]).toEqual([CAPTURED, c, 0n]);
		expect((await entry(w, c)).stake).toEqual(stakes.get(c)! + stakes.get(b)!);
		expect((await w.outcomes()).lines).toEqual([
			`7,2 died=2 captured=- now=P@7,2#${d}:S*`,
		]);
	});

	it('lets a moving king that meets two or more enemy pieces on a piece that stayed capture it, and kills the others', async function () {
		const {w, b, d} = await inBothOrders(async (order) => {
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
		const {w, b} = await inBothOrders(async (order) => {
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
 * A CHAIN IN ONE CYCLE: dave's queen takes bob's king on (6,1) while carol's
 * pawn takes dave's king, which stepped to (3,7) the cycle before.
 */
async function chain(order: Order) {
	const s = await fourArmies();
	const {w, c, d} = s;
	const stakes = new Map((await w.registry()).map((r) => [r.id, r.stake]));
	await queensAround(s, order, false);
	await w.play([{owner: w.dave, army: d, moves: [move([4, 6], [3, 7])]}]);
	await w.play(
		[
			{owner: w.dave, army: d, moves: [move([8, 3], [6, 1])]},
			{owner: w.carol, army: c, moves: [move([2, 6], [3, 7])]},
		],
		order,
	);
	return {...s, stakes};
}

/** The registry without where the kings stand: who plays what, and holds what. */
async function holdings(w: World) {
	return (await w.registry()).map((r) => ({
		id: r.id,
		owner: r.owner,
		status: r.status,
		stake: r.stake,
		mergedInto: r.mergedInto,
	}));
}

describe('a chain of captures in one cycle', function () {
	it('ends with the last captor owning the pieces of both and holding both stakes', async function () {
		const {w, a, b, c, d, stakes} = await inBothOrders(chain);
		expect(await w.pieceAt(6, 1)).toEqual(`Q@6,1#${c}:N*`);
		expect(await w.pieceAt(3, 7)).toEqual(`P@3,7#${c}:E*`);
		expect(await piecesOf(w, b)).toEqual([]);
		expect(await piecesOf(w, d)).toEqual([]);
		expect(await w.pieceAt(4, 0)).toEqual(`P@4,0#${c}:W`);
		expect(await w.pieceAt(7, 4)).toEqual(`P@7,4#${c}:S`);
		const registry = await holdings(w);
		expect(registry).toEqual([
			{
				id: a,
				owner: w.alice,
				status: DEPLOYED,
				stake: stakes.get(a)!,
				mergedInto: a,
			},
			{id: b, owner: w.carol, status: CAPTURED, stake: 0n, mergedInto: c},
			{
				id: c,
				owner: w.carol,
				status: DEPLOYED,
				stake: stakes.get(b)! + stakes.get(c)! + stakes.get(d)!,
				mergedInto: c,
			},
			{id: d, owner: w.carol, status: CAPTURED, stake: 0n, mergedInto: c},
		]);
		// Only alice and carol are left to wait for.
		await expect(w.commit(w.bob, b, [])).toBeRejectedWith('NotInGame');
		await expect(w.commit(w.dave, d, [])).toBeRejectedWith('NotInGame');
	});

	it('resolves the same board, ownership and stakes whichever capture square is folded first', async function () {
		// Folding a square is a reveal that touches it: it moves the capture
		// out of the square's facts and onto the army record. Before, between
		// and after the two folds, in either order, nothing must change.
		async function foldInOrder(first: 'bob' | 'dave') {
			const s = await chain('forward');
			const {w, c} = s;
			const before = await holdings(w);
			const states = [before];
			const foldBob = [move([6, 1], [7, 2])];
			const foldDave = [move([3, 7], [4, 7])];
			// Room for the pawn on (3,7) to step forward.
			await w.play([{owner: w.carol, army: c, moves: [move([4, 7], [4, 8])]}]);
			states.push(await holdings(w));
			for (const moves of first === 'bob'
				? [foldBob, foldDave]
				: [foldDave, foldBob]) {
				await w.play([{owner: w.carol, army: c, moves}]);
				states.push(await holdings(w));
			}
			return {s, states, board: await w.board()};
		}
		const bobFirst = await foldInOrder('bob');
		const daveFirst = await foldInOrder('dave');
		for (const state of [...bobFirst.states, ...daveFirst.states]) {
			expect(state).toEqual(bobFirst.states[0]);
		}
		expect(daveFirst.board).toEqual(bobFirst.board);
		const {w, c} = daveFirst.s;
		expect(await w.pieceAt(7, 2)).toEqual(`Q@7,2#${c}:N*`);
		expect(await w.pieceAt(4, 7)).toEqual(`P@4,7#${c}:E*`);
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
		await cycle([move([4, 0], [3, 0])], alive);
		await cycle([], alive);
		expect(await w.pieceAt(3, 0)).toEqual(`P@3,0#${d}:W*`);
	});
});
