import {expect} from 'earl';
import {describe, it} from 'node:test'; // using node:test as hardhat v3 do not support vitest
import {network} from 'hardhat';
import {xyOf, squareAt, setupFixtures, type Move} from './utils/index.js';
import {movesWorld, move, type Piece} from './utils/moves-world.js';

/**
 * THE WHOLE-MOVE ROUTE IS THE REVEAL'S RULE, and the reveal is its oracle.
 *
 * A planner asks the Simulation route, in its sandbox, whether a whole move of
 * up to three piece-moves is legal (`isLegalWholeMove`), and where one more
 * piece may go alongside the piece-moves already planned
 * (`legalMovesAlongside`), so the player is refused before committing and
 * never loses a reveal to it (`docs/adr/0016`, `docs/adr/0007`). That is only
 * worth anything if the route accepts EXACTLY what the reveal accepts, so these
 * tests generate whole moves (swaps, moves onto and through own-vacated
 * squares, and every refusal), commit and reveal each one, and compare.
 *
 * The route reads no storage, so the move's cap is a parameter: 3, or 1 at a
 * table that turns three piece-moves off. The reveal caps at 3 everywhere for
 * now, so at cap 1 the route must accept what the reveal accepts AND holds at
 * most one piece-move.
 *
 * The world is `utils/moves-world.ts`'s (spacing 6): alice at (0,0), bob at
 * (6,0) with his knight moved onto his empty corner (4,-2), within reach of
 * alice's pieces.
 */

const {provider, networkHelpers} = await network.connect();
const {deployAll} = setupFixtures(provider);
const world = movesWorld({
	deployAll,
	loadFixture: networkHelpers.loadFixture,
});

type World = Awaited<ReturnType<typeof world>>;

