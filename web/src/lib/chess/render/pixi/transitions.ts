/**
 * What the wooden board ANIMATES when the view state changes, worked out as
 * plain data. Pure (no DOM, no pixi), so every judgement here is tested in
 * node and `./effects.ts` and `./renderer.ts` only play it.
 *
 * NO RULE OF THE GAME IS HERE (`docs/adr/0007-rules-live-only-in-the-contract.md`).
 * The board after a cycle, which army died, which left through an exit and who
 * took whose stake are all the contract's answers, already in `BoardView`.
 * This module only compares two answers and chooses how to show the change:
 *
 * - **A move**: a piece gone from one square and a piece of the same army on
 *   another. The chain names no piece, so pieces are paired up per army,
 *   nearest first, same kind first (a promoted piece arrives as a queen). A
 *   wrong pairing (two knights of one army moving at once) only draws the wrong
 *   knight sliding: it changes nothing anyone may do.
 * - **A departure**: a piece gone with no piece to pair with. It BURNS (the
 *   pieces are wood) when its army was captured or it died in a collision, and
 *   it ASCENDS, in gold, when its army left through an exit.
 * - **An arrival**: the pieces of an army that was not on the board before (a
 *   deployment) rise into place.
 * - **A stake flight**: the ETH diamond travels from a captured king or stone
 *   to the king of the army that now holds its stake. An exit sends the
 *   diamond up out of the exit instead (an exit burst).
 *
 * WHEN IT IS SAFE TO READ A CHANGE AS A MOVE. The client loads only the area in
 * view (`../../board.ts`), so pieces also come and go as the camera pans. A
 * change is animated as play only when the board's cycle has just advanced (or
 * within a short window after, while the read settles); otherwise pieces just
 * appear and disappear as before. An army leaving the kings is the exception:
 * the kings come from the registry, not the area in view, so that is always a
 * real departure.
 */
import {PIECE_KIND} from '../../board';
import {isExitSquare} from '../../exits';
import {captureEffectsOf} from '../../outcomes';
import type {Position} from '../../squares';
import type {BoardView, PieceView} from '../../view';
import {kingBadge} from '../eth-diamond';
import {lookOf, type PieceLook} from './view-model';

/** How long a move slides, in milliseconds: departures wait for it. */
export const MOVE_MS = 420;

/**
 * How long after a cycle's first board a change still counts as play: a read
 * at the start of a cycle can lag the chain, and the settled one follows.
 */
export const SETTLE_WINDOW_MS = 4000;

/** No pairing across more squares than this: that is a pan, not a move. */
export const MAX_PAIR_DISTANCE = 16;

/** How long a piece takes to burn away (`./effects.ts` plays it). */
export const BURN_MS = 900;

/** Delay between two pieces of one army departing or arriving, per square. */
export const STAGGER_MS = 60;

/** How far from a king's last square an exit may be to be the one it took. */
const EXIT_REACH = 2;

export type Departure = {
	/** How the piece looked, on the board it is leaving. */
	look: PieceLook;
	style: 'burn' | 'ascend';
	delayMs: number;
	/** Where it slides to before it goes: an exiting king onto its exit. */
	to?: Position;
};

export type Transition = {
	/** By entity key (`p:<square>`, as `pieceLooks` keys): where it came from. */
	moves: Map<string, Position>;
	/** By entity key: how long to wait before rising into place. */
	arrivals: Map<string, number>;
	departures: Departure[];
	flights: Array<{from: Position; to: Position; delayMs: number}>;
	exitBursts: Array<{at: Position; delayMs: number}>;
};

export const noTransition = (): Transition => ({
	moves: new Map(),
	arrivals: new Map(),
	departures: [],
	flights: [],
	exitBursts: [],
});

/** A loaded view state: the board plus the cycle it was read for. */
export type BoardFrame = BoardView & {cycleNumber: number};

const distance = (a: Position, b: Position) =>
	Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

const entityKey = (piece: PieceView) => `p:${piece.position}`;

/**
 * Pair departed and arrived pieces of one army, nearest first, among the pairs
 * `fits` allows. Removes what it pairs from both lists.
 */
