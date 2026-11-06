import {expect} from 'earl';
import {describe, it} from 'node:test'; // using node:test as hardhat v3 do not support vitest
import {network} from 'hardhat';
import {setupFixtures, DEFAULT_STAKE, idOf} from './utils/index.js';
import {move} from './utils/moves-world.js';
import {tableWorld} from './utils/table-world.js';

/**
 * TABLES (`work/specs/tasked/infinite-chess.md`, stories 38 to 42): the same
 * rules as the world, for a closed roster, with a winner.
 *
 * - THE SEAT IS THE ARMY: buying a seat creates an army on the table's next
 *   spawn point, from a counter that only increases, so a leaver leaves a gap.
 * - The armies are INERT and HIDDEN until the table starts (no start hook).
 * - NO EXITS: a king on an exit square is only a king on a square.
 * - THE PAYOUT: the last king standing takes every stake; at the cycle cap the
 *   stakes are split by material (pawn 1, knight 3, bishop 3, rook 5, queen 9).
 * - EARLY ADVANCE: a table moves as soon as every live seat has acted (a pass
 *   is an empty commitment), captured and frozen armies no longer counted.
 *
 * The tables here are on the tightest grid (`utils/table-world.ts`), so their
 * seats stand where the move suites' armies do:
 *
 *   seat 0 at (0,0), seat 1 at (6,0), seat 2 at (6,6), seat 3 at (0,6),
 *   every king on its spawn point, every army the one layout.
 */

const {provider, networkHelpers} = await network.connect();
const {deployAll} = setupFixtures(provider);
const world = tableWorld({deployAll, loadFixture: networkHelpers.loadFixture});

const DEPLOYING = 1;
const DEPLOYED = 2;
const CANCELLED = 5;
const CAPTURED = 6;

/** Material of a whole army: 12 pawns, 2 knights, 2 bishops, 2 rooks, a queen. */
const ARMY_MATERIAL = 12n + 2n * 3n + 2n * 3n + 2n * 5n + 9n;

