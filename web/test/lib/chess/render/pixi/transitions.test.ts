import {describe, expect, it} from 'vitest';
import {PIECE_KIND, type PieceKind} from '$lib/chess/board';
import {squareAt} from '$lib/chess/squares';
import type {
	BoardView,
	KingView,
	OutcomeView,
	PieceView,
} from '$lib/chess/view';
import {kingBadge} from '$lib/chess/render/eth-diamond';
import {
	BURN_MS,
	createTransitionTracker,
	MOVE_MS,
	SETTLE_WINDOW_MS,
	stakeFlights,
	transitionBetween,
	type BoardFrame,
} from '$lib/chess/render/pixi/transitions';

/**
 * WHAT THE WOODEN BOARD ANIMATES. Every judgement is a comparison of two
 * contract answers; these pin which comparison draws what, and that a pan or a
 * reload animates nothing.
 */

const A = 1n;
const B = 2n;
const C = 3n;

type P = [number, number, bigint, PieceKind];
const piece = ([x, y, army, kind]: P): PieceView => ({
	position: squareAt(x, y),
	army,
	kind,
	position2d: {x, y},
});
const king = (army: bigint, x: number, y: number): KingView => ({
	army,
	position2d: {x, y},
	stake: 1n,
	stakeLabel: '1',
	frozen: false,
});

function board(
	pieces: P[],
	over: Partial<BoardView> & {cycleNumber?: number} = {},
): BoardFrame {
	const kings = pieces
		.filter(([, , , kind]) => kind === PIECE_KIND.King)
		.map(([x, y, army]) => king(army, x, y));
	return {
		pieces: new Map(pieces.map((p) => [squareAt(p[0], p[1]), piece(p)])),
		spawnPoints: [],
		ghost: [],
		outcomes: [],
		outcomesCycle: 0,
		kings,
		cycleNumber: 1,
		...over,
	} as BoardFrame;
}

const key = (x: number, y: number) => `p:${squareAt(x, y)}`;
const K = PIECE_KIND.King;
const R = PIECE_KIND.Rook;
const N = PIECE_KIND.Knight;
const Pw = PIECE_KIND.Pawn;
const Q = PIECE_KIND.Queen;

describe('moves', () => {
	it('slides a piece from where it was', () => {
		const t = transitionBetween(
			board([
				[0, 0, A, K],
				[1, 0, A, R],
			]),
			board([
				[0, 0, A, K],
				[1, 5, A, R],
			]),
			{eligible: true},
		);
		expect([...t.moves]).toEqual([[key(1, 5), {x: 1, y: 0}]]);
		expect(t.departures).toEqual([]);
	});

	it('pairs same kind first, nearest first, and per army', () => {
		const t = transitionBetween(
			board([
				[0, 0, A, K],
				[1, 0, A, R],
				[3, 0, A, N],
				[9, 9, B, K],
				[4, 0, B, N],
			]),
			board([
				[0, 0, A, K],
				[1, 3, A, R],
				[4, 2, A, N],
				[9, 9, B, K],
				[5, 2, B, N],
			]),
			{eligible: true},
		);
		expect(t.moves.get(key(1, 3))).toEqual({x: 1, y: 0});
		expect(t.moves.get(key(4, 2))).toEqual({x: 3, y: 0});
		expect(t.moves.get(key(5, 2))).toEqual({x: 4, y: 0});
	});

	it('pairs a piece that lands as a queen (promotion)', () => {
		const t = transitionBetween(
			board([
				[0, 0, A, K],
				[1, 1, A, Pw],
				[2, 2, B, K],
			]),
			board([
				[0, 0, A, K],
				[2, 2, A, Q],
			]),
			{eligible: true},
		);
		expect(t.moves.get(key(2, 2))).toEqual({x: 1, y: 1});
	});

	it('animates nothing of a pan: pieces coming and going outside play', () => {
		const t = transitionBetween(
			board([
				[0, 0, A, K],
				[1, 0, A, R],
			]),
			board([
				[0, 0, A, K],
				[1, 5, A, R],
			]),
			{eligible: false},
		);
		expect(t.moves.size).toBe(0);
		expect(t.departures).toEqual([]);
	});

	it('never pairs across more than a pan', () => {
		const t = transitionBetween(
			board([
				[0, 0, A, K],
				[1, 0, A, R],
			]),
			board([
				[0, 0, A, K],
				[1, 40, A, R],
			]),
			{eligible: true},
		);
		expect(t.moves.size).toBe(0);
	});
});

