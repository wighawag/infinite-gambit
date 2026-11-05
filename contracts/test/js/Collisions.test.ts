import {expect} from 'earl';
import {describe, it} from 'node:test'; // using node:test as hardhat v3 do not support vitest
import {network} from 'hardhat';
import {setupFixtures} from './utils/index.js';
import {movesWorld, move} from './utils/moves-world.js';

/**
 * SIMULTANEOUS RESOLUTION of the moves of one cycle, non-king rows
 * (`docs/adr/0003-collision-table-king-survives-a-crowd.md`): who survives a
 * square depends only on how many pieces arrived and whether the piece there
 * stayed, never on the order the reveals landed in
 * (`docs/adr/0002-order-free-lazy-resolution.md`).
 *
 * | On the square       | Arrivals              | Outcome                     |
 * |---------------------|-----------------------|-----------------------------|
 * | empty               | 1 piece               | it lands                    |
 * | empty               | 2+ pieces, no king    | all die                     |
 * | a piece that stayed | 1 piece               | captured                    |
 * | a piece that stayed | 2+ pieces             | all arrivals die, it stays  |
 *
 * EVERY SCENARIO IS PLAYED TWICE, its reveals in commit order and reversed,
 * and the two boards, registries and cycle outcomes must be identical.
 *
 * The world is `utils/moves-world.ts`'s: alice at spawn (0,0), bob at (6,0),
 * carol at (0,6). The column x = 3 between alice and bob is empty, and the
 * squares used here are:
 *
 *   alice's east pawn (2,0), facing East: one step to (3,0), or a capture
 *     diagonally onto (3,1);
 *   bob's west pawns (4,0) and (4,1), facing West: one step to (3,0), a capture
 *     onto (3,1), or (4,1) two squares to (2,1) through (3,1);
 *   carol's queen (1,5), brought down column 3 in two cycles: (3,3), then
 *     (3,1), where both pawns can capture it.
 */

const {provider, networkHelpers} = await network.connect();
const {deployAll} = setupFixtures(provider);
const world = movesWorld({
	deployAll,
	loadFixture: networkHelpers.loadFixture,
});

type World = Awaited<ReturnType<typeof world>>;
type Order = 'forward' | 'reverse';

/** alice, bob and carol, deployed, at the top of the cycle they act in. */
async function threeArmies() {
	const w = await world();
	const [a, b, c] = await w.deploy([
		[w.alice, [0, 0]],
		[w.bob, [1, 0]],
		[w.carol, [0, 1]],
	]);
	return {w, a, b, c};
}

/**
 * The queen of the army `c` deployed at (0,6) from (1,5) to (3,3), and on to
 * (3,1) unless told to stop. Its owner is carol unless said otherwise.
 */
async function bringQueenDown(
	w: World,
	c: bigint,
	order: Order,
	to: 'row 3' | 'row 1' = 'row 1',
	owner: `0x${string}` = w.carol,
) {
	await w.play([{owner, army: c, moves: [move([1, 5], [3, 3])]}], order);
	if (to === 'row 3') return;
	await w.play([{owner, army: c, moves: [move([3, 3], [3, 1])]}], order);
}

/** What a scenario left: the board, the registry and the cycle's outcomes. */
async function snapshot(w: World) {
	return {
		board: await w.board(),
		registry: await w.registry(),
		// Without the cycle number: a second world starts later on the clock.
		outcomes: (await w.outcomes()).lines,
	};
}

/**
 * Play `scenario` with its reveals forward, then again from a fresh world
 * reversed, assert the two end in the same state, and hand back the second
 * one for the scenario's own assertions: every world is a snapshot of one
 * chain, so the one played last is the one the chain now holds.
 */
async function inBothOrders<T extends {w: World}>(
	scenario: (order: Order) => Promise<T>,
): Promise<T> {
	const forward = await scenario('forward');
	const forwardState = await snapshot(forward.w);
	const reverse = await scenario('reverse');
	expect(await snapshot(reverse.w)).toEqual(forwardState);
	return reverse;
}

