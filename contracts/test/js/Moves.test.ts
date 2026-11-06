import {expect} from 'earl';
import {describe, it} from 'node:test'; // using node:test as hardhat v3 do not support vitest
import {network} from 'hardhat';
import {setupFixtures, squareAt, xyOf} from './utils/index.js';
import {movesWorld, at, move, type Piece} from './utils/moves-world.js';

/**
 * MOVES: one per army per cycle, judged against the board as it stood at the
 * start of the cycle, recorded as order-free facts and resolved when a square
 * is next read (`docs/adr/0002-order-free-lazy-resolution.md`). The rule is
 * `ChessRules`, and the simulation route's `legalMoves` runs it without a
 * chain (`docs/adr/0007-rules-live-only-in-the-contract.md`), so the rule's
 * own cases are asserted through that route on boards written out by hand, and
 * the reveal is held to the route on a real board.
 *
 * The game here is the tight-grid world of `utils/moves-world.ts` (spacing 6),
 * so that armies stand next to each other and meet in a cycle:
 *
 *   alice, spawn (0,0), facing North        bob, spawn (6,0), facing East
 *
 *   y= 1  . P P P P .     x = -3 .. 2      x = 4: pawns facing West, y 1..-2
 *   y= 0  P K B N R P                      x = 5: P R N B Q P, y 2..-3
 *   y=-1  P R N B Q P                      x = 6: P K B N R P, y 2..-3
 *   y=-2  . P P P P .                      x = 7: pawns facing East, y 1..-2
 *
 *   carol, spawn (0,6), facing North: alice's picture moved up 6.
 */

const {provider, networkHelpers} = await network.connect();
const {deployAll} = setupFixtures(provider);
const world = movesWorld({
	deployAll,
	loadFixture: networkHelpers.loadFixture,
});

// ----------------------------------------------------------------------------
// THE RULE, on boards written out by hand
// ----------------------------------------------------------------------------

const MINE = 1n << 160n;
const THEIRS = 2n << 160n;
const FORWARD = {N: 0, E: 1, S: 2, W: 3} as const;
const KINDS = {P: 1, N: 2, B: 3, R: 4, Q: 5, K: 6} as const;

/** `'Q@0,0'` (mine) or `'k@1,1'` (lower case: theirs), with `:E` for a
 *  pawn's forward and `*` once it has moved. */
function p(spec: string): Piece {
	const m = /^([PNBRQKpnbrqk])@(-?\d+),(-?\d+)(?::([NESW]))?(\*)?$/.exec(spec);
	if (!m) throw new Error(`bad piece ${spec}`);
	const letter = m[1];
	return {
		position: at(Number(m[2]), Number(m[3])),
		army: letter === letter.toUpperCase() ? MINE : THEIRS,
		kind: KINDS[letter.toUpperCase() as keyof typeof KINDS],
		forward: FORWARD[(m[4] ?? 'N') as keyof typeof FORWARD],
		moved: m[5] === '*',
	};
}

async function rules() {
	const f = await networkHelpers.loadFixture(deployAll);
	return async (board: string[], from: [number, number]): Promise<string[]> => {
		const destinations = (await f.env.read(f.Game, {
			functionName: 'legalMoves',
			args: [board.map(p), at(...from)],
		})) as bigint[];
		return destinations
			.map((d) => {
				const {x, y} = xyOf(d);
				return `${x},${y}`;
			})
			.sort();
	};
}

const squares = (...list: [number, number][]) =>
	list.map(([x, y]) => `${x},${y}`).sort();

/** Every square `(dx,dy)*k` from `(x,y)` for k in 1..`range`. */
function ray(x: number, y: number, dx: number, dy: number, range = 7) {
	const out: [number, number][] = [];
	for (let k = 1; k <= range; k++) out.push([x + dx * k, y + dy * k]);
	return out;
}