describe('departures', () => {
	it('burns a captured piece once its captor has arrived', () => {
		const t = transitionBetween(
			board([
				[0, 0, A, K],
				[1, 0, A, R],
				[9, 9, B, K],
				[1, 4, B, Pw],
			]),
			board([
				[0, 0, A, K],
				[1, 4, A, R],
				[9, 9, B, K],
			]),
			{eligible: true},
		);
		expect(t.moves.get(key(1, 4))).toEqual({x: 1, y: 0});
		expect(t.departures).toHaveLength(1);
		expect(t.departures[0]).toMatchObject({
			style: 'burn',
			delayMs: MOVE_MS,
			look: {x: 1, y: 4},
		});
	});

	it('burns a captured army, outward from its king, even outside play', () => {
		const t = transitionBetween(
			board([
				[0, 0, A, K],
				[1, 0, A, Pw],
				[3, 0, A, Pw],
				[9, 9, B, K],
			]),
			board([[9, 9, B, K]]),
			{eligible: false},
		);
		expect(t.departures.map((d) => [d.style, d.delayMs])).toEqual([
			['burn', MOVE_MS],
			['burn', MOVE_MS + BURN_MS + 60],
			['burn', MOVE_MS + BURN_MS + 180],
		]);
	});

	it('burns the rest of a captured army only once its captor has landed and its king has burned', () => {
		const t = transitionBetween(
			board([
				[0, 0, A, K],
				[1, 0, A, Pw],
				[2, 1, A, N],
				[4, 0, B, R],
				[9, 9, B, K],
			]),
			board([
				[0, 0, B, Q],
				[9, 9, B, K],
			]),
			{eligible: true},
		);
		// the rook slides onto the king and lands as a queen
		expect(t.moves.get(key(0, 0))).toEqual({x: 4, y: 0});
		const delays = new Map(
			t.departures.map((d) => [`${d.look.x},${d.look.y}`, d.delayMs]),
		);
		expect(delays.get('0,0')).toBe(MOVE_MS);
		expect(delays.get('1,0')).toBe(MOVE_MS + BURN_MS + 60);
		expect(delays.get('2,1')).toBe(MOVE_MS + BURN_MS + 120);
	});

	it('does not wait for a king that is not in view', () => {
		const prev = board([
			[1, 0, A, Pw],
			[9, 9, B, K],
		]);
		prev.kings = [king(A, 0, 0), king(B, 9, 9)];
		const t = transitionBetween(prev, board([[9, 9, B, K]]), {
			eligible: false,
		});
		expect(t.departures.map((d) => d.delayMs)).toEqual([MOVE_MS + 60]);
	});

	it('leaves a king that became a stone where it stood', () => {
		const t = transitionBetween(
			board([
				[0, 0, A, K],
				[1, 0, A, Pw],
				[9, 9, B, K],
			]),
			board([
				[0, 0, A, PIECE_KIND.Stone],
				[9, 9, B, K],
			]),
			{eligible: true},
		);
		expect(t.departures.map((d) => d.look)).toMatchObject([{x: 1, y: 0}]);
	});

	it('an army that left through an exit ascends, its king onto the exit', () => {
		// spacing 9: the exit band is offsets 4 and 5
		const t = transitionBetween(
			board([
				[3, 3, A, K],
				[2, 3, A, Pw],
				[20, 20, B, K],
			]),
			board([[20, 20, B, K]], {exited: new Set([A])}),
			{eligible: true, spawnSpacing: 9},
		);
		expect(t.departures.every((d) => d.style === 'ascend')).toBe(true);
		const kingGoes = t.departures.find((d) => d.look.kind === 'king');
		expect(kingGoes?.to).toEqual({x: 4, y: 4});
		expect(t.exitBursts).toEqual([{at: {x: 4, y: 4}, delayMs: MOVE_MS}]);
	});
});

