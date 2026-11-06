import {expect} from 'earl';
import {describe, it} from 'node:test'; // using node:test as hardhat v3 do not support vitest
import {network} from 'hardhat';
import {encodeAbiParameters, keccak256, toHex, zeroAddress} from 'viem';
import {artifacts} from '../../rocketh/environment.js';
import {
	commitmentHashFor,
	revealTurn,
	setupFixtures,
	TURN_BOND,
	type Move,
} from './utils/index.js';
import {
	movesWorld,
	move,
	REVEAL_ORDERS,
	SECRET,
	type RevealOrder,
} from './utils/moves-world.js';

/**
 * THREE PIECE-MOVES
 * (`docs/adr/0016-an-army-moves-up-to-three-pieces-a-cycle-simultaneously.md`):
 * an army's move is up to three piece-moves, each by a different piece, and
 * they are SIMULTANEOUS. Each is judged on the start-of-cycle board with the
 * army's own pieces that move this cycle counted as gone, so a piece may move
 * onto or slide through a square its own army leaves, and two may swap. Two
 * piece-moves to one square, or two by one piece, or a fourth, refuse the
 * whole reveal.
 *
 * Counting its own movers as gone is for the LEGALITY CHECK ONLY: a square's
 * record still keeps the start-of-cycle piece, so every scenario that meets
 * another army is replayed in every reveal order and must leave the same
 * board, registry and outcomes (`docs/adr/0002-order-free-lazy-resolution.md`),
 * and one army's piece-moves listed in every order must too.
 *
 * The world is `utils/moves-world.ts`'s (spacing 6): alice at (0,0), bob at
 * (6,0), carol at (0,6), every king on its spawn point.
 *
 *   y= 2  . P P P .     alice, x = -2 .. 2
 *   y= 1  P R N B P
 *   y= 0  P Q K . P
 *   y=-1  P B N R P
 *   y=-2  . P P P .
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

/** Every ordering of `list`. */
function permutations<T>(list: readonly T[]): T[][] {
	if (list.length <= 1) return [[...list]];
	return list.flatMap((x, i) =>
		permutations([...list.slice(0, i), ...list.slice(i + 1)]).map((rest) => [
			x,
			...rest,
		]),
	);
}

/**
 * `_capturesBy[army]`, read from storage: the armies whose king or stone
 * `army` was noted as possibly taking (`UsingGameBoard-_noteCandidate`).
 */
const layout = (artifacts.GameReveal as any).storageLayout as {
	storage: {label: string; slot: string}[];
};
const CAPTURES_BY_SLOT = BigInt(
	layout.storage.find((s) => s.label === '_capturesBy')!.slot,
);
async function capturesBy(w: World, army: bigint): Promise<bigint[]> {
	const read = async (slot: `0x${string}`) =>
		BigInt(
			(await provider.request({
				method: 'eth_getStorageAt',
				params: [w.Game.address, slot, 'latest'],
			})) as string,
		);
	const lengthSlot = keccak256(
		encodeAbiParameters(
			[{type: 'uint256'}, {type: 'uint256'}],
			[army, CAPTURES_BY_SLOT],
		),
	);
	const length = await read(lengthSlot);
	const data = BigInt(keccak256(lengthSlot));
	const victims: bigint[] = [];
	for (let i = 0n; i < length; i++) {
		victims.push(await read(toHex(data + i, {size: 32})));
	}
	return victims;
}

/** The registry entry of `army`. */
async function entry(w: World, army: bigint) {
	const found = (await w.registry()).find((r) => r.id === army);
	if (!found) throw new Error(`no army ${army}`);
	return found;
}

/**
 * alice's three piece-moves that each need another to vacate a square: her
 * pawn (-1,2) steps aside to her empty corner (-2,2), her rook (-1,1) slides
 * up THROUGH (-1,2) to (-1,4), and her queen (-1,0) steps ONTO (-1,1).
 */
const VACATING = [
	move([-1, 2], [-2, 2]),
	move([-1, 1], [-1, 4]),
	move([-1, 0], [-1, 1]),
];

