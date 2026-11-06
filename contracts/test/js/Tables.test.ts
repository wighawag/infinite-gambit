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
 *   seat 0 at (0,0) facing North (king (-2,0), knight (0,0)),
 *   seat 1 at (6,0) facing East (king (6,1), pawns facing West on x=4),
 *   seat 2 at (6,6) facing North (queen (7,5)).
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
		expect(await t.pieceAt(-2, 0)).toEqual(`K@-2,0#${a}:N`);
		expect(await t.pieceAt(6, 1)).toEqual(`K@6,1#${b}:E`);
		const after = await t.army(b);
		expect([after.status, after.king]).toEqual([DEPLOYED, {x: 6, y: 1}]);

		// And it plays: a first move lands.
		await t.play([
			{owner: w.alice, army: a, moves: [move([0, 0], [2, 1])]},
			{owner: w.bob, army: b, moves: []},
			{owner: w.carol, army: c, moves: []},
		]);
		expect(await t.pieceAt(2, 1)).toEqual(`N@2,1#${a}:N*`);
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
		expect(await t.pieceAt(-2, 0)).toEqual(undefined);
		expect(await t.pieceAt(-2, 6)).toEqual(`K@-2,6#${d}:N`);
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
		// (-3,3) is an exit of a 6-grid: half the spacing off a spawn point.
		for (const step of [
			move([-2, 0], [-3, 1]),
			move([-3, 1], [-3, 2]),
			move([-3, 2], [-3, 3]),
		]) {
			await t.play([
				{owner: w.alice, army: a, moves: [step]},
				{owner: w.bob, army: b, moves: []},
			]);
		}
		// And one more cycle, so a touch has folded the exit square's facts.
		await t.play([
			{owner: w.alice, army: a, moves: [move([0, 1], [0, 2])]},
			{owner: w.bob, army: b, moves: []},
		]);
		expect(await t.read<boolean>('isExited', [a])).toEqual(false);
		await expect(t.execute(w.carol, 'exit', [a])).toBeRejectedWith('NotExited');
		expect(await t.pieceAt(-3, 3)).toEqual(`K@-3,3#${a}:N*`);
		const army = await t.army(a);
		expect([army.status, army.king, army.stake]).toEqual([
			DEPLOYED,
			{x: -3, y: 3},
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

		// dave's queen, (7,5) to (8,4) to (8,3), takes bob's king on (6,1);
		// bob only passes, with empty commitments.
		for (const step of [
			move([7, 5], [8, 4]),
			move([8, 4], [8, 3]),
			move([8, 3], [6, 1]),
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
			{owner: w.alice, army: a, moves: [move([0, 0], [2, 1])]},
			{owner: w.bob, army: b, moves: []},
		]);
		await expect(t.claim(a)).toBeRejectedWith('TableNotOver');
		await expect(t.execute(w.carol, 'tally', [1n])).toBeRejectedWith(
			'TableNotOver',
		);
		await t.play([
			{owner: w.alice, army: a, moves: [move([2, 1], [4, 0])]},
			{owner: w.bob, army: b, moves: []},
		]);
		// Past the last cycle: nobody commits, and the board is final.
		await expect(t.commit(w.alice, a, [])).toBeRejectedWith('GameEnded');
		expect((await t.outcome()).over).toEqual(true);
		expect((await t.outcome()).winner).toEqual(0n);

		// The count, a few steps at a time: 24 steps are alice's footprint,
		// whose untouched squares hold all of her but the knight.
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
		await t.commit(w.alice, a, [move([0, 1], [0, 2])]);
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