describe('the move rule', function () {
	it('moves a pawn forward one, or two on its first move, along its own forward', async function () {
		const legal = await rules();
		expect(await legal(['P@0,0:N'], [0, 0])).toEqual(squares([0, 1], [0, 2]));
		expect(await legal(['P@0,0:E'], [0, 0])).toEqual(squares([1, 0], [2, 0]));
		expect(await legal(['P@0,0:S'], [0, 0])).toEqual(squares([0, -1], [0, -2]));
		expect(await legal(['P@0,0:W'], [0, 0])).toEqual(squares([-1, 0], [-2, 0]));
		// Once it has moved, one square only.
		expect(await legal(['P@0,0:N*'], [0, 0])).toEqual(squares([0, 1]));
	});

	it('needs an empty square to advance onto, and to pass over', async function () {
		const legal = await rules();
		// Blocked in front, by anyone: no straight move at all, no capture.
		expect(await legal(['P@0,0:N', 'p@0,1'], [0, 0])).toEqual([]);
		expect(await legal(['P@0,0:N', 'N@0,1'], [0, 0])).toEqual([]);
		// Blocked two ahead: one square only.
		expect(await legal(['P@0,0:N', 'p@0,2'], [0, 0])).toEqual(squares([0, 1]));
	});

	it('captures diagonally forward, only an enemy, and never onto an empty square (no en passant)', async function () {
		const legal = await rules();
		expect(await legal(['P@0,0:N*', 'p@1,1', 'p@-1,1'], [0, 0])).toEqual(
			squares([0, 1], [1, 1], [-1, 1]),
		);
		// Its own piece is not a capture.
		expect(await legal(['P@0,0:N*', 'N@1,1'], [0, 0])).toEqual(squares([0, 1]));
		// A pawn that just passed beside it is not either: there is no en passant.
		expect(await legal(['P@0,0:N*', 'p@1,0:S*'], [0, 0])).toEqual(
			squares([0, 1]),
		);
		// Backwards diagonals are not a pawn's.
		expect(await legal(['P@0,0:E*', 'p@-1,1', 'p@1,1'], [0, 0])).toEqual(
			squares([1, 0], [1, 1]),
		);
	});

	it('jumps a knight over anything, onto anything but its own', async function () {
		const legal = await rules();
		const ring = ['N@0,0', 'P@1,0', 'P@-1,0', 'P@0,1', 'P@0,-1', 'P@1,1'];
		expect(await legal([...ring, 'p@1,2', 'R@2,1'], [0, 0])).toEqual(
			squares([1, 2], [-1, 2], [-2, 1], [-2, -1], [-1, -2], [1, -2], [2, -1]),
		);
	});

	it('slides a rook, a bishop and a queen at most 7 squares, stopping at the first piece', async function () {
		const legal = await rules();
		const rookRays = [
			ray(0, 0, 1, 0),
			ray(0, 0, -1, 0),
			ray(0, 0, 0, 1),
			ray(0, 0, 0, -1),
		].flat();
		const bishopRays = [
			ray(0, 0, 1, 1),
			ray(0, 0, -1, 1),
			ray(0, 0, 1, -1),
			ray(0, 0, -1, -1),
		].flat();
		expect(await legal(['R@0,0'], [0, 0])).toEqual(squares(...rookRays));
		expect(await legal(['B@0,0'], [0, 0])).toEqual(squares(...bishopRays));
		expect(await legal(['Q@0,0'], [0, 0])).toEqual(
			squares(...rookRays, ...bishopRays),
		);
		// Blocked: an enemy is captured and not passed, its own piece stops it short.
		expect(
			await legal(['R@0,0', 'p@0,3', 'P@2,0', 'P@-1,0', 'P@0,-1'], [0, 0]),
		).toEqual(squares([0, 1], [0, 2], [0, 3], [1, 0]));
	});

	it('moves a king one square, onto an attacked square too, and never two (no castling)', async function () {
		const legal = await rules();
		const around = squares(
			[1, 0],
			[1, 1],
			[0, 1],
			[-1, 1],
			[-1, 0],
			[-1, -1],
			[0, -1],
			[1, -1],
		);
		// A rook on the second rank and the first rank: both attack squares
		// next to the king, and neither forbids them.
		expect(await legal(['K@0,0', 'r@5,1', 'r@-6,-1'], [0, 0])).toEqual(around);
		// Its own rook beside it, two squares away: still only one step, and not
		// onto the rook.
		expect(await legal(['K@0,0', 'R@3,0', 'R@1,0'], [0, 0])).toEqual(
			around.filter((s) => s !== '1,0'),
		);
	});

	it("never moves a king next to another king's square, but lets it move onto that square", async function () {
		const legal = await rules();
		// The enemy king one diagonal away: every square next to it is out,
		// except its own square, which is a capture.
		expect(await legal(['K@0,0', 'k@1,1'], [0, 0])).toEqual(
			squares([1, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]),
		);
		// Two squares away: the three squares between are out.
		expect(await legal(['K@0,0', 'k@2,0'], [0, 0])).toEqual(
			squares([-1, 1], [-1, 0], [-1, -1], [0, 1], [0, -1]),
		);
		// An enemy pawn is no king: the king may move next to it.
		expect(await legal(['K@0,0', 'p@2,0'], [0, 0])).toHaveLength(8);
	});

	it('has no move for an empty square', async function () {
		const legal = await rules();
		expect(await legal(['K@0,0'], [3, 3])).toEqual([]);
	});
});