function pairUp(
	before: PieceView[],
	after: PieceView[],
	fits: (from: PieceView, to: PieceView) => boolean,
): Array<[PieceView, PieceView]> {
	const candidates: Array<[number, PieceView, PieceView]> = [];
	for (const from of before) {
		for (const to of after) {
			const d = distance(from.position2d, to.position2d);
			if (d <= MAX_PAIR_DISTANCE && fits(from, to)) {
				candidates.push([d, from, to]);
			}
		}
	}
	candidates.sort((a, b) => a[0] - b[0]);
	const pairs: Array<[PieceView, PieceView]> = [];
	const used = new Set<PieceView>();
	for (const [, from, to] of candidates) {
		if (used.has(from) || used.has(to)) continue;
		used.add(from);
		used.add(to);
		pairs.push([from, to]);
	}
	for (const list of [before, after]) {
		for (let i = list.length - 1; i >= 0; i--) {
			if (used.has(list[i])) list.splice(i, 1);
		}
	}
	return pairs;
}

function byArmy(pieces: PieceView[]): Map<bigint, PieceView[]> {
	const out = new Map<bigint, PieceView[]>();
	for (const piece of pieces) {
		const list = out.get(piece.army) ?? [];
		list.push(piece);
		out.set(piece.army, list);
	}
	return out;
}

function kingsByArmy(view: BoardView): Map<bigint, Position> {
	return new Map((view.kings ?? []).map((k) => [k.army, k.position2d]));
}

/** The exit square nearest `from` within reach, if any. */
function nearestExit(
	from: Position,
	spacing: number | undefined,
): Position | undefined {
	if (!spacing) return undefined;
	let best: Position | undefined;
	let bestD = Infinity;
	for (let dy = -EXIT_REACH; dy <= EXIT_REACH; dy++) {
		for (let dx = -EXIT_REACH; dx <= EXIT_REACH; dx++) {
			const x = from.x + dx;
			const y = from.y + dy;
			if (!isExitSquare(x, y, spacing)) continue;
			const d = Math.max(Math.abs(dx), Math.abs(dy));
			if (d < bestD) {
				best = {x, y};
				bestD = d;
			}
		}
	}
	return best;
}

/**
 * What changed between two boards, as animations. `eligible` says whether a
 * change of pieces may be read as play (see the module's comment).
 */
export function transitionBetween(
	prev: BoardView,
	next: BoardView,
	options: {eligible: boolean; spawnSpacing?: number},
): Transition {
	const out = noTransition();
	const prevKings = kingsByArmy(prev);
	const nextKings = kingsByArmy(next);
	const dead = new Set([...prevKings.keys()].filter((a) => !nextKings.has(a)));
	const born = new Set([...nextKings.keys()].filter((a) => !prevKings.has(a)));
	const exited = next.exited ?? new Set<bigint>();

	// Squares whose army did not change are not part of the change: a king
	// that became a stone stays where it stood.
	const before: PieceView[] = [];
	for (const [square, piece] of prev.pieces) {
		if (next.pieces.get(square)?.army !== piece.army) before.push(piece);
	}
	const after: PieceView[] = [];
	for (const [square, piece] of next.pieces) {
		if (prev.pieces.get(square)?.army !== piece.army) after.push(piece);
	}

	const beforeBy = byArmy(before);
	const afterBy = byArmy(after);

	if (options.eligible) {
		for (const [army, gone] of beforeBy) {
			const came = afterBy.get(army);
			if (!came || born.has(army)) continue;
			const pairs = [
				...pairUp(gone, came, (a, b) => a.kind === b.kind),
				// the piece that took a king lands as a queen
				...pairUp(gone, came, (_, b) => b.kind === PIECE_KIND.Queen),
			];
			for (const [from, to] of pairs) {
				out.moves.set(entityKey(to), from.position2d);
			}
		}
	}

	for (const [army, gone] of beforeBy) {
		const king = prevKings.get(army);
		const isDead = dead.has(army);
		if (!isDead && !options.eligible) continue;
		const leaving = isDead && exited.has(army);
		const exit =
			leaving && king ? nearestExit(king, options.spawnSpacing) : undefined;
		if (leaving) {
			const at = exit ?? king;
			if (at) out.exitBursts.push({at, delayMs: MOVE_MS});
		}
		// A captured army whose king is seen falling: the king burns when its
		// captor lands, and the rest of the army only once the king is gone.
		const kingFalls =
			isDead &&
			!leaving &&
			king !== undefined &&
			gone.some((p) => distance(p.position2d, king) === 0);
		for (const piece of gone) {
			const look = lookOf(piece, prev);
			if (!look) continue;
			const isKing =
				king !== undefined && distance(piece.position2d, king) === 0;
			const fromKing = king ? distance(piece.position2d, king) : 0;
			const afterKing = kingFalls && !isKing ? BURN_MS : 0;
			out.departures.push({
				look,
				style: leaving ? 'ascend' : 'burn',
				// a captured piece burns when its captor arrives
				delayMs: MOVE_MS + afterKing + (isDead ? fromKing * STAGGER_MS : 0),
				...(leaving && isKing && exit ? {to: exit} : {}),
			});
		}
	}

	for (const army of born) {
		const king = nextKings.get(army)!;
		for (const piece of afterBy.get(army) ?? []) {
			out.arrivals.set(
				entityKey(piece),
				distance(piece.position2d, king) * STAGGER_MS,
			);
		}
	}

	return out;
}

