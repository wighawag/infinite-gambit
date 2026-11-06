import {expect} from 'earl';
import {describe, it} from 'node:test'; // using node:test as hardhat v3 do not support vitest
import {network} from 'hardhat';
import {setupFixtures} from './utils/index.js';
import {movesWorld, move} from './utils/moves-world.js';
import {
	fourArmies,
	loopAfterMerge,
	threeArmyLoop,
	twoArmyLoop,
	type Armies,
	type Order,
} from './utils/capture-loops.js';

/**
 * CAPTURE LOOPS ROTATE OWNERSHIP (`docs/adr/0004-capture-loops-rotate-ownership.md`):
 * when kings take each other in a ring within one cycle, the pieces that took
 * the kings die, every king stays where it stood, and each owner takes over
 * the army (and so the stake) it captured. Nothing merges.
 *
 * EVERY SCENARIO IS PLAYED IN SEVERAL REVEAL ORDERS, and the boards,
 * registries and cycle outcomes must be identical; the loop's squares are
 * then folded in different orders, and nothing may change
 * (`docs/adr/0002-order-free-lazy-resolution.md`).
 *
 * The scenarios, and the board they are played on, are
 * `utils/capture-loops.ts`'s.
 */

const {provider, networkHelpers} = await network.connect();
const {deployAll} = setupFixtures(provider);
const world = movesWorld({
	deployAll,
	loadFixture: networkHelpers.loadFixture,
});

type World = Awaited<ReturnType<typeof world>>;

const DEPLOYED = 2;
const CAPTURED = 6;

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

/** What a scenario left: the board, the registry and the cycle's outcomes. */
async function snapshot(w: World) {
	return {
		board: await w.board(),
		registry: await w.registry(),
		outcomes: [...(await w.outcomes()).lines].sort(),
	};
}

/** Play `scenario` in every order, check they agree, and return the last. */
async function inEveryOrder<T extends {w: World}>(
	scenario: (order: Order) => Promise<T>,
	orders: Order[] = ['forward', 'reverse'],
): Promise<T> {
	let first: Awaited<ReturnType<typeof snapshot>> | undefined;
	let last: T | undefined;
	for (const order of orders) {
		last = await scenario(order);
		const state = await snapshot(last.w);
		if (first) expect(state).toEqual(first);
		else first = state;
	}
	return last!;
}

describe('a capture loop of two armies', function () {
	it('kills both king-capturing pieces, leaves both kings in place and swaps the two armies, stakes and all', async function () {
		const {w, b, d, stakes} = await inEveryOrder((order) =>
			twoArmyLoop(world, order),
		);
		expect(await w.pieceAt(6, 1)).toEqual(`K@6,1#${b}:E`);
		expect(await w.pieceAt(4, 6)).toEqual(`K@4,6#${d}:N`);
		// The queen and the knight that took the kings died there.
		expect(await w.pieceAt(8, 3)).toEqual(undefined);
		expect(await w.pieceAt(3, 4)).toEqual(undefined);
		// Every other piece still plays for its own army: nothing merged.
		expect(await w.pieceAt(4, 0)).toEqual(`P@4,0#${b}:W`);
		expect(await w.pieceAt(7, 4)).toEqual(`P@7,4#${d}:S`);

		const registry = await holdings(w);
		expect(registry.find((r) => r.id === b)).toEqual({
			id: b,
			owner: w.dave,
			status: DEPLOYED,
			stake: stakes.get(b)!,
			mergedInto: b,
		});
		expect(registry.find((r) => r.id === d)).toEqual({
			id: d,
			owner: w.bob,
			status: DEPLOYED,
			stake: stakes.get(d)!,
			mergedInto: d,
		});
		const bobArmy = (await w.registry()).find((r) => r.id === b)!;
		expect(bobArmy.king).toEqual({x: 6, y: 1});
		expect([...(await w.outcomes()).lines].sort()).toEqual(
			[
				`6,1 died=1 captured=- now=K@6,1#${b}:E`,
				`4,6 died=1 captured=- now=K@4,6#${d}:N`,
			].sort(),
		);
	});

	it('hands each army to its new owner: only they can commit for it, and both armies still move', async function () {
		const {w, b, d} = await twoArmyLoop(world, 'forward');
		await expect(w.commit(w.bob, b, [])).toBeRejectedWith('NotDelegate');
		await expect(w.commit(w.dave, d, [])).toBeRejectedWith('NotDelegate');
		await w.play([
			{owner: w.dave, army: b, moves: [move([6, 1], [7, 2])]},
			{owner: w.bob, army: d, moves: [move([4, 6], [3, 7])]},
		]);
		expect(await w.pieceAt(7, 2)).toEqual(`K@7,2#${b}:E*`);
		expect(await w.pieceAt(3, 7)).toEqual(`K@3,7#${d}:N*`);
	});
});