describe('the collision table, non-king rows', function () {
	it('lands one piece arriving on an empty square, and reports nothing', async function () {
		const {w, a} = await inBothOrders(async (order) => {
			const s = await threeArmies();
			await s.w.play(
				[{owner: s.w.alice, army: s.a, moves: [move([2, 0], [3, 0])]}],
				order,
			);
			return s;
		});
		expect(await w.pieceAt(2, 0)).toEqual(undefined);
		expect(await w.pieceAt(3, 0)).toEqual(`P@3,0#${a}:E*`);
		expect((await w.outcomes()).lines).toEqual([]);
	});

	it('kills every piece when two arrive on an empty square', async function () {
		const {w} = await inBothOrders(async (order) => {
			const s = await threeArmies();
			await s.w.play(
				[
					{owner: s.w.alice, army: s.a, moves: [move([2, 0], [3, 0])]},
					{owner: s.w.bob, army: s.b, moves: [move([4, 0], [3, 0])]},
				],
				order,
			);
			return s;
		});
		// Both pawns are gone: from where they were and from where they went.
		expect(await w.pieceAt(2, 0)).toEqual(undefined);
		expect(await w.pieceAt(4, 0)).toEqual(undefined);
		expect(await w.pieceAt(3, 0)).toEqual(undefined);
		expect((await w.board()).length).toEqual(58);
		const outcomes = await w.outcomes();
		expect(outcomes.cycle).toEqual(w.cycle() - 1);
		expect(outcomes.lines).toEqual(['3,0 died=2 captured=- now=-']);
	});

	it('captures a piece that stayed when exactly one piece arrives on it', async function () {
		const {w, a, c} = await inBothOrders(async (order) => {
			const s = await threeArmies();
			await bringQueenDown(s.w, s.c, order);
			await s.w.play(
				[{owner: s.w.alice, army: s.a, moves: [move([2, 0], [3, 1])]}],
				order,
			);
			return s;
		});
		expect(await w.pieceAt(2, 0)).toEqual(undefined);
		expect(await w.pieceAt(3, 1)).toEqual(`P@3,1#${a}:E*`);
		expect((await w.board()).length).toEqual(59);
		expect((await w.outcomes()).lines).toEqual([
			`3,1 died=0 captured=Q@3,1#${c}:N* now=P@3,1#${a}:E*`,
		]);
	});

	it('keeps a piece that stayed when two or more arrive on it, and kills the arrivals', async function () {
		const {w, c} = await inBothOrders(async (order) => {
			const s = await threeArmies();
			await bringQueenDown(s.w, s.c, order);
			await s.w.play(
				[
					{owner: s.w.alice, army: s.a, moves: [move([2, 0], [3, 1])]},
					{owner: s.w.bob, army: s.b, moves: [move([4, 0], [3, 1])]},
				],
				order,
			);
			return s;
		});
		expect(await w.pieceAt(3, 1)).toEqual(`Q@3,1#${c}:N*`);
		expect(await w.pieceAt(2, 0)).toEqual(undefined);
		expect(await w.pieceAt(4, 0)).toEqual(undefined);
		expect((await w.board()).length).toEqual(58);
		expect((await w.outcomes()).lines).toEqual([
			`3,1 died=2 captured=- now=Q@3,1#${c}:N*`,
		]);
	});
});