// ----------------------------------------------------------------------------
// MOVES ON CHAIN
// ----------------------------------------------------------------------------

describe('moving an army', function () {
	it('lands a move once the cycle is over, and not before', async function () {
		const w = await world();
		const [a] = await w.deploy([[w.alice, [0, 0]]]);
		const before = await w.board();

		const twoSquares = [move([-2, 1], [-2, 3])];
		await w.commit(w.alice, a, twoSquares);
		await w.toRevealPhase();
		await w.reveal(w.alice, a, twoSquares);
		// Revealed, and the board is still the start-of-cycle board.
		expect(await w.board()).toEqual(before);

		await w.toNextCycle();
		expect(await w.pieceAt(-2, 1)).toEqual(undefined);
		expect(await w.pieceAt(-2, 3)).toEqual(`P@-2,3#${a}:N*`);
		expect((await w.board()).length).toEqual(20);
	});

	it('keeps the registry returning where each king stands, resolved', async function () {
		const w = await world();
		const [a] = await w.deploy([[w.alice, [0, 0]]]);
		expect((await w.registry())[0].king).toEqual({x: -2, y: 0});

		// Into the empty corner of its own footprint.
		const kingMove = [move([-2, 0], [-3, 1])];
		await w.commit(w.alice, a, kingMove);
		await w.toRevealPhase();
		await w.reveal(w.alice, a, kingMove);
		expect((await w.registry())[0].king).toEqual({x: -2, y: 0});
		await w.toNextCycle();
		expect((await w.registry())[0].king).toEqual({x: -3, y: 1});
		expect(await w.pieceAt(-3, 1)).toEqual(`K@-3,1#${a}:N*`);

		// And again, from where it now stands.
		await w.play([{owner: w.alice, army: a, moves: [move([-3, 1], [-3, 2])]}]);
		expect((await w.registry())[0].king).toEqual({x: -3, y: 2});
	});

	it('reveals exactly the moves the simulation route calls legal', async function () {
		const w = await world();
		await w.deploy([[w.alice, [0, 0]]]);
		// The knight on (0,0): over the pawns, onto the two empty squares in
		// front and the empty corner.
		expect(await w.legalMoves([0, 0])).toEqual(
			squares([1, 2], [-1, 2], [2, 1]),
		);
		// The rook on (1,0) and the king on (-2,0) are boxed in, but for the
		// king's corner.
		expect(await w.legalMoves([1, 0])).toEqual([]);
		expect(await w.legalMoves([-2, 0])).toEqual(squares([-3, 1]));
		// The east pawn on (2,0) advances East.
		expect(await w.legalMoves([2, 0])).toEqual(squares([3, 0], [4, 0]));

		for (const illegal of [
			move([1, 0], [1, 2]), // a rook through its own pawn
			move([-2, 0], [0, 0]), // a king two squares: castling
			move([2, 0], [3, 1]), // a pawn diagonally onto an empty square
			move([2, 0], [2, 1]), // a pawn sideways
			move([5, 5], [5, 6]), // nothing there
		]) {
			// A fresh army each time: a commitment that cannot be revealed is a
			// missed reveal, which FREEZES the army for good
			// (`docs/adr/0005-missed-reveal-freezes-the-army.md`).
			const fresh = await world();
			const [army] = await fresh.deploy([[fresh.alice, [0, 0]]]);
			await fresh.commit(fresh.alice, army, [illegal]);
			await fresh.toRevealPhase();
			await expect(fresh.reveal(fresh.alice, army, [illegal])).toBeRejectedWith(
				/IllegalMove/,
			);
			await fresh.toNextCycle();
			expect(
				await fresh.env.read(fresh.Game, {
					functionName: 'isFrozen',
					args: [army],
				}),
			).toEqual(true);
		}

		// And a legal one goes through: the knight to the corner.
		const ok = await world();
		const [army] = await ok.deploy([[ok.alice, [0, 0]]]);
		await ok.play([{owner: ok.alice, army, moves: [move([0, 0], [2, 1])]}]);
		expect(await ok.pieceAt(2, 1)).toEqual(`N@2,1#${army}:N*`);
	});

	it("refuses a move of another army's piece", async function () {
		const w = await world();
		const [a] = await w.deploy([
			[w.alice, [0, 0]],
			[w.bob, [1, 0]],
		]);
		const bobsPawn = [move([4, 0], [3, 0])];
		await w.commit(w.alice, a, bobsPawn);
		await w.toRevealPhase();
		await expect(w.reveal(w.alice, a, bobsPawn)).toBeRejectedWith(
			/IllegalMove/,
		);
	});

	it('allows one move per army per cycle, and both kinds of pass leave the army in place', async function () {
		const w = await world();
		const [a] = await w.deploy([[w.alice, [0, 0]]]);
		const start = await w.board();

		// A pass by committing nothing, then by committing an empty move.
		await w.toNextCycle();
		await w.play([{owner: w.alice, army: a, moves: []}]);
		expect(await w.board()).toEqual(start);

		// Two moves in one submission: refused, whichever chunk comes first.
		const two = [move([-2, 1], [-2, 2]), move([1, 1], [1, 2])];
		await w.commit(w.alice, a, two);
		await w.toRevealPhase();
		await expect(w.reveal(w.alice, a, two)).toBeRejectedWith(/OneMovePerCycle/);

		// Which leaves it unrevealed: the army is frozen for good.
		await w.toNextCycle();
		await expect(w.commit(w.alice, a, [])).toBeRejectedWith('NotInGame');

		// A second reveal of a move already revealed: refused by the base.
		const v = await world();
		const [army] = await v.deploy([[v.alice, [0, 0]]]);
		const one = [move([-2, 1], [-2, 2])];
		await v.commit(v.alice, army, one);
		await v.toRevealPhase();
		await v.reveal(v.alice, army, one);
		await expect(v.reveal(v.alice, army, one)).toBeRejected();
		await v.toNextCycle();
		expect(await v.pieceAt(-2, 2)).toEqual(`P@-2,2#${army}:N*`);
	});

	it('never promotes a pawn, however far it goes', async function () {
		const w = await world();
		const [a] = await w.deploy([[w.alice, [0, 0]]]);
		let y = 1;
		await w.play([
			{owner: w.alice, army: a, moves: [move([1, y], [1, y + 2])]},
		]);
		y += 2;
		for (let k = 0; k < 6; k++, y++) {
			await w.play([
				{owner: w.alice, army: a, moves: [move([1, y], [1, y + 1])]},
			]);
		}
		expect(await w.pieceAt(1, y)).toEqual(`P@1,${y}#${a}:N*`);
	});
});