describe('a capture loop of three armies', function () {
	it('rotates the three armies, stakes and all, kills the three capturing pieces and leaves the three kings', async function () {
		const {w, b, c, d, stakes} = await inEveryOrder(
			(order) => threeArmyLoop(world, order),
			['forward', 'reverse', 'rotated'],
		);
		expect(await w.pieceAt(6, 1)).toEqual(`K@6,1#${b}:E`);
		expect(await w.pieceAt(4, 6)).toEqual(`K@4,6#${d}:N`);
		expect(await w.pieceAt(2, 7)).toEqual(`K@2,7#${c}:N*`);
		expect(await w.pieceAt(8, 3)).toEqual(undefined);
		expect(await w.pieceAt(3, 4)).toEqual(undefined);
		expect(await w.pieceAt(3, 6)).toEqual(undefined);
		// carol took bob's army, bob took dave's, dave took carol's.
		const registry = await holdings(w);
		const owners = new Map(registry.map((r) => [r.id, r.owner]));
		expect([owners.get(b), owners.get(c), owners.get(d)]).toEqual([
			w.carol,
			w.dave,
			w.bob,
		]);
		for (const r of registry) {
			expect([r.status, r.stake, r.mergedInto]).toEqual([
				DEPLOYED,
				stakes.get(r.id)!,
				r.id,
			]);
		}
		expect([...(await w.outcomes()).lines].sort()).toEqual(
			[
				`6,1 died=1 captured=- now=K@6,1#${b}:E`,
				`4,6 died=1 captured=- now=K@4,6#${d}:N`,
				`2,7 died=1 captured=- now=K@2,7#${c}:N*`,
			].sort(),
		);
	});
});

describe('a capture loop after a merge', function () {
	it('hands the merged army over with the army it merged into: its pieces and its stake', async function () {
		const {w, b, c, d, stakes} = await inEveryOrder((order) =>
			loopAfterMerge(world, order),
		);
		expect(await w.pieceAt(6, 1)).toEqual(`K@6,1#${b}:E`);
		expect(await w.pieceAt(2, 7)).toEqual(`K@2,7#${c}:N*`);
		expect(await w.pieceAt(4, 6)).toEqual(`N@4,6#${b}:E*`);
		expect(await w.pieceAt(3, 6)).toEqual(undefined);
		expect(await w.pieceAt(8, 3)).toEqual(undefined);
		// dave's pieces are still bob's army's, which carol now plays.
		expect(await w.pieceAt(7, 4)).toEqual(`P@7,4#${b}:S`);
		const registry = await holdings(w);
		expect(registry.find((r) => r.id === b)).toEqual({
			id: b,
			owner: w.carol,
			status: DEPLOYED,
			stake: stakes.get(b)! + stakes.get(d)!,
			mergedInto: b,
		});
		expect(registry.find((r) => r.id === d)).toEqual({
			id: d,
			owner: w.carol,
			status: CAPTURED,
			stake: 0n,
			mergedInto: b,
		});
		expect(registry.find((r) => r.id === c)).toEqual({
			id: c,
			owner: w.bob,
			status: DEPLOYED,
			stake: stakes.get(c)!,
			mergedInto: c,
		});
	});
});