describe('a move of up to three piece-moves', function () {
	it('accepts none, one, two or three piece-moves by different pieces', async function () {
		const w = await world();
		const [a] = await w.deploy([[w.alice, [0, 0]]]);
		const start = await w.board();
		await w.play([{owner: w.alice, army: a, moves: []}]);
		expect(await w.board()).toEqual(start);
		await w.play([{owner: w.alice, army: a, moves: [move([-1, 2], [-1, 3])]}]);
		await w.play([
			{
				owner: w.alice,
				army: a,
				moves: [move([0, 2], [0, 3]), move([1, 2], [1, 3])],
			},
		]);
		await w.play([
			{
				owner: w.alice,
				army: a,
				moves: [
					move([-1, 3], [-1, 4]),
					move([0, 3], [0, 4]),
					move([1, 3], [1, 4]),
				],
			},
		]);
		for (const x of [-1, 0, 1]) {
			expect(await w.pieceAt(x, 4)).toEqual(`P@${x},4#${a}`);
			expect(await w.pieceAt(x, 2)).toEqual(undefined);
		}
	});

	it('refuses the whole move when a fourth piece-move is chained or in the chunk, when one piece moves twice, or when two go to one square', async function () {
		const w = await world();
		const [a] = await w.deploy([[w.alice, [0, 0]]]);
		const four = [
			move([-1, 2], [-1, 3]),
			move([0, 2], [0, 3]),
			move([1, 2], [1, 3]),
			move([-2, 1], [-3, 1]),
		];
		// Each of these is legal alone; together they are not one move.
		const refused: [Move[], RegExp, number][] = [
			// Chained after a chunk of three: the base would accept it.
			[four, /OneMovePerCycle/, 3],
			// Four in one chunk, wider than the game's: the base refuses it.
			[four, /TooManyActions/, 4],
			// One piece twice: the pawn (1,2) up and right.
			[[move([1, 2], [1, 3]), move([1, 2], [2, 2])], /OneMovePerCycle/, 3],
			// Two to one square: the knight (0,1) and the pawn (1,2) to (1,3).
			[[move([0, 1], [1, 3]), move([1, 2], [1, 3])], /OneMovePerCycle/, 3],
		];
		for (const [moves, error, chunk] of refused) {
			const snap = await networkHelpers.takeSnapshot();
			await w.env.execute(w.Game, {
				account: w.alice,
				functionName: 'makeCommitment',
				args: [
					a,
					commitmentHashFor(moves, SECRET, chunk),
					TURN_BOND,
					zeroAddress,
				],
			});
			await w.toRevealPhase();
			await expect(
				revealTurn(w, {
					account: w.alice,
					identity: a,
					moves,
					secret: SECRET,
					actionsPerReveal: chunk,
				}),
			).toBeRejectedWith(error);
			await snap.restore();
		}
	});

	it('lets a piece move onto, or slide through, a square its own army vacates that cycle, in whichever order they are listed', async function () {
		// Alone, the rook's slide is blocked by alice's own pawn.
		const v = await world();
		const [army] = await v.deploy([[v.alice, [0, 0]]]);
		await v.commit(v.alice, army, [VACATING[1]]);
		await v.toRevealPhase();
		await expect(v.reveal(v.alice, army, [VACATING[1]])).toBeRejectedWith(
			/IllegalMove/,
		);

		let first: string[] | undefined;
		let a = 0n;
		for (const listed of permutations(VACATING)) {
			const w = await world();
			[a] = await w.deploy([[w.alice, [0, 0]]]);
			await w.play([{owner: w.alice, army: a, moves: listed}]);
			const board = await w.board();
			if (first) expect(board).toEqual(first);
			else first = board;
		}
		const w = await world();
		[a] = await w.deploy([[w.alice, [0, 0]]]);
		await w.play([{owner: w.alice, army: a, moves: VACATING}]);
		expect(await w.pieceAt(-2, 2)).toEqual(`P@-2,2#${a}`);
		expect(await w.pieceAt(-1, 4)).toEqual(`R@-1,4#${a}`);
		expect(await w.pieceAt(-1, 1)).toEqual(`Q@-1,1#${a}`);
		expect(await w.pieceAt(-1, 2)).toEqual(undefined);
		expect(await w.pieceAt(-1, 0)).toEqual(undefined);
		expect((await w.board()).length).toEqual(20);
	});

	it('swaps two pieces', async function () {
		const w = await world();
		const [a] = await w.deploy([[w.alice, [0, 0]]]);
		// The rook (-1,1) down onto the queen's square, the queen up onto the
		// rook's: each lands on a square the other leaves.
		await w.play([
			{
				owner: w.alice,
				army: a,
				moves: [move([-1, 1], [-1, 0]), move([-1, 0], [-1, 1])],
			},
		]);
		expect(await w.pieceAt(-1, 0)).toEqual(`R@-1,0#${a}`);
		expect(await w.pieceAt(-1, 1)).toEqual(`Q@-1,1#${a}`);
		expect((await w.board()).length).toEqual(20);
	});
});