describe('moves that pass each other', function () {
	it('lets a piece that moves away escape a capture aimed at its old square: the attacker lands there', async function () {
		const {w, a, c} = await inBothOrders(async (order) => {
			const s = await threeArmies();
			await bringQueenDown(s.w, s.c, order);
			await s.w.play(
				[
					{owner: s.w.alice, army: s.a, moves: [move([2, 0], [3, 1])]},
					{owner: s.w.carol, army: s.c, moves: [move([3, 1], [3, 2])]},
				],
				order,
			);
			return s;
		});
		expect(await w.pieceAt(3, 1)).toEqual(`P@3,1#${a}:E*`);
		expect(await w.pieceAt(3, 2)).toEqual(`Q@3,2#${c}:N*`);
		expect((await w.board()).length).toEqual(60);
		// Nothing was captured: the queen was not there to be.
		expect((await w.outcomes()).lines).toEqual([]);
	});

	it('completes a swap: two pieces moving onto each other both land', async function () {
		const {w, b, c} = await inBothOrders(async (order) => {
			const s = await threeArmies();
			await bringQueenDown(s.w, s.c, order);
			await s.w.play(
				[
					{owner: s.w.bob, army: s.b, moves: [move([4, 0], [3, 1])]},
					{owner: s.w.carol, army: s.c, moves: [move([3, 1], [4, 0])]},
				],
				order,
			);
			return s;
		});
		expect(await w.pieceAt(3, 1)).toEqual(`P@3,1#${b}:W*`);
		expect(await w.pieceAt(4, 0)).toEqual(`Q@4,0#${c}:N*`);
		expect((await w.board()).length).toEqual(60);
		expect((await w.outcomes()).lines).toEqual([]);
	});

	it('completes two moves whose paths cross: only destinations matter', async function () {
		const {w, b, c} = await inBothOrders(async (order) => {
			const s = await threeArmies();
			await bringQueenDown(s.w, s.c, order, 'row 3');
			// The queen down column 3 through (3,1), bob's pawn two squares West
			// along row 1 through (3,1).
			await s.w.play(
				[
					{owner: s.w.bob, army: s.b, moves: [move([4, 1], [2, 1])]},
					{owner: s.w.carol, army: s.c, moves: [move([3, 3], [3, -1])]},
				],
				order,
			);
			return s;
		});
		expect(await w.pieceAt(2, 1)).toEqual(`P@2,1#${b}:W*`);
		expect(await w.pieceAt(3, -1)).toEqual(`Q@3,-1#${c}:N*`);
		expect(await w.pieceAt(3, 1)).toEqual(undefined);
		expect((await w.board()).length).toEqual(60);
		expect((await w.outcomes()).lines).toEqual([]);
	});

	it('lets a piece escape its square and still die where it went', async function () {
		const {w, a} = await inBothOrders(async (order) => {
			const s = await threeArmies();
			await bringQueenDown(s.w, s.c, order);
			await s.w.play(
				[
					{owner: s.w.alice, army: s.a, moves: [move([2, 0], [3, 1])]},
					{owner: s.w.bob, army: s.b, moves: [move([4, 0], [3, 0])]},
					{owner: s.w.carol, army: s.c, moves: [move([3, 1], [3, 0])]},
				],
				order,
			);
			return s;
		});
		// The queen dodged alice's pawn, which lands on (3,1), and met bob's pawn
		// on (3,0): both die there. Nothing bounces back.
		expect(await w.pieceAt(3, 1)).toEqual(`P@3,1#${a}:E*`);
		expect(await w.pieceAt(3, 0)).toEqual(undefined);
		expect(await w.pieceAt(4, 0)).toEqual(undefined);
		expect((await w.board()).length).toEqual(58);
		expect((await w.outcomes()).lines).toEqual(['3,0 died=2 captured=- now=-']);
	});
});

describe('who can meet whom', function () {
	it('treats two armies of the same account as two armies: one captures the other', async function () {
		const {w, a, c} = await inBothOrders(async (order) => {
			const w = await world();
			const [a, c] = await w.deploy([
				[w.alice, [0, 0]],
				[w.alice, [0, 1]],
			]);
			await bringQueenDown(w, c, order, 'row 1', w.alice);
			await w.play(
				[{owner: w.alice, army: a, moves: [move([2, 0], [3, 1])]}],
				order,
			);
			return {w, a, c};
		});
		expect(a).not.toEqual(c);
		expect(await w.pieceAt(3, 1)).toEqual(`P@3,1#${a}:E*`);
		expect((await w.outcomes()).lines).toEqual([
			`3,1 died=0 captured=Q@3,1#${c}:N* now=P@3,1#${a}:E*`,
		]);
	});
});

describe('the cycle outcomes view', function () {
	it('reports only the last closed cycle: an idle cycle clears it', async function () {
		const {w} = await threeArmies();
		await w.play([
			{owner: w.alice, army: (await w.registry())[0].id, moves: []},
		]);
		expect((await w.outcomes()).lines).toEqual([]);

		const [a, b] = (await w.registry()).map((r) => r.id);
		await w.play([
			{owner: w.alice, army: a, moves: [move([2, 0], [3, 0])]},
			{owner: w.bob, army: b, moves: [move([4, 0], [3, 0])]},
		]);
		expect((await w.outcomes()).lines).toEqual(['3,0 died=2 captured=- now=-']);
		await w.toNextCycle();
		expect((await w.outcomes()).lines).toEqual([]);
	});

	it("never reports the open cycle's facts: a reveal touching the square takes the last cycle's outcome away", async function () {
		const {w, a, b, c} = await threeArmies();
		await bringQueenDown(w, c, 'forward');
		await w.play([
			{owner: w.alice, army: a, moves: [move([2, 0], [3, 1])]},
			{owner: w.bob, army: b, moves: [move([4, 0], [3, 1])]},
		]);
		const before = await w.outcomes();
		expect(before.lines).toEqual([`3,1 died=2 captured=- now=Q@3,1#${c}:N*`]);

		// The queen moves on: during the reveal phase the square's record is
		// this cycle's, so the last cycle's outcome there is no longer readable.
		const away = [move([3, 1], [3, 2])];
		await w.commit(w.carol, c, away);
		await w.toRevealPhase();
		expect(await w.outcomes()).toEqual(before);
		await w.reveal(w.carol, c, away);
		expect(await w.outcomes()).toEqual({cycle: before.cycle, lines: []});
	});
});
