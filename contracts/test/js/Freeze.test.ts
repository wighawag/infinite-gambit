import {expect} from 'earl';
import {describe, it} from 'node:test'; // using node:test as hardhat v3 do not support vitest
import {network} from 'hardhat';
import {DEFAULT_STAKE, commitmentChain, setupFixtures} from './utils/index.js';
import {movesWorld, move} from './utils/moves-world.js';

/**
 * A MISSED REVEAL FREEZES THE ARMY FOREVER (stories 36 and 37,
 * `docs/adr/0005-missed-reveal-freezes-the-army.md`): it never moves again,
 * its king cannot exit, and it can still be captured, its pieces joining the
 * captor. Its stake stays on the board as prey: the freeze takes nothing.
 *
 * FROZEN IS A DEFINITION, NOT JUST A FLAG. The base only runs `_forfeit` when
 * somebody settles the missed reveal, so an army is frozen from the moment its
 * reveal window closes: its frozen flag is set OR it holds an unrevealed
 * commitment from a past cycle (`isFrozen`).
 *
 * The world is `utils/moves-world.ts`'s tight grid: alice at spawn (0,0), bob
 * at (6,0) facing East with his king on (6,1), carol at (0,6) and dave at
 * (6,6). alice's king, on (-2,0), reaches the exit (-3,3) in three steps.
 */

const {provider, networkHelpers} = await network.connect();
const {deployAll} = setupFixtures(provider);
const world = movesWorld({
	deployAll,
	loadFixture: networkHelpers.loadFixture,
});

type World = Awaited<ReturnType<typeof world>>;

const DEPLOYED = 2;
const UNREVEALED = 4;
const CAPTURED = 6;
const FROZEN = 8;

const ALICE_PAWN = move([0, 1], [0, 2]);
const ALICE_TO_EXIT = [
	move([-2, 0], [-3, 1]),
	move([-3, 1], [-3, 2]),
	move([-3, 2], [-3, 3]),
];

function read<T>(w: World, functionName: string, args: unknown[] = []) {
	return w.env.read(w.Game, {functionName, args} as never) as Promise<T>;
}

const isFrozen = (w: World, army: bigint) =>
	read<boolean>(w, 'isFrozen', [army]);
const reserveOf = (w: World, id: bigint) => read<bigint>(w, 'getReserve', [id]);
const armyView = (w: World, army: bigint) =>
	read<{status: number; stake: bigint; mergedInto: bigint; king: bigint}>(
		w,
		'getArmy',
		[army],
	);

/** Every piece of `army` on the board, as lines. */
async function piecesOf(w: World, army: bigint): Promise<string[]> {
	return (await w.board()).filter((l) => l.includes(`#${army}:`));
}

/** alice commits `moves` and never reveals them; bob passes, and reveals. */
async function aliceMisses(
	w: World,
	a: bigint,
	b: bigint,
	moves = [ALICE_PAWN],
) {
	await w.commit(w.alice, a, moves);
	await w.commit(w.bob, b, []);
	await w.toRevealPhase();
	await w.reveal(w.bob, b, []);
	await w.toNextCycle();
}

/** Settle alice's missed reveal by `path`. */
async function settle(
	w: World,
	path: 'acknowledgeMissedReveal' | 'forfeitMissedReveal',
	a: bigint,
	moves = [ALICE_PAWN],
) {
	if (path === 'acknowledgeMissedReveal') {
		// Shown the move, by anyone.
		const {chunks} = commitmentChain(moves, SECRET_OF_WORLD, 1);
		await w.env.execute(w.Game, {
			account: w.carol,
			functionName: path,
			args: [a, chunks[0].moves, SECRET_OF_WORLD, chunks[0].furtherActions],
		});
	} else {
		await w.env.execute(w.Game, {
			account: w.alice,
			functionName: path,
			args: [a],
		});
	}
}

// `utils/moves-world.ts`'s secret, which every commitment there is made with.
const SECRET_OF_WORLD =
	'0x00000000000000000000000000000000000000000000000000000000000c0de1' as const;