/** alice and bob, with bob's knight (6,-1) on his empty corner (4,-2). */
async function knightOnTheCorner(order: RevealOrder) {
	const w = await world();
	const [a, b] = await w.deploy([
		[w.alice, [0, 0]],
		[w.bob, [1, 0]],
	]);
	const stakes = new Map((await w.registry()).map((r) => [r.id, r.stake]));
	await w.play(
		[
			{owner: w.alice, army: a, moves: []},
			{owner: w.bob, army: b, moves: [move([6, -1], [4, -2])]},
		],
		order,
	);
	return {w, a, b, stakes};
}

describe('three piece-moves meeting another army, in every reveal order', function () {
	it('kills both a piece landing on a square its own piece vacates and the enemy arriving there', async function () {
		// alice's pawn (2,-1) steps right, her rook (1,-1) takes its square,
		// and bob's knight jumps onto it from (4,-2) to take the pawn: two
		// arrivals, no king, both die (`docs/adr/0003`).
		const {w, a, b, stakes} = await inEveryOrder(async (order) => {
			const s = await knightOnTheCorner(order);
			await s.w.play(
				[
					{
						owner: s.w.alice,
						army: s.a,
						moves: [move([2, -1], [3, -1]), move([1, -1], [2, -1])],
					},
					{owner: s.w.bob, army: s.b, moves: [move([4, -2], [2, -1])]},
				],
				order,
			);
			return s;
		});
		expect(await w.pieceAt(2, -1)).toEqual(undefined);
		expect(await w.pieceAt(1, -1)).toEqual(undefined);
		expect(await w.pieceAt(3, -1)).toEqual(`P@3,-1#${a}`);
		expect(await w.pieceAt(4, -2)).toEqual(undefined);
		expect((await w.outcomes()).lines).toEqual([
			'2,-1 died=2 captured=- now=-',
		]);
		const registry = await w.registry();
		expect(registry.map((r) => [r.status, r.stake])).toEqual([
			[DEPLOYED, stakes.get(a)!],
			[DEPLOYED, stakes.get(b)!],
		]);
	});

	it('swaps two pieces while an enemy arrives on one of the swapped squares', async function () {
		// bob's knight goes on to (2,-3), then jumps onto alice's rook (1,-1)
		// as the rook and the pawn (2,-1) swap: alice's pawn and bob's knight
		// both arrive on (1,-1) and die, alice's rook lands on (2,-1).
		const {w, a, b, stakes} = await inEveryOrder(async (order) => {
			const s = await knightOnTheCorner(order);
			await s.w.play(
				[
					{owner: s.w.alice, army: s.a, moves: []},
					{owner: s.w.bob, army: s.b, moves: [move([4, -2], [2, -3])]},
				],
				order,
			);
			await s.w.play(
				[
					{
						owner: s.w.alice,
						army: s.a,
						moves: [move([1, -1], [2, -1]), move([2, -1], [1, -1])],
					},
					{owner: s.w.bob, army: s.b, moves: [move([2, -3], [1, -1])]},
				],
				order,
			);
			return s;
		});
		expect(await w.pieceAt(2, -1)).toEqual(`R@2,-1#${a}`);
		expect(await w.pieceAt(1, -1)).toEqual(undefined);
		expect(await w.pieceAt(2, -3)).toEqual(undefined);
		expect((await w.outcomes()).lines).toEqual([
			'1,-1 died=2 captured=- now=-',
		]);
		const registry = await w.registry();
		expect(registry.map((r) => [r.status, r.stake])).toEqual([
			[DEPLOYED, stakes.get(a)!],
			[DEPLOYED, stakes.get(b)!],
		]);
	});

	/**
	 * THE CHASE ENDS IN A TRADE: bob's knight takes alice's pawn (2,-1), one
	 * jump from her king; as it jumps onto the king, the king steps away to its
	 * empty core square (1,0) and alice's queen (-1,0) lands on the square it
	 * left. Two arrivals and no king there: both die.
	 */
	async function chaseTrade(order: RevealOrder) {
		const s = await knightOnTheCorner(order);
		await s.w.play(
			[
				{owner: s.w.alice, army: s.a, moves: []},
				{owner: s.w.bob, army: s.b, moves: [move([4, -2], [2, -1])]},
			],
			order,
		);
		await s.w.play(
			[
				{
					owner: s.w.alice,
					army: s.a,
					moves: [move([0, 0], [1, 0]), move([-1, 0], [0, 0])],
				},
				{owner: s.w.bob, army: s.b, moves: [move([2, -1], [0, 0])]},
			],
			order,
		);
		return s;
	}

	it('ends the chase in a trade: the king steps away, its piece and the enemy land where it stood, and both die', async function () {
		const {w, a, b, stakes} = await inEveryOrder(chaseTrade);
		expect(await w.pieceAt(1, 0)).toEqual(`K@1,0#${a}`);
		expect(await w.pieceAt(0, 0)).toEqual(undefined);
		expect(await w.pieceAt(-1, 0)).toEqual(undefined);
		expect(await w.pieceAt(2, -1)).toEqual(undefined);
		expect((await w.outcomes()).lines).toEqual(['0,0 died=2 captured=- now=-']);
		const registry = await w.registry();
		expect(registry.map((r) => [r.status, r.capturedBy, r.stake])).toEqual([
			[DEPLOYED, 0n, stakes.get(a)!],
			[DEPLOYED, 0n, stakes.get(b)!],
		]);
	});

	it('notes no army as its own prey when its piece lands where its own king stood', async function () {
		for (const order of REVEAL_ORDERS) {
			const {w, a} = await chaseTrade(order);
			expect(await capturesBy(w, a)).toEqual([]);
		}
	});

	/**
	 * A CAPTOR WHOSE KING MOVES AND FALLS ELSEWHERE (`docs/adr/0014`, amended
	 * by 0016): alice's rook takes carol's standing king on (2,4) in the cycle
	 * alice's own king steps onto (1,-1) and meets exactly one piece there,
	 * bob's knight. alice falls, so carol's king is a stone that keeps carol's
	 * stake, and alice's is bob's.
	 *
	 *   cycle 1: alice's pawn (2,-1) steps down to (2,-2) and her rook (1,-1)
	 *            slides through its square to (3,-1); bob's knight to (4,-2);
	 *            carol's rook (1,5) onto her core (1,6) and her king onto
	 *            (1,5), the square it leaves.
	 *   cycle 2: alice's rook up the empty column to (3,4); bob's knight to
	 *            (2,-3); carol's king to her corner (2,4).
	 *   cycle 3: alice's king to (1,-1) and her rook onto carol's king; bob's
	 *            knight onto (1,-1); carol passes.
	 */
	async function captorKingFallsElsewhere(order: RevealOrder) {
		const w = await world();
		const [a, b, c] = await w.deploy([
			[w.alice, [0, 0]],
			[w.bob, [1, 0]],
			[w.carol, [0, 1]],
		]);
		const stakes = new Map((await w.registry()).map((r) => [r.id, r.stake]));
		const cycles: [Move[], Move[], Move[]][] = [
			[
				[move([2, -1], [2, -2]), move([1, -1], [3, -1])],
				[move([6, -1], [4, -2])],
				[move([1, 5], [1, 6]), move([0, 6], [1, 5])],
			],
			[
				[move([3, -1], [3, 4])],
				[move([4, -2], [2, -3])],
				[move([1, 5], [2, 4])],
			],
			[
				[move([0, 0], [1, -1]), move([3, 4], [2, 4])],
				[move([2, -3], [1, -1])],
				[],
			],
		];
		for (const [alice, bob, carol] of cycles) {
			await w.play(
				[
					{owner: w.alice, army: a, moves: alice},
					{owner: w.bob, army: b, moves: bob},
					{owner: w.carol, army: c, moves: carol},
				],
				order,
			);
		}
		return {w, a, b, c, stakes};
	}

	it("leaves a stone where a captor's rook takes a standing king while the captor's own king moves and falls elsewhere", async function () {
		const {w, a, b, c, stakes} = await inEveryOrder(captorKingFallsElsewhere);
		expect(await w.pieceAt(2, 4)).toEqual(`S@2,4#${c}`);
		expect(await w.pieceAt(1, -1)).toEqual(`Q@1,-1#${b}`);
		expect((await w.board()).filter((l) => l.endsWith(`#${a}`))).toEqual([]);
		expect((await entry(w, a)).capturedBy).toEqual(b);
		const carol = await entry(w, c);
		expect([carol.status, carol.capturedBy, carol.stake]).toEqual([
			CAPTURED,
			0n,
			stakes.get(c)!,
		]);
		const bob = await entry(w, b);
		expect([bob.status, bob.stake]).toEqual([
			DEPLOYED,
			stakes.get(b)! + stakes.get(a)!,
		]);
		expect((await w.outcomes()).lines).toEqual([
			`1,-1 died=1 captured=- now=Q@1,-1#${b}`,
			`2,4 died=0 captured=K@2,4#${c} now=S@2,4#${c}`,
		]);
	});
});