/**
 * The stake flights a cycle's outcomes call for: from each captured king or
 * stone (or a moving king that met one piece) to the king of the army whose
 * piece stands there now. None for a capture whose captor's king fell (a stone
 * was made: the stake stays on the board), or whose captor has no king in view.
 */
export function stakeFlights(
	view: BoardView,
	outcomes: BoardView['outcomes'],
): Transition['flights'] {
	const kings = kingsByArmy(view);
	const flights: Transition['flights'] = [];
	for (const outcome of outcomes) {
		const {captured, piece} = outcome;
		if (!piece) continue;
		const effects = captureEffectsOf(outcome);
		if (effects.stoneMade) continue;
		const tookStake =
			captured?.kind === PIECE_KIND.King ||
			captured?.kind === PIECE_KIND.Stone ||
			effects.kingMet;
		if (!tookStake) continue;
		const king = kings.get(piece.army);
		if (!king) continue;
		flights.push({
			// badge to badge: the diamond leaves from where it was drawn
			from: kingBadge(outcome.position2d).centre,
			to: kingBadge(king).centre,
			delayMs: MOVE_MS,
		});
	}
	return flights;
}

/**
 * Follows the view state and says what each change animates. Remembers the
 * board before, the cycle and when it was first seen, and which outcomes were
 * already played, so a reload or a pan replays nothing.
 */
export function createTransitionTracker(options: {spawnSpacing?: number}) {
	let prev: BoardFrame | undefined;
	let cycle = -1;
	let cycleSince = 0;
	let outcomesCycle = -1;
	let outcomesSince = 0;
	let played = new Set<string>();

	return {
		step(view: BoardFrame, nowMs: number): Transition {
			if (!prev) {
				// the first board is what was already there: nothing to animate
				prev = view;
				cycle = view.cycleNumber;
				cycleSince = nowMs;
				outcomesCycle = view.outcomesCycle;
				outcomesSince = nowMs;
				played = new Set(view.outcomes.map((o) => String(o.position)));
				return noTransition();
			}
			if (view.cycleNumber > cycle) {
				cycle = view.cycleNumber;
				cycleSince = nowMs;
			}
			const eligible = nowMs - cycleSince <= SETTLE_WINDOW_MS;
			const out = transitionBetween(prev, view, {
				eligible,
				spawnSpacing: options.spawnSpacing,
			});

			if (view.outcomesCycle > outcomesCycle) {
				outcomesCycle = view.outcomesCycle;
				outcomesSince = nowMs;
				played = new Set();
			}
			const fresh = view.outcomes.filter(
				(o) => !played.has(String(o.position)),
			);
			for (const o of fresh) played.add(String(o.position));
			if (
				view.outcomesCycle === outcomesCycle &&
				nowMs - outcomesSince <= SETTLE_WINDOW_MS
			) {
				out.flights.push(...stakeFlights(view, fresh));
			}

			prev = view;
			return out;
		},
		/** Forget the board: the next one is the first again. */
		reset() {
			prev = undefined;
		},
	};
}