describe('a missed reveal', function () {
	it('freezes the army from the moment its reveal window closes, before anyone settles it', async function () {
		const w = await world();
		const [a, b] = await w.deploy([
			[w.alice, [0, 0]],
			[w.bob, [1, 0]],
		]);
		const board = await piecesOf(w, a);
		expect(await isFrozen(w, a)).toEqual(false);
		await w.commit(w.alice, a, [ALICE_PAWN]);
		await w.commit(w.bob, b, []);
		await w.toRevealPhase();
		// Still revealable: not frozen during its own reveal phase.
		expect(await isFrozen(w, a)).toEqual(false);
		await w.reveal(w.bob, b, []);
		await w.toNextCycle();

		// Nobody has settled anything, and it is frozen already.
		expect(await isFrozen(w, a)).toEqual(true);
		expect(await isFrozen(w, b)).toEqual(false);
		const view = await armyView(w, a);
		expect(view.status).toEqual(FROZEN);
		// Its stake stays on the board, and so do its pieces, unmoved.
		expect(view.stake).toEqual(DEFAULT_STAKE);
		expect(await piecesOf(w, a)).toEqual(board);
		await expect(w.commit(w.alice, a, [])).toBeRejectedWith('NotInGame');
	});

	for (const path of [
		'acknowledgeMissedReveal',
		'forfeitMissedReveal',
	] as const) {
		it(`keeps the army frozen forever once settled by ${path}, and takes nothing from its stake`, async function () {
			const w = await world();
			const [a, b] = await w.deploy([
				[w.alice, [0, 0]],
				[w.bob, [1, 0]],
			]);
			const board = await piecesOf(w, a);
			await aliceMisses(w, a, b);
			await settle(w, path, a);

			expect(await isFrozen(w, a)).toEqual(true);
			expect(await reserveOf(w, a)).toEqual(DEFAULT_STAKE);
			const view = await armyView(w, a);
			expect([view.status, view.stake]).toEqual([FROZEN, DEFAULT_STAKE]);
			// The commitment is gone, and still nothing more may be committed.
			await expect(w.commit(w.alice, a, [])).toBeRejectedWith('NotInGame');
			await expect(w.commit(w.alice, a, [ALICE_PAWN])).toBeRejectedWith(
				'NotInGame',
			);
			// Cycles later, the same.
			await w.play([{owner: w.bob, army: b, moves: []}]);
			await w.play([{owner: w.bob, army: b, moves: []}]);
			expect(await isFrozen(w, a)).toEqual(true);
			expect((await armyView(w, a)).status).toEqual(FROZEN);
			expect(await piecesOf(w, a)).toEqual(board);
			await expect(w.commit(w.alice, a, [])).toBeRejectedWith('NotInGame');
		});
	}

	it('never lets a frozen king exit, whichever path settles it', async function () {
		const w = await world();
		const [a, b] = await w.deploy([
			[w.alice, [0, 0]],
			[w.bob, [1, 0]],
		]);
		for (const m of ALICE_TO_EXIT.slice(0, 2)) {
			await w.play([
				{owner: w.alice, army: a, moves: [m]},
				{owner: w.bob, army: b, moves: []},
			]);
		}
		// The step onto the exit is committed, and never revealed.
		await aliceMisses(w, a, b, [ALICE_TO_EXIT[2]]);
		expect(await isFrozen(w, a)).toEqual(true);
		expect(await read<boolean>(w, 'isExited', [a])).toEqual(false);
		await expect(
			w.env.execute(w.Game, {
				account: w.bob,
				functionName: 'exit',
				args: [a],
			}),
		).toBeRejectedWith(/NotExited/);

		// Settled with the move shown: the move is still not made.
		await settle(w, 'acknowledgeMissedReveal', a, [ALICE_TO_EXIT[2]]);
		await w.play([{owner: w.bob, army: b, moves: []}]);
		expect(await read<boolean>(w, 'isExited', [a])).toEqual(false);
		expect(await w.pieceAt(-3, 2)).toEqual(`K@-3,2#${a}:N*`);
		expect(await w.pieceAt(-3, 3)).toEqual(undefined);
		const view = await armyView(w, a);
		expect([view.status, view.stake]).toEqual([FROZEN, DEFAULT_STAKE]);
		await expect(
			w.env.execute(w.Game, {
				account: w.alice,
				functionName: 'exit',
				args: [a],
			}),
		).toBeRejectedWith(/NotExited/);
	});

	it('lets a frozen army be captured: its pieces come back to life under the captor, with its stake', async function () {
		const w = await world();
		const [, b, , d] = await w.deploy([
			[w.alice, [0, 0]],
			[w.bob, [1, 0]],
			[w.carol, [0, 1]],
			[w.dave, [1, 1]],
		]);
		const bobPieces = (await piecesOf(w, b)).length;
		// bob commits a move and goes quiet; dave's queen walks over.
		await w.commit(w.bob, b, [move([6, 1], [7, 2])]);
		await w.commit(w.dave, d, [move([7, 5], [8, 4])]);
		await w.toRevealPhase();
		await w.reveal(w.dave, d, [move([7, 5], [8, 4])]);
		await w.toNextCycle();
		expect(await isFrozen(w, b)).toEqual(true);
		await w.play([{owner: w.dave, army: d, moves: [move([8, 4], [8, 3])]}]);
		// The frozen king never moved, and is taken where it stands.
		expect(await w.pieceAt(6, 1)).toEqual(`K@6,1#${b}:E`);
		await w.play([{owner: w.dave, army: d, moves: [move([8, 3], [6, 1])]}]);

		const bob = await armyView(w, b);
		expect([bob.status, bob.mergedInto, bob.stake]).toEqual([CAPTURED, d, 0n]);
		const dave = await armyView(w, d);
		expect([dave.status, dave.stake]).toEqual([DEPLOYED, 2n * DEFAULT_STAKE]);
		expect(await piecesOf(w, b)).toEqual([]);
		expect((await piecesOf(w, d)).length).toEqual(2 * bobPieces - 1);
		// A piece that was frozen moves again, with dave's one move.
		await w.play([{owner: w.dave, army: d, moves: [move([4, 0], [3, 0])]}]);
		expect(await w.pieceAt(3, 0)).toEqual(`P@3,0#${d}:W*`);
	});

	it('still burns the stake of a deployment never revealed, which is not a freeze', async function () {
		const w = await world();
		const [a] = await w.commitDeployments([[w.alice, [0, 0]]]);
		await w.toRevealPhase();
		await w.toNextCycle();
		expect(await isFrozen(w, a)).toEqual(false);
		expect((await armyView(w, a)).status).toEqual(UNREVEALED);
		const supply = (await w.env.read(w.GameToken, {
			functionName: 'totalSupply',
		})) as bigint;
		await w.env.execute(w.Game, {
			account: w.alice,
			functionName: 'forfeitMissedReveal',
			args: [a],
		});
		expect(
			(await w.env.read(w.GameToken, {functionName: 'totalSupply'})) as bigint,
		).toEqual(supply - DEFAULT_STAKE);
		expect(await reserveOf(w, a)).toEqual(0n);
		expect(await isFrozen(w, a)).toEqual(false);
		expect((await armyView(w, a)).status).toEqual(UNREVEALED);
	});
});
