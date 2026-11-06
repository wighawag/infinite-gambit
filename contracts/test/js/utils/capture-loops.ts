import {move, movesWorld} from './moves-world.js';

/**
 * THE CAPTURE LOOPS of `CaptureLoops.test.ts`, played in the tight-grid world
 * of `moves-world.ts` with a fourth army (as in `KingCapture.test.ts`): alice
 * at spawn (0,0), bob at (6,0) facing East with his king on (6,1), carol at
 * (0,6) with her king on (-2,6) and dave at (6,6) with his king on (4,6), both
 * facing North. Shared with `GasBudget.test.ts`, which prices folding them.
 * The pieces that take the kings:
 *
 *   dave's queen (7,5), to (8,4) then (8,3): from there it takes bob's king
 *     on (6,1), through (7,2);
 *   carol's queen (1,5), to (3,3) then (8,3), the same way;
 *   bob's knight (5,0), to (4,2) then (3,4): from there it takes dave's king;
 *   dave's pawn (3,6), facing West, which takes carol's king once she has
 *     walked it round her army to (2,7).
 */

export type World = Awaited<ReturnType<ReturnType<typeof movesWorld>>>;
export type Order = 'forward' | 'reverse' | 'rotated';
export type Submission = Parameters<World['play']>[0][number];

/** Play one cycle, its reveals in `order` ('rotated': the first goes last). */
export async function play(w: World, submissions: Submission[], order: Order) {
	if (order === 'rotated') {
		await w.play([...submissions.slice(1), ...submissions.slice(0, 1)]);
	} else {
		await w.play(submissions, order);
	}
}

/** alice, bob, carol and dave, deployed, at the top of the cycle they act in. */
export async function fourArmies(
	world: () => Promise<World>,
	owners?: {bob?: `0x${string}`; dave?: `0x${string}`},
) {
	const w = await world();
	const [a, b, c, d] = await w.deploy([
		[w.alice, [0, 0]],
		[owners?.bob ?? w.bob, [1, 0]],
		[w.carol, [0, 1]],
		[owners?.dave ?? w.dave, [1, 1]],
	]);
	const stakes = new Map((await w.registry()).map((r) => [r.id, r.stake]));
	return {
		w,
		a,
		b,
		c,
		d,
		stakes,
		bobOwner: owners?.bob ?? w.bob,
		daveOwner: owners?.dave ?? w.dave,
	};
}

export type Armies = Awaited<ReturnType<typeof fourArmies>>;

/** A TWO-ARMY LOOP: dave's queen takes bob's king while bob's knight takes dave's. */
export async function twoArmyLoop(
	world: () => Promise<World>,
	order: Order,
	s?: Armies,
) {
	s ??= await fourArmies(world);
	const {w, b, d, bobOwner, daveOwner} = s;
	await play(
		w,
		[
			{owner: daveOwner, army: d, moves: [move([7, 5], [8, 4])]},
			{owner: bobOwner, army: b, moves: [move([5, 0], [4, 2])]},
		],
		order,
	);
	await play(
		w,
		[
			{owner: daveOwner, army: d, moves: [move([8, 4], [8, 3])]},
			{owner: bobOwner, army: b, moves: [move([4, 2], [3, 4])]},
		],
		order,
	);
	await play(
		w,
		[
			{owner: daveOwner, army: d, moves: [move([8, 3], [6, 1])]},
			{owner: bobOwner, army: b, moves: [move([3, 4], [4, 6])]},
		],
		order,
	);
	return s;
}

/**
 * A THREE-ARMY LOOP: carol's queen takes bob's king, bob's knight takes
 * dave's, and dave's pawn takes carol's, all in one cycle.
 */
export async function threeArmyLoop(world: () => Promise<World>, order: Order) {
	const s = await fourArmies(world);
	const {w, b, c, d} = s;
	// carol walks her king round her army to (2,7), next to dave's west pawn,
	// while bob's knight comes up; then her queen comes round.
	const walk: [number, number][] = [
		[-2, 6],
		[-3, 7],
		[-2, 8],
		[-1, 8],
		[0, 8],
		[1, 8],
		[2, 7],
	];
	const knight: [number, number][] = [
		[5, 0],
		[4, 2],
		[3, 4],
	];
	for (let k = 0; k + 1 < walk.length; k++) {
		const submissions: Submission[] = [
			{owner: w.carol, army: c, moves: [move(walk[k], walk[k + 1])]},
		];
		if (k + 1 < knight.length) {
			submissions.push({
				owner: w.bob,
				army: b,
				moves: [move(knight[k], knight[k + 1])],
			});
		}
		await play(w, submissions, order);
	}
	await w.play([{owner: w.carol, army: c, moves: [move([1, 5], [3, 3])]}]);
	await w.play([{owner: w.carol, army: c, moves: [move([3, 3], [8, 3])]}]);
	await play(
		w,
		[
			{owner: w.carol, army: c, moves: [move([8, 3], [6, 1])]},
			{owner: w.bob, army: b, moves: [move([3, 4], [4, 6])]},
			{owner: w.dave, army: d, moves: [move([3, 6], [2, 7])]},
		],
		order,
	);
	return s;
}

/**
 * A LOOP AFTER A MERGE: bob's knight takes dave's king first, so dave's army
 * is bob's; then carol's queen takes bob's king while dave's old west pawn,
 * bob's now, takes carol's.
 */
export async function loopAfterMerge(
	world: () => Promise<World>,
	order: Order,
) {
	const s = await fourArmies(world);
	const {w, b, c} = s;
	const walk: [number, number][] = [
		[-2, 6],
		[-3, 7],
		[-2, 8],
		[-1, 8],
		[0, 8],
		[1, 8],
		[2, 7],
	];
	const knight: [number, number][] = [
		[5, 0],
		[4, 2],
		[3, 4],
		[4, 6],
	];
	for (let k = 0; k + 1 < walk.length; k++) {
		const submissions: Submission[] = [
			{owner: w.carol, army: c, moves: [move(walk[k], walk[k + 1])]},
		];
		if (k + 1 < knight.length) {
			submissions.push({
				owner: w.bob,
				army: b,
				moves: [move(knight[k], knight[k + 1])],
			});
		}
		await play(w, submissions, order);
	}
	await w.play([{owner: w.carol, army: c, moves: [move([1, 5], [3, 3])]}]);
	await w.play([{owner: w.carol, army: c, moves: [move([3, 3], [8, 3])]}]);
	await play(
		w,
		[
			{owner: w.carol, army: c, moves: [move([8, 3], [6, 1])]},
			{owner: w.bob, army: b, moves: [move([3, 6], [2, 7])]},
		],
		order,
	);
	return s;
}