describe('a table', function () {
	it('is created, seated and started: each purchase creates an army on the next spawn point, inert and hidden until the start', async function () {
		const w = await world();
		const t = await w.create(3);
		const a = await t.buy(w.alice);
		const b = await t.buy(w.bob);
		// A purchase paid by somebody else seats the account it names.
		const c = await t.buy(w.carol, w.dave);

		expect(await t.members()).toEqual([a, b, c]);
		// No account reserve: the stake is the army's.
		expect(await t.read<bigint>('getReserve', [idOf(w.alice)])).toEqual(0n);
		expect(await t.read<bigint>('getReserve', [a])).toEqual(DEFAULT_STAKE);
		const before = await t.army(b);
		expect([before.owner, before.status, before.spawnPoint]).toEqual([
			w.bob.toLowerCase(),
			DEPLOYING,
			{x: 6, y: 0},
		]);
		expect((await t.army(c)).spawnPoint).toEqual({x: 6, y: 6});

		// Hidden, a cycle later too, and inert: nobody can commit before the start.
		await t.byTheClock();
		await t.byTheClock();
		if (!(await t.cycle()).commiting) await t.byTheClock();
		expect(await t.pieces()).toEqual([]);
		await expect(t.commit(w.alice, a, [])).toBeRejectedWith('NotInGame');
		// A full table refuses a fourth seat; a seat costs exactly one stake.
		await expect(t.buy(w.dave)).toBeRejectedWith('GameFull');

		await t.start();
		expect((await t.attendance()).waitedFor).toEqual(3n);
		expect((await t.pieces()).length).toEqual(60);
		expect(await t.pieceAt(0, 0)).toEqual(`K@0,0#${a}`);
		expect(await t.pieceAt(6, 0)).toEqual(`K@6,0#${b}`);
		const after = await t.army(b);
		expect([after.status, after.king]).toEqual([DEPLOYED, {x: 6, y: 0}]);

		// And it plays: a first move lands.
		await t.play([
			{owner: w.alice, army: a, moves: [move([0, 1], [2, 2])]},
			{owner: w.bob, army: b, moves: []},
			{owner: w.carol, army: c, moves: []},
		]);
		expect(await t.pieceAt(2, 2)).toEqual(`N@2,2#${a}`);
		await expect(t.buy(w.dave)).toBeRejectedWith('GameAlreadyStarted');
	});

	it('refuses a seat bought with anything but one stake, and an account deployment', async function () {
		const w = await world();
		const t = await w.create(2);
		await expect(
			t.execute(w.alice, 'addToReserve', [idOf(w.alice), DEFAULT_STAKE / 2n]),
		).toBeRejectedWith('WrongStake');
		await expect(
			t.execute(w.alice, 'addToReserve', [
				(1n << 160n) | BigInt(w.alice),
				DEFAULT_STAKE,
			]),
		).toBeRejectedWith('InvalidPlayer');
	});

	it('lets a seated owner leave with the whole stake before the start, leaving a gap that moves nobody, and not after', async function () {
		const w = await world();
		const t = await w.create(3);
		const a = await t.buy(w.alice);
		const b = await t.buy(w.bob);
		const c = await t.buy(w.carol);

		// Only the owner, never someone else.
		await expect(t.execute(w.bob, 'leaveTable', [a])).toBeRejectedWith(
			'NotArmyOwner',
		);
		const tokens = await t.tokensOf(w.alice);
		await t.execute(w.alice, 'leaveTable', [a]);
		expect((await t.tokensOf(w.alice)) - tokens).toEqual(DEFAULT_STAKE);
		expect(await t.read<bigint>('getReserve', [a])).toEqual(0n);
		expect((await t.army(a)).status).toEqual(CANCELLED);
		expect([...(await t.members())].sort()).toEqual([b, c].sort());
		await expect(t.execute(w.alice, 'leaveTable', [a])).toBeRejectedWith(
			'InvalidPlayer',
		);

		// The freed seat is taken again, on a NEW spawn point: the counter only
		// increases, and nobody else's spawn point moved.
		const d = await t.buy(w.dave);
		expect((await t.army(b)).spawnPoint).toEqual({x: 6, y: 0});
		expect((await t.army(c)).spawnPoint).toEqual({x: 6, y: 6});
		expect((await t.army(d)).spawnPoint).toEqual({x: 0, y: 6});

		await t.start();
		// The leaver's army is gone from the board: three armies, none at (0,0).
		expect((await t.pieces()).length).toEqual(60);
		expect(await t.pieceAt(0, 0)).toEqual(undefined);
		expect(await t.pieceAt(0, 6)).toEqual(`K@0,6#${d}`);
		await expect(t.execute(w.bob, 'leaveTable', [b])).toBeRejectedWith(
			'GameAlreadyStarted',
		);
	});

	it('has no exits: a king that lands alone on an exit square stays, and nothing is paid', async function () {
		const w = await world();
		const t = await w.create(2);
		const a = await t.buy(w.alice);
		const b = await t.buy(w.bob);
		await t.start();
		// (3,-2) is an exit of a 6-grid: in the 2 by 2 block (3..4, -3..-2) at
		// the centre of a cell. alice's rook steps aside and her king walks
		// there by (1,-1) and her empty corner (2,-2).
		for (const step of [
			move([1, -1], [1, 0]),
			move([0, 0], [1, -1]),
			move([1, -1], [2, -2]),
			move([2, -2], [3, -2]),
		]) {
			await t.play([
				{owner: w.alice, army: a, moves: [step]},
				{owner: w.bob, army: b, moves: []},
			]);
		}
		// And one more cycle, so a touch has folded the exit square's facts.
		await t.play([
			{owner: w.alice, army: a, moves: [move([0, 2], [0, 3])]},
			{owner: w.bob, army: b, moves: []},
		]);
		expect(await t.read<boolean>('isExited', [a])).toEqual(false);
		await expect(t.execute(w.carol, 'exit', [a])).toBeRejectedWith('NotExited');
		expect(await t.pieceAt(3, -2)).toEqual(`K@3,-2#${a}`);
		const army = await t.army(a);
		expect([army.status, army.king, army.stake]).toEqual([
			DEPLOYED,
			{x: 3, y: -2},
			DEFAULT_STAKE,
		]);
	});

	it('pays the last king standing every stake, and advances early once the captured army is no longer waited for', async function () {
		const w = await world();
		const t = await w.create(3);
		// alice takes seat 0 and leaves, so bob and dave keep seats 1 and 2.
		const a = await t.buy(w.alice);
		const b = await t.buy(w.bob);
		const d = await t.buy(w.dave);
		await t.execute(w.alice, 'leaveTable', [a]);
		await t.start();
		await expect(t.claim(d)).toBeRejectedWith('TableNotOver');

		// dave's knight, by (7,3) and bob's pawn (5,2), takes bob's king on
		// (6,0); bob only passes, with empty commitments.
		for (const step of [
			move([6, 5], [7, 3]),
			move([7, 3], [5, 2]),
			move([5, 2], [6, 0]),
		]) {
			await t.play([
				{owner: w.dave, army: d, moves: [step]},
				{owner: w.bob, army: b, moves: []},
			]);
		}
		expect((await t.army(b)).status).toEqual(CAPTURED);
		const outcome = await t.outcome();
		expect([outcome.over, outcome.winner, outcome.settled]).toEqual([
			true,
			d,
			false,
		]);

		// Early advance: only dave is live, so his commitment alone opens the
		// reveal phase and his reveal alone ends the cycle.
		const {cycleNumber} = await t.cycle();
		await t.commit(w.dave, d, []);
		await t.advance();
		expect((await t.cycle()).commiting).toEqual(false);
		await t.reveal(w.dave, d, []);
		await t.advance();
		expect((await t.cycle()).cycleNumber).toEqual(cycleNumber + 1n);
		expect((await t.attendance()).waitedFor).toEqual(1n);

		// Anyone may claim for dave: every stake on the table, in ETH, to him.
		await expect(t.claim(b)).toBeRejectedWith('NothingToClaim');
		const eth = await t.ethOf(w.dave);
		await t.claim(d);
		expect((await t.ethOf(w.dave)) - eth).toEqual(2n * t.price);
		expect(await t.share(d)).toEqual(2n * DEFAULT_STAKE);
		await expect(t.claim(d)).toBeRejectedWith('AlreadyPaid');
		expect((await t.outcome()).pot).toEqual(2n * DEFAULT_STAKE);
	});

	it('splits the stakes by material at the cycle cap, counted in parts by anyone, each claimed once', async function () {
		const w = await world();
		const t = await w.create(2, 2);
		const a = await t.buy(w.alice);
		const b = await t.buy(w.bob);
		await t.start();
		// alice's knight takes one of bob's pawns: 43 against 42.
		await t.play([
			{owner: w.alice, army: a, moves: [move([0, 1], [2, 2])]},
			{owner: w.bob, army: b, moves: []},
		]);
		await expect(t.claim(a)).toBeRejectedWith('TableNotOver');
		await expect(t.execute(w.carol, 'tally', [1n])).toBeRejectedWith(
			'TableNotOver',
		);
		await t.play([
			{owner: w.alice, army: a, moves: [move([2, 2], [4, 1])]},
			{owner: w.bob, army: b, moves: []},
		]);
		// Past the last cycle: nobody commits, and the board is final.
		await expect(t.commit(w.alice, a, [])).toBeRejectedWith('GameEnded');
		expect((await t.outcome()).over).toEqual(true);
		expect((await t.outcome()).winner).toEqual(0n);

		// The count, a few steps at a time: 25 steps are alice's 5 by 5
		// square, whose untouched squares hold all of her but the knight (the
		// 25th, a corner, holds nothing).
		for (let k = 0; k < 3; k++) await t.execute(w.carol, 'tally', [8n]);
		const counted = await t.outcome();
		expect([counted.tallied, counted.totalMaterial]).toEqual([
			false,
			ARMY_MATERIAL - 3n,
		]);

		const pot = 2n * DEFAULT_STAKE;
		const total = 2n * ARMY_MATERIAL - 1n;
		const ethA = await t.ethOf(w.alice);
		const ethB = await t.ethOf(w.bob);
		await t.claim(a);
		await t.claim(b);
		const settled = await t.outcome();
		expect([settled.tallied, settled.totalMaterial, settled.pot]).toEqual([
			true,
			total,
			pot,
		]);
		const shareA = (pot * ARMY_MATERIAL) / total;
		const shareB = (pot * (ARMY_MATERIAL - 1n)) / total;
		expect(await t.share(a)).toEqual(shareA);
		expect(await t.share(b)).toEqual(shareB);
		const price = (amount: bigint) => (amount * t.price) / DEFAULT_STAKE;
		expect((await t.ethOf(w.alice)) - ethA).toEqual(price(shareA));
		expect((await t.ethOf(w.bob)) - ethB).toEqual(price(shareB));
		await expect(t.claim(a)).toBeRejectedWith('AlreadyPaid');
	});

	it('advances early again once a missed reveal has frozen an army', async function () {
		const w = await world();
		const t = await w.create(2);
		const a = await t.buy(w.alice);
		const b = await t.buy(w.bob);
		await t.start();

		// alice commits a move and never reveals it; bob passes.
		await t.commit(w.alice, a, [move([0, 2], [0, 3])]);
		await t.commit(w.bob, b, []);
		await t.advance();
		await t.reveal(w.bob, b, []);
		await t.byTheClock();
		expect(await t.read<boolean>('isFrozen', [a])).toEqual(true);

		// bob alone is live now: his empty commitment and reveal move it on.
		const {cycleNumber} = await t.cycle();
		await t.commit(w.bob, b, []);
		await t.advance();
		await t.reveal(w.bob, b, []);
		await t.advance();
		expect((await t.cycle()).cycleNumber).toEqual(cycleNumber + 1n);
		// A frozen king still stands, so nobody has won yet.
		expect((await t.outcome()).over).toEqual(false);
	});
});