describe('arrivals', () => {
	it('raises a newly deployed army, outward from its king', () => {
		const t = transitionBetween(
			board([[9, 9, B, K]]),
			board([
				[9, 9, B, K],
				[0, 0, C, K],
				[1, 0, C, Pw],
			]),
			{eligible: true},
		);
		expect(t.arrivals.get(key(0, 0))).toBe(0);
		expect(t.arrivals.get(key(1, 0))).toBe(60);
		expect(t.moves.size).toBe(0);
	});
});

describe('stake flights', () => {
	const outcome = (
		x: number,
		y: number,
		captured: P | undefined,
		now: P | undefined,
		died = 0,
	): OutcomeView => ({
		position: squareAt(x, y),
		position2d: {x, y},
		died,
		...(captured ? {captured: piece(captured)} : {}),
		...(now ? {piece: piece(now)} : {}),
	});

	it('flies from a captured king to the captor army king', () => {
		const view = board([
			[1, 1, B, Q],
			[5, 5, B, K],
		]);
		expect(
			stakeFlights(view, [outcome(1, 1, [1, 1, A, K], [1, 1, B, Q])]),
		).toEqual([
			{
				from: kingBadge({x: 1, y: 1}).centre,
				to: kingBadge({x: 5, y: 5}).centre,
				delayMs: MOVE_MS,
			},
		]);
	});

	it('flies from a captured stone too', () => {
		const view = board([
			[1, 1, B, R],
			[5, 5, B, K],
		]);
		expect(
			stakeFlights(view, [
				outcome(1, 1, [1, 1, A, PIECE_KIND.Stone], [1, 1, B, R]),
			]),
		).toHaveLength(1);
	});

	it('does not fly when a stone was made, nor for a plain capture', () => {
		const view = board([
			[1, 1, A, PIECE_KIND.Stone],
			[2, 2, B, R],
			[5, 5, B, K],
		]);
		expect(
			stakeFlights(view, [
				outcome(1, 1, [1, 1, A, K], [1, 1, A, PIECE_KIND.Stone]),
				outcome(2, 2, [2, 2, A, Pw], [2, 2, B, R]),
			]),
		).toEqual([]);
	});
});

describe('the tracker', () => {
	it('animates nothing on the first board, then plays a cycle', () => {
		const tracker = createTransitionTracker({});
		const first = tracker.step(
			board([
				[0, 0, A, K],
				[1, 0, A, R],
			]),
			0,
		);
		expect(first.moves.size).toBe(0);
		const next = tracker.step(
			board(
				[
					[0, 0, A, K],
					[1, 4, A, R],
				],
				{cycleNumber: 2},
			),
			10_000,
		);
		expect(next.moves.size).toBe(1);
	});

	it('reads a change long after the cycle began as a pan', () => {
		const tracker = createTransitionTracker({});
		tracker.step(
			board([
				[0, 0, A, K],
				[1, 0, A, R],
			]),
			0,
		);
		const t = tracker.step(
			board([
				[0, 0, A, K],
				[1, 4, A, R],
			]),
			SETTLE_WINDOW_MS + 1,
		);
		expect(t.moves.size).toBe(0);
	});

	it('plays each outcome once, and none already there on the first board', () => {
		const tracker = createTransitionTracker({});
		const captured: OutcomeView = {
			position: squareAt(1, 1),
			position2d: {x: 1, y: 1},
			died: 0,
			captured: piece([1, 1, A, K]),
			piece: piece([1, 1, B, Q]),
		};
		const after = (cycle: number, outcomesCycle: number) =>
			board(
				[
					[1, 1, B, Q],
					[5, 5, B, K],
				],
				{
					cycleNumber: cycle,
					outcomes: [captured],
					outcomesCycle,
				},
			);
		expect(tracker.step(after(1, 0), 0).flights).toEqual([]);
		// a later read of the same cycle: already played
		expect(tracker.step(after(1, 0), 100).flights).toEqual([]);
		// a new cycle's capture on the same square plays
		expect(tracker.step(after(2, 1), 5000).flights).toHaveLength(1);
		expect(tracker.step(after(2, 1), 5100).flights).toEqual([]);
	});
});