// ----------------------------------------------------------------------------
// ORDER, AND TIME
// ----------------------------------------------------------------------------

describe('resolving moves', function () {
	/**
	 * Two cycles of three armies' moves, revealed in `order`:
	 *
	 * 1. alice's pawn (-1,1) two squares to (-1,3) and carol's pawn (-1,4) one
	 *    square to the same square (two arrivals: both fail, by the count);
	 *    bob's pawn (4,0) to (3,0), alone (it lands).
	 * 2. alice's pawn (2,-1) captures bob's pawn on (3,0) diagonally (one
	 *    arrival on a piece that stayed); bob's knight (5,0) to (3,1); carol's
	 *    pawn (0,4) to (0,3).
	 */
	async function playBothCycles(order: 'forward' | 'reverse') {
		const w = await world();
		const [a, b, c] = await w.deploy([
			[w.alice, [0, 0]],
			[w.bob, [1, 0]],
			[w.carol, [0, 1]],
		]);
		await w.play(
			[
				{owner: w.alice, army: a, moves: [move([-1, 1], [-1, 3])]},
				{owner: w.bob, army: b, moves: [move([4, 0], [3, 0])]},
				{owner: w.carol, army: c, moves: [move([-1, 4], [-1, 3])]},
			],
			order,
		);
		const afterFirst = await w.board();
		await w.play(
			[
				{owner: w.alice, army: a, moves: [move([2, -1], [3, 0])]},
				{owner: w.bob, army: b, moves: [move([5, 0], [3, 1])]},
				{owner: w.carol, army: c, moves: [move([0, 4], [0, 3])]},
			],
			order,
		);
		return {
			w,
			armies: [a, b, c],
			afterFirst,
			afterSecond: await w.board(),
			registry: await w.registry(),
		};
	}

	it('gives the same board and registry whatever order the reveals land in', async function () {
		const forward = await playBothCycles('forward');
		const {w, armies} = forward;
		const [a, b, c] = armies;

		// What happened, read once.
		expect(forward.afterFirst.length).toEqual(58);
		expect(await w.pieceAt(-1, 3)).toEqual(undefined);
		expect(await w.pieceAt(-1, 1)).toEqual(undefined);
		expect(await w.pieceAt(-1, 4)).toEqual(undefined);
		expect(await w.pieceAt(3, 0)).toEqual(`P@3,0#${a}:E*`);
		expect(await w.pieceAt(3, 1)).toEqual(`N@3,1#${b}:E*`);
		expect(await w.pieceAt(0, 3)).toEqual(`P@0,3#${c}:S*`);
		expect(forward.afterSecond.length).toEqual(57);

		const reverse = await playBothCycles('reverse');
		expect(reverse.afterFirst).toEqual(forward.afterFirst);
		expect(reverse.afterSecond).toEqual(forward.afterSecond);
		expect(reverse.registry).toEqual(forward.registry);
	});

	it('fails a new army whose footprint a move arrives on in its deployment cycle, whatever the order, and lands the move', async function () {
		async function play(order: 'forward' | 'reverse') {
			const w = await world();
			const [a] = await w.deploy([[w.alice, [0, 0]]]);
			// alice's east pawn two squares onto (4,0), which bob's army, deployed
			// in the same cycle, lays a pawn on.
			const pawn = [move([2, 0], [4, 0])];
			await w.commit(w.alice, a, pawn);
			const [b] = await w.commitDeployments([[w.bob, [1, 0]]]);
			await w.toRevealPhase();
			if (order === 'forward') {
				await w.reveal(w.alice, a, pawn);
				await w.revealDeployment(w.bob, b, [1, 0]);
			} else {
				await w.revealDeployment(w.bob, b, [1, 0]);
				await w.reveal(w.alice, a, pawn);
			}
			await w.toNextCycle();
			return {w, board: await w.board()};
		}
		const forward = await play('forward');
		// The arrival blocks bob's whole deployment (refunded, see
		// `DeploymentCollisions.test.ts`), and alice's pawn lands on (4,0) as on
		// any empty square.
		expect(await forward.w.pieceAt(2, 0)).toEqual(undefined);
		expect(await forward.w.pieceAt(4, 0)).toEqual(
			`P@4,0#${(await forward.w.registry())[0].id}:E*`,
		);
		expect(forward.board.length).toEqual(20);
		expect((await forward.w.registry())[1].status).toEqual(3);
		const reverse = await play('reverse');
		expect(reverse.board).toEqual(forward.board);
		expect(await reverse.w.registry()).toEqual(await forward.w.registry());
	});

	/** alice's pawn (-2,1) two squares, then one, with `idle` cycles between. */
	async function pawnWalk(idle: number) {
		const w = await world();
		const [a] = await w.deploy([[w.alice, [0, 0]]]);
		await w.play([{owner: w.alice, army: a, moves: [move([-2, 1], [-2, 3])]}]);
		const reads: string[][] = [];
		for (let k = 0; k < idle; k++) {
			reads.push(await w.board());
			await w.toNextCycle();
		}
		reads.push(await w.board());
		// The second move folds the first one's facts, however old they are.
		await w.play([{owner: w.alice, army: a, moves: [move([-2, 3], [-2, 4])]}]);
		return {reads, board: await w.board()};
	}

	it('reads a square after many idle cycles as if it had been resolved cycle by cycle', async function () {
		const stepByStep = await pawnWalk(0);
		const idle = await pawnWalk(5);
		// Every read across the idle cycles is the board the move left.
		for (const read of idle.reads) expect(read).toEqual(stepByStep.reads[0]);
		expect(idle.board).toEqual(stepByStep.board);
	});
});