/**
 * THE CHAIN OF `Stones.test.ts` AT A TABLE: seat 2's knight takes seat 1's
 * king on (6,0) while seat 3's knight takes seat 2's king on (6,6): seat 1's
 * king is a stone holding its stake, and seat 3's knight is a queen.
 */
async function chainAtATable(
	t: Awaited<ReturnType<Awaited<ReturnType<typeof world>>['create']>>,
	owners: {
		b: [`0x${string}`, bigint];
		d: [`0x${string}`, bigint];
		c: [`0x${string}`, bigint];
	},
	others: {owner: `0x${string}`; army: bigint; moves: []}[],
) {
	const [bob, b] = owners.b;
	const [dave, d] = owners.d;
	const [carol, c] = owners.c;
	const pass = (owner: `0x${string}`, army: bigint) => ({
		owner,
		army,
		moves: [],
	});
	for (const [daveStep, carolStep] of [
		[move([6, 5], [7, 3]), move([0, 7], [2, 8])],
		[move([7, 3], [5, 2]), move([2, 8], [4, 7])],
	]) {
		await t.play([
			{owner: dave, army: d, moves: [daveStep]},
			pass(bob, b),
			{owner: carol, army: c, moves: [carolStep]},
			...others,
		]);
	}
	await t.play([
		{owner: dave, army: d, moves: [move([5, 2], [6, 0])]},
		{owner: carol, army: c, moves: [move([4, 7], [6, 6])]},
		pass(bob, b),
		...others,
	]);
}