/** A small seeded PRNG (mulberry32), so a failure replays. */
function prng(seed: number) {
	let s = seed >>> 0;
	return () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const key = (m: Move) => `${m.from}>${m.to}`;
const show = (moves: readonly Move[]) =>
	moves
		.map((m) => {
			const a = xyOf(m.from);
			const b = xyOf(m.to);
			return `(${a.x},${a.y})->(${b.x},${b.y})`;
		})
		.join(' ') || 'pass';

/** alice and bob, bob's knight on (4,-2), at the top of a commit phase. */
async function scene() {
	const w = await world();
	const [a, b] = await w.deploy([
		[w.alice, [0, 0]],
		[w.bob, [1, 0]],
	]);
	await w.play([
		{owner: w.alice, army: a, moves: []},
		{owner: w.bob, army: b, moves: [move([6, -1], [4, -2])]},
	]);
	return {w, a, b, board: await w.pieces()};
}

/** Whether the reveal accepts `moves` as `army`'s move; the chain is restored. */
async function revealAccepts(
	w: World,
	army: bigint,
	moves: readonly Move[],
): Promise<boolean> {
	const snap = await networkHelpers.takeSnapshot();
	try {
		await w.commit(w.alice, army, moves);
		await w.toRevealPhase();
		try {
			await w.reveal(w.alice, army, moves);
			return true;
		} catch (e) {
			// Refused by the RULE, and not for some other reason.
			expect(String((e as Error).message)).toMatchRegex(
				/IllegalMove|OneMovePerCycle/,
			);
			return false;
		}
	} finally {
		await snap.restore();
	}
}

function isLegalWholeMove(
	w: World,
	board: readonly Piece[],
	army: bigint,
	moves: readonly Move[],
	cap: number,
): Promise<boolean> {
	return w.env.read(w.Game, {
		functionName: 'isLegalWholeMove',
		args: [board, army, moves, BigInt(cap)],
	}) as Promise<boolean>;
}

async function legalMovesAlongside(
	w: World,
	board: readonly Piece[],
	from: bigint,
	others: readonly Move[],
	cap: number,
): Promise<bigint[]> {
	const destinations = (await w.env.read(w.Game, {
		functionName: 'legalMovesAlongside',
		args: [board, from, others, BigInt(cap)],
	})) as readonly bigint[];
	return [...destinations].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
}

/**
 * Every square a piece on `from` could ever be offered: the 5 by 5 around it
 * (a king, a pawn, a knight) and the eight lines out to the slider range.
 */
function reach(from: bigint): bigint[] {
	const {x, y} = xyOf(from);
	const squares = new Set<bigint>();
	for (let dx = -2; dx <= 2; dx++)
		for (let dy = -2; dy <= 2; dy++)
			if (dx || dy) squares.add(squareAt(x + dx, y + dy));
	for (const [dx, dy] of [
		[1, 0],
		[-1, 0],
		[0, 1],
		[0, -1],
		[1, 1],
		[1, -1],
		[-1, 1],
		[-1, -1],
	])
		for (let k = 1; k <= 7; k++) squares.add(squareAt(x + dx * k, y + dy * k));
	return [...squares].sort((p, q) => (p < q ? -1 : p > q ? 1 : 0));
}

/**
 * The whole moves the property is checked on. Named ones first: each kind the
 * rule singles out. Then generated ones, built from alice's pieces with a bias
 * towards moves that are legal (destinations the route offers, or squares
 * another of the move's pieces leaves), and listed in a shuffled order.
 */
async function wholeMoves(
	w: World,
	board: readonly Piece[],
	a: bigint,
): Promise<Move[][]> {
	const named: Move[][] = [
		[], // a pass
		[move([-1, 2], [-1, 3])], // one
		[move([0, 2], [0, 3]), move([1, 2], [1, 3])], // two
		// Onto, and through, squares its own army vacates, in two orders.
		[move([-1, 2], [-2, 2]), move([-1, 1], [-1, 4]), move([-1, 0], [-1, 1])],
		[move([-1, 0], [-1, 1]), move([-1, 2], [-2, 2]), move([-1, 1], [-1, 4])],
		[move([-1, 1], [-1, 4])], // the slide alone: blocked
		[move([-1, 1], [-1, 0]), move([-1, 0], [-1, 1])], // a swap
		// The chase trade: the king steps away, the queen takes its square.
		[move([0, 0], [1, 0]), move([-1, 0], [0, 0])],
		[move([-1, 0], [0, 0])], // onto the king, which stays: refused
		// A fourth piece-move.
		[
			move([-1, 2], [-1, 3]),
			move([0, 2], [0, 3]),
			move([1, 2], [1, 3]),
			move([-2, 1], [-3, 1]),
		],
		[move([1, 2], [1, 3]), move([1, 2], [2, 2])], // one piece twice
		[move([0, 1], [1, 3]), move([1, 2], [1, 3])], // two to one square
		[move([4, -2], [3, 0])], // another army's piece
		[move([5, 5], [5, 6])], // nothing there
		[move([-1, 2], [-1, 3]), move([5, 5], [5, 6])], // one legal, one not
	];

	const random = prng(0x3a1e);
	const pick = <T>(list: readonly T[]): T =>
		list[Math.floor(random() * list.length)];
	const mine = board.filter((p) => p.army === a).map((p) => p.position);
	const bobs = board.filter((p) => p.army !== a).map((p) => p.position);
	const generated: Move[][] = [];
	for (let n = 0; n < 200; n++) {
		const r = random();
		const length = r < 0.1 ? 1 : r < 0.45 ? 2 : r < 0.92 ? 3 : 4;
		const anchor = xyOf(pick(mine));
		const near = mine.filter((p) => {
			const {x, y} = xyOf(p);
			return Math.max(Math.abs(x - anchor.x), Math.abs(y - anchor.y)) <= 2;
		});
		const froms: bigint[] = [];
		for (let k = 0; k < length; k++) {
			const s = random();
			if (s < 0.04 && froms.length)
				froms.push(pick(froms)); // twice
			else if (s < 0.07) froms.push(pick(bobs));
			else if (s < 0.09)
				froms.push(squareAt(3, 3)); // empty
			else {
				const free = near.filter((p) => !froms.includes(p));
				froms.push(free.length ? pick(free) : pick(mine));
			}
		}
		const moves: Move[] = [];
		for (const from of froms) {
			const s = random();
			let to: bigint;
			if (s < 0.3 && froms.length > 1) {
				// Onto a square another of this move's pieces leaves.
				to = pick(froms.filter((f) => f !== from).concat([from]));
			} else if (s < 0.38 && moves.length) {
				to = pick(moves).to; // two to one square
			} else if (s < 0.85) {
				const offered = await legalMovesAlongside(w, board, from, moves, 3);
				to = offered.length ? pick(offered) : pick(reach(from));
			} else {
				to = pick(reach(from));
			}
			moves.push({from, to});
		}
		// The listed order is the player's, and must change nothing.
		for (let i = moves.length - 1; i > 0; i--) {
			const j = Math.floor(random() * (i + 1));
			[moves[i], moves[j]] = [moves[j], moves[i]];
		}
		generated.push(moves);
	}
	return [...named, ...generated];
}

describe('the whole-move simulation route', function () {
	it('accepts exactly the whole moves the reveal accepts, at cap 3 and at cap 1', async function () {
		const {w, a, board} = await scene();
		const moves = await wholeMoves(w, board, a);
		let accepted = 0;
		let acceptedSeveral = 0;
		let acceptedThree = 0;
		let acceptedThroughVacated = 0;
		for (const m of moves) {
			const revealed = await revealAccepts(w, a, m);
			const atThree = await isLegalWholeMove(w, board, a, m, 3);
			const atOne = await isLegalWholeMove(w, board, a, m, 1);
			expect({move: show(m), atThree, atOne}).toEqual({
				move: show(m),
				atThree: revealed,
				atOne: revealed && m.length <= 1,
			});
			if (revealed) accepted++;
			if (revealed && m.length >= 2) acceptedSeveral++;
			if (revealed && m.length === 3) acceptedThree++;
			if (revealed) {
				// Accepted only because the army's own movers count as gone: a
				// piece-move that is not legal alone.
				for (const p of m) {
					const alone = (await w.env.read(w.Game, {
						functionName: 'legalMoves',
						args: [board, p.from],
					})) as readonly bigint[];
					if (!alone.includes(p.to)) {
						acceptedThroughVacated++;
						break;
					}
				}
			}
		}
		// The property means something only if both answers are common.
		expect(accepted).toBeGreaterThanOrEqual(20);
		expect(acceptedSeveral).toBeGreaterThanOrEqual(12);
		expect(acceptedThree).toBeGreaterThanOrEqual(8);
		expect(acceptedThroughVacated).toBeGreaterThanOrEqual(8);
		expect(moves.length - accepted).toBeGreaterThanOrEqual(20);
	});

	it("offers one piece exactly the destinations the reveal would allow alongside the move's other piece-moves", async function () {
		const {w, a, board} = await scene();
		const othersList: Move[][] = [
			[],
			[move([-1, 2], [-2, 2])], // vacates the rook's column
			[move([-1, 2], [-2, 2]), move([0, 0], [1, 0])], // and the king's square
			[move([1, 2], [1, 3]), move([0, 2], [0, 3])],
		];
		for (const others of othersList) {
			expect(await revealAccepts(w, a, others)).toEqual(true);
		}
		const froms = [
			squareAt(-1, 1), // the rook
			squareAt(-1, 0), // the queen
			squareAt(0, 1), // the knight
			squareAt(0, 0), // the king
			squareAt(-1, 2), // a pawn, which moves in some of the others
			squareAt(1, 1), // the bishop
			squareAt(4, -2), // bob's knight: judged as bob's move
			squareAt(3, 3), // nothing there
		];
		for (const others of othersList) {
			for (const from of froms) {
				const piece = board.find((p) => p.position === from);
				const army = piece ? piece.army : 0n;
				for (const cap of [3, 1]) {
					const offered = await legalMovesAlongside(
						w,
						board,
						from,
						others,
						cap,
					);
					// Every square within reach: offered exactly when the whole
					// move with it is legal (that route is pinned to the reveal
					// above).
					const expected: bigint[] = [];
					if (piece) {
						for (const to of reach(from)) {
							if (
								await isLegalWholeMove(
									w,
									board,
									army,
									[...others, {from, to}],
									cap,
								)
							)
								expected.push(to);
						}
					}
					expect({
						others: show(others),
						from: xyOf(from),
						cap,
						offered: offered.map(xyOf),
					}).toEqual({
						others: show(others),
						from: xyOf(from),
						cap,
						offered: expected.map(xyOf),
					});
					// And straight against the reveal, for alice's pieces at cap 3:
					// a couple of offered squares go through, a couple not offered
					// are refused.
					if (cap === 3 && piece && army === a) {
						const notOffered = reach(from).filter(
							(to) => !offered.includes(to),
						);
						for (const to of offered.slice(0, 2)) {
							expect(
								await revealAccepts(w, a, [...others, {from, to}]),
							).toEqual(true);
						}
						for (const to of notOffered.slice(0, 2)) {
							expect(
								await revealAccepts(w, a, [...others, {from, to}]),
							).toEqual(false);
						}
					}
				}
			}
		}
		// The squares the others vacate are offered: the rook's column once its
		// pawn steps aside, the king's square once the king steps away.
		const xy = (list: bigint[]) => list.map((d) => `${xyOf(d).x},${xyOf(d).y}`);
		expect(
			xy(await legalMovesAlongside(w, board, squareAt(-1, 1), [], 3)),
		).not.toInclude('-1,4');
		expect(
			xy(
				await legalMovesAlongside(w, board, squareAt(-1, 1), othersList[1], 3),
			),
		).toInclude('-1,2', '-1,3', '-1,4');
		expect(
			xy(
				await legalMovesAlongside(w, board, squareAt(-1, 0), othersList[2], 3),
			),
		).toInclude('0,0');
		// Never the square another piece-move goes to, nor a piece that already
		// moves, nor anything once the move is full.
		expect(
			xy(
				await legalMovesAlongside(w, board, squareAt(-1, 1), othersList[1], 3),
			),
		).not.toInclude('-2,2');
		expect(
			await legalMovesAlongside(w, board, squareAt(-1, 2), othersList[1], 3),
		).toEqual([]);
		expect(
			await legalMovesAlongside(w, board, squareAt(-1, 1), othersList[1], 1),
		).toEqual([]);
		// With nothing else in the move, it is `legalMoves`.
		for (const from of froms) {
			const plain = (await w.env.read(w.Game, {
				functionName: 'legalMoves',
				args: [board, from],
			})) as readonly bigint[];
			expect(await legalMovesAlongside(w, board, from, [], 3)).toEqual(
				[...plain].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0)),
			);
		}
	});

	it('reads no storage, so the route alone answers as the game does', async function () {
		const {w, a, board} = await scene();
		const route = w.env.get('Game_Implementation_Router_Simulation_Route');
		const swap = [move([-1, 1], [-1, 0]), move([-1, 0], [-1, 1])];
		for (const cap of [3, 1]) {
			const fromRoute = await w.env.read(
				{address: route.address, abi: w.Game.abi},
				{functionName: 'isLegalWholeMove', args: [board, a, swap, BigInt(cap)]},
			);
			expect(fromRoute).toEqual(cap === 3);
			const offered = await w.env.read(
				{address: route.address, abi: w.Game.abi},
				{
					functionName: 'legalMovesAlongside',
					args: [board, squareAt(-1, 1), [swap[1]], BigInt(cap)],
				},
			);
			expect(offered).toEqual(
				await w.env.read(w.Game, {
					functionName: 'legalMovesAlongside',
					args: [board, squareAt(-1, 1), [swap[1]], BigInt(cap)],
				}),
			);
		}
	});
});