describe('a capture loop between two armies of one account', function () {
	it('gains it nothing: it keeps both armies and both stakes, and loses the capturing pieces', async function () {
		const {w, b, d, stakes} = await inEveryOrder(async (order) => {
			const {bob} = await world();
			return twoArmyLoop(world, order, await fourArmies(world, {dave: bob}));
		});
		const registry = await holdings(w);
		for (const army of [b, d]) {
			expect(registry.find((r) => r.id === army)).toEqual({
				id: army,
				owner: w.bob,
				status: DEPLOYED,
				stake: stakes.get(army)!,
				mergedInto: army,
			});
		}
		expect(await w.pieceAt(8, 3)).toEqual(undefined);
		expect(await w.pieceAt(3, 4)).toEqual(undefined);
		expect(await w.pieceAt(6, 1)).toEqual(`K@6,1#${b}:E`);
		expect(await w.pieceAt(4, 6)).toEqual(`K@4,6#${d}:N`);
	});
});

describe('resolving a capture loop', function () {
	/**
	 * Folding a square is a reveal that touches it: the loop moves out of the
	 * square's facts and onto the army records of the whole loop at once.
	 * Each king steps off its square, in a chosen order, played by its new
	 * owner, and before, between and after the folds nothing may change.
	 */
	async function foldInOrder<T extends Armies>(
		scenario: () => Promise<T>,
		folds: {
			owner: (s: T) => `0x${string}`;
			army: (s: T) => bigint;
			from: [number, number];
			to: [number, number];
		}[],
	) {
		const s = await scenario();
		const {w} = s;
		const states = [await holdings(w)];
		for (const fold of folds) {
			await w.play([
				{
					owner: fold.owner(s),
					army: fold.army(s),
					moves: [move(fold.from, fold.to)],
				},
			]);
			states.push(await holdings(w));
		}
		for (const state of states) expect(state).toEqual(states[0]);
		return {s, board: await w.board(), registry: await holdings(w)};
	}

	it('gives the same board, ownership and stakes whichever square of a two-army loop is folded first', async function () {
		const foldBob = {
			owner: (s: Armies) => s.w.dave,
			army: (s: Armies) => s.b,
			from: [6, 1] as [number, number],
			to: [7, 2] as [number, number],
		};
		const foldDave = {
			owner: (s: Armies) => s.w.bob,
			army: (s: Armies) => s.d,
			from: [4, 6] as [number, number],
			to: [3, 7] as [number, number],
		};
		const scenario = () => twoArmyLoop(world, 'forward');
		const bobFirst = await foldInOrder(scenario, [foldBob, foldDave]);
		const daveFirst = await foldInOrder(scenario, [foldDave, foldBob]);
		expect(daveFirst.board).toEqual(bobFirst.board);
		expect(daveFirst.registry).toEqual(bobFirst.registry);
		const {w, b, d} = daveFirst.s;
		expect(await w.pieceAt(7, 2)).toEqual(`K@7,2#${b}:E*`);
		expect(await w.pieceAt(3, 7)).toEqual(`K@3,7#${d}:N*`);
		// Folded, the owners stay rotated.
		await expect(w.commit(w.bob, b, [])).toBeRejectedWith('NotDelegate');
		await expect(w.commit(w.dave, d, [])).toBeRejectedWith('NotDelegate');
	});

	it('gives the same board, ownership and stakes whichever square of a three-army loop is folded first', async function () {
		type S = Awaited<ReturnType<typeof threeArmyLoop>>;
		const folds = {
			bob: {
				owner: (s: S) => s.w.carol,
				army: (s: S) => s.b,
				from: [6, 1] as [number, number],
				to: [7, 2] as [number, number],
			},
			dave: {
				owner: (s: S) => s.w.bob,
				army: (s: S) => s.d,
				from: [4, 6] as [number, number],
				to: [3, 7] as [number, number],
			},
			carol: {
				owner: (s: S) => s.w.dave,
				army: (s: S) => s.c,
				from: [2, 7] as [number, number],
				to: [1, 8] as [number, number],
			},
		};
		// dave's king can only step off once carol's has left (2,7): kings
		// never stand side by side, so his square is folded after hers.
		const scenario = () => threeArmyLoop(world, 'forward');
		const runs = [
			await foldInOrder(scenario, [folds.bob, folds.carol, folds.dave]),
			await foldInOrder(scenario, [folds.carol, folds.bob, folds.dave]),
			await foldInOrder(scenario, [folds.carol, folds.dave, folds.bob]),
		];
		for (const run of runs.slice(1)) {
			expect(run.board).toEqual(runs[0].board);
			expect(run.registry).toEqual(runs[0].registry);
		}
	});
});