describe('a table with a stone on it', function () {
	it("counts a promoted queen as 9 and a stone as nothing at the cap, and splits the untaken stone's stake with the rest", async function () {
		const w = await world();
		const t = await w.create(4, 3);
		const a = await t.buy(w.alice);
		const b = await t.buy(w.bob);
		const d = await t.buy(w.dave);
		const c = await t.buy(w.carol);
		await t.start();
		await chainAtATable(t, {b: [w.bob, b], d: [w.dave, d], c: [w.carol, c]}, [
			{owner: w.alice, army: a, moves: []},
		]);
		expect(await t.pieceAt(6, 0)).toEqual(`S@6,0#${b}`);
		expect(await t.pieceAt(6, 6)).toEqual(`Q@6,6#${c}`);
		expect((await t.outcome()).over).toEqual(true);
		await t.claim(a);
		await t.claim(c);
		// carol's army lost a knight and gained a queen; the stone counts for
		// nobody, and the pot is all four stakes, the stone's included.
		const carolMaterial = ARMY_MATERIAL - 3n + 9n;
		const total = ARMY_MATERIAL + carolMaterial;
		const pot = 4n * DEFAULT_STAKE;
		const settled = await t.outcome();
		expect([settled.totalMaterial, settled.pot]).toEqual([total, pot]);
		expect(await t.share(a)).toEqual((pot * ARMY_MATERIAL) / total);
		expect(await t.share(c)).toEqual((pot * carolMaterial) / total);
		await expect(t.claim(b)).toBeRejectedWith('NothingToClaim');
		await expect(t.claim(d)).toBeRejectedWith('NothingToClaim');
	});

	it("pays the last king standing every stake, the stone's included", async function () {
		const w = await world();
		const t = await w.create(4);
		// alice takes seat 0 and leaves, so seats 1 to 3 stand where they play.
		const a = await t.buy(w.alice);
		const b = await t.buy(w.bob);
		const d = await t.buy(w.dave);
		const c = await t.buy(w.carol);
		await t.execute(w.alice, 'leaveTable', [a]);
		await t.start();
		await chainAtATable(
			t,
			{b: [w.bob, b], d: [w.dave, d], c: [w.carol, c]},
			[],
		);
		const outcome = await t.outcome();
		expect([outcome.over, outcome.winner]).toEqual([true, c]);
		const eth = await t.ethOf(w.carol);
		await t.claim(c, w.bob);
		expect((await t.ethOf(w.carol)) - eth).toEqual(3n * t.price);
		expect((await t.outcome()).pot).toEqual(3n * DEFAULT_STAKE);
	});
});
