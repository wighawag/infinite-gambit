import {describe, it, expect, vi} from 'vitest';
import {get, writable} from 'svelte/store';
import {
	boardClick,
	createPlanning,
	createWholeMoveGuard,
	piecesAround,
	refusalOf,
	MOVE_REACH,
} from '$lib/chess/planning';
import {PIECE_KIND, type BoardState, type Piece} from '$lib/chess/board';
import {
	bondFor,
	deploymentAt,
	moveOf,
	pieceMovesOf,
	refusingIllegalMoves,
	type Move,
} from '$lib/chess/commit-reveal';
import {positionOf as positionOfSquare, squareAt} from '$lib/chess/squares';
import {holdPlanUntilBoardReleases} from '$lib/chess/display-plan';
import {mergeBoardView, type LocalPlan} from '$lib/chess/view';
import {describeMoving} from '$lib/chess/ui/hud';
import {ARMY_STATUS} from '$lib/chess/armies';
import type {SubmissionState, SubmissionStore} from '$lib/game/core/submission';
import type {GameIdentity} from '$lib/game/identity';
import type {OnchainStateValue} from '$lib/game/core/seams';
import {noOutcomes} from '$lib/chess/outcomes';

/**
 * PLANNING A MOVE: selecting a piece, asking the contract's rule where it may
 * go alongside the piece-moves already planned, and turning a click on one of
 * those squares into one more piece-move of the submission's move (up to the
 * cap the game reports, `docs/adr/0016`). The rule itself is never here: the
 * whole-move route (`legalMovesAlongside`, `isLegalWholeMove`) is the
 * Simulation route, faked in these tests by whatever a test says it answers.
 */

const YOU = 1n << 160n;
const THEM = 2n << 160n;

function piece(
	x: number,
	y: number,
	army = YOU,
	kind: Piece['kind'] = PIECE_KIND.Knight,
): Piece {
	return {
		position: squareAt(x, y),
		army,
		kind,
	};
}

function boardOf(pieces: Piece[]): OnchainStateValue<BoardState> {
	return {
		step: 'Loaded',
		pieces: new Map(pieces.map((p) => [p.position, p])),
		spawnPoints: [],
		armies: [],
		outcomes: noOutcomes(),
	};
}

/** A submission that only plans, which is all planning touches. */
function fakeSubmission(): SubmissionStore<GameIdentity, Move> {
	const state = writable<SubmissionState<Move>>({step: 'Idle'});
	return {
		subscribe: state.subscribe,
		get value() {
			return get(state);
		},
		ready: writable(true),
		plan(actions: readonly Move[]) {
			state.set({step: 'Planning', cycleNumber: 5, actions});
		},
	} as unknown as SubmissionStore<GameIdentity, Move>;
}

type Alongside = (
	board: readonly Piece[],
	from: bigint,
	others: readonly Move[],
	cap: bigint,
) => bigint[];
type IsLegal = (
	board: readonly Piece[],
	army: bigint,
	moves: readonly Move[],
	cap: bigint,
) => boolean;

/**
 * The whole-move route, faked: every call recorded, `legalMovesAlongside`
 * answered by `alongside` and `isLegalWholeMove` by `isLegal`.
 */
function fakeRoute(alongside: Alongside, isLegal: IsLegal = () => true) {
	const call = vi.fn(async (functionName: string, args: readonly unknown[]) => {
		const [board, second, moves, cap] = args as [
			Piece[],
			bigint,
			Move[],
			bigint,
		];
		return functionName === 'legalMovesAlongside'
			? alongside(board, second, moves, cap)
			: isLegal(board, second, moves, cap);
	});
	return call;
}

function setup(
	options: {
		needsDeployment?: boolean;
		canMove?: boolean;
		answer?: bigint[];
		alongside?: Alongside;
		isLegal?: IsLegal;
		maxPieceMoves?: number;
	} = {},
) {
	const submission = fakeSubmission();
	const board = writable(
		boardOf([
			piece(0, 0),
			piece(1, 1, THEM),
			piece(3, 0),
			piece(6, 0),
			piece(9, 0),
			piece(20, 20),
			piece(40, 40, THEM, PIECE_KIND.King),
			piece(42, 40, YOU, PIECE_KIND.King),
			piece(44, 40, THEM, PIECE_KIND.Stone),
		]),
	);
	const wholeMove = fakeRoute(
		options.alongside ??
			(() => options.answer ?? [squareAt(1, 2), squareAt(2, 1)]),
		options.isLegal,
	);
	const maxPieceMoves = writable<number | undefined>(
		options.maxPieceMoves ?? 3,
	);
	const planning = createPlanning({
		submission,
		needsDeployment: writable(options.needsDeployment ?? false),
		canMove: writable(options.canMove ?? true),
		army: writable(YOU),
		board,
		maxPieceMoves,
		wholeMove,
	});
	// The plan is only computed while somebody reads it, as the view does.
	let plan: LocalPlan = {};
	planning.plan.subscribe((p) => (plan = p));
	let refusal: string | undefined;
	planning.refusal.subscribe((r) => (refusal = r));
	const flush = () => new Promise((r) => setTimeout(r, 0));
	/** Select the piece on (x, y), wait for its destinations, then pick (tx, ty). */
	const plan2 = async (x: number, y: number, tx: number, ty: number) => {
		planning.click(squareAt(x, y));
		await flush();
		planning.click(squareAt(tx, ty));
		await flush();
	};
	const alongsideCalls = () =>
		wholeMove.mock.calls.filter(([name]) => name === 'legalMovesAlongside');
	return {
		submission,
		planning,
		wholeMove,
		alongsideCalls,
		maxPieceMoves,
		flush,
		pick: plan2,
		plan: () => plan,
		refusal: () => refusal,
	};
}

describe('planning a move', () => {
	it('highlights the destinations the contract names for the selected piece', async () => {
		const t = setup();
		t.planning.click(squareAt(0, 0));
		await t.flush();
		expect(t.plan().selected).toBe(squareAt(0, 0));
		expect(t.plan().destinations).toEqual([squareAt(1, 2), squareAt(2, 1)]);
		// Asked about the neighbourhood only: the far piece is not sent. Nothing
		// is planned yet, so nothing alongside, at the game's cap.
		const [[, [sent, from, others, cap]]] = t.alongsideCalls() as unknown as [
			string,
			[Piece[], bigint, Move[], bigint],
		][];
		expect(from).toBe(squareAt(0, 0));
		expect(others).toEqual([]);
		expect(cap).toBe(3n);
		expect(sent.map((p) => p.position).sort()).toEqual(
			[squareAt(0, 0), squareAt(1, 1), squareAt(3, 0), squareAt(6, 0)].sort(),
		);
	});

	it('plans the move on a click onto a highlighted square, and takes it back on a second', async () => {
		const t = setup();
		t.planning.click(squareAt(0, 0));
		await t.flush();
		t.planning.click(squareAt(2, 1));
		const move = {from: squareAt(0, 0), to: squareAt(2, 1)};
		expect(get(t.planning.actions)).toEqual([move]);
		expect(t.plan().moves).toEqual([move]);
		expect(t.plan().selected).toBeUndefined();
		expect(get(t.planning.count)).toBe(1);

		t.planning.click(squareAt(0, 0));
		await t.flush();
		t.planning.click(squareAt(2, 1));
		expect(get(t.planning.actions)).toEqual([]);
	});

	it('plans nothing on a square the contract did not name', async () => {
		const t = setup();
		t.planning.click(squareAt(0, 0));
		await t.flush();
		t.planning.click(squareAt(0, 3));
		expect(get(t.planning.actions)).toEqual([]);
		expect(t.plan().selected).toBeUndefined();
	});

	it('ignores board clicks while the army still has to be deployed', async () => {
		const t = setup({needsDeployment: true});
		t.planning.click(squareAt(0, 0));
		await t.flush();
		expect(t.plan().selected).toBeUndefined();
		expect(t.wholeMove).not.toHaveBeenCalled();
	});
});

/** Offers every piece the square above it, and two above, unless the move is full. */
const upward: Alongside = (_board, from, others, cap) => {
	if (BigInt(others.length) >= cap) return [];
	const {x, y} = positionOfSquare(from);
	return [squareAt(x, y + 1), squareAt(x, y + 2)];
};

describe('planning up to three piece-moves', () => {
	it('plans one piece-move per piece, each offered alongside the others, up to the cap', async () => {
		const t = setup({alongside: upward});
		await t.pick(0, 0, 0, 1);
		await t.pick(3, 0, 3, 2);
		await t.pick(6, 0, 6, 1);
		const moves = [
			{from: squareAt(0, 0), to: squareAt(0, 1)},
			{from: squareAt(3, 0), to: squareAt(3, 2)},
			{from: squareAt(6, 0), to: squareAt(6, 1)},
		];
		// ONE submission holds all three: one commitment.
		expect(get(t.planning.actions)).toEqual(moves);
		expect(get(t.planning.pieceMoves)).toEqual(moves);
		expect(get(t.planning.count)).toBe(3);
		expect(t.plan().moves).toEqual(moves);
		// The third piece was asked about alongside the first two, and handed
		// the pieces around every one of them.
		const third = t.alongsideCalls()[2][1] as [Piece[], bigint, Move[], bigint];
		expect(third[1]).toBe(squareAt(6, 0));
		expect(third[2]).toEqual(moves.slice(0, 2));
		expect(third[0].map((p) => p.position)).toContain(squareAt(9, 0));

		// A fourth piece: the route offers it nothing, so nothing is planned.
		t.planning.click(squareAt(9, 0));
		await t.flush();
		expect(t.plan().destinations).toEqual([]);
		t.planning.click(squareAt(9, 1));
		expect(get(t.planning.actions)).toEqual(moves);
	});

	it('takes back any one of them, from the HUD or by picking its square again, and keeps the rest in order', async () => {
		const t = setup({alongside: upward});
		await t.pick(0, 0, 0, 1);
		await t.pick(3, 0, 3, 2);
		await t.pick(6, 0, 6, 1);
		t.planning.takeBack(squareAt(3, 0));
		expect(get(t.planning.actions)).toEqual([
			{from: squareAt(0, 0), to: squareAt(0, 1)},
			{from: squareAt(6, 0), to: squareAt(6, 1)},
		]);
		// The planned square again: taken back too.
		await t.pick(0, 0, 0, 1);
		expect(get(t.planning.actions)).toEqual([
			{from: squareAt(6, 0), to: squareAt(6, 1)},
		]);
	});

	it('changes a piece’s piece-move in place when it is given another square', async () => {
		const t = setup({alongside: upward});
		await t.pick(0, 0, 0, 1);
		await t.pick(3, 0, 3, 1);
		// Re-selected, the piece is asked about alongside the OTHER one only.
		await t.pick(0, 0, 0, 2);
		const last = t.alongsideCalls().at(-1)![1] as [
			Piece[],
			bigint,
			Move[],
			bigint,
		];
		expect(last[2]).toEqual([{from: squareAt(3, 0), to: squareAt(3, 1)}]);
		expect(get(t.planning.actions)).toEqual([
			{from: squareAt(0, 0), to: squareAt(0, 2)},
			{from: squareAt(3, 0), to: squareAt(3, 1)},
		]);
	});

	it('plays one piece-move at a table that turns three off: a new one replaces the planned one', async () => {
		const t = setup({alongside: upward, maxPieceMoves: 1});
		await t.pick(0, 0, 0, 1);
		await t.pick(3, 0, 3, 1);
		expect(get(t.planning.actions)).toEqual([
			{from: squareAt(3, 0), to: squareAt(3, 1)},
		]);
		// Asked at cap 1, alongside nothing: there is no "alongside" at one.
		for (const [, args] of t.alongsideCalls()) {
			expect((args as unknown[])[2]).toEqual([]);
			expect((args as unknown[])[3]).toBe(1n);
		}
	});

	it('offers nothing until the game has said its cap', async () => {
		const t = setup({alongside: upward, maxPieceMoves: undefined});
		t.maxPieceMoves.set(undefined);
		t.planning.click(squareAt(0, 0));
		await t.flush();
		expect(t.plan().destinations).toEqual([]);
		expect(t.wholeMove).not.toHaveBeenCalled();
		t.maxPieceMoves.set(3);
		await t.flush();
		expect(t.plan().destinations).toEqual([squareAt(0, 1), squareAt(0, 2)]);
	});
});

describe('a whole move the contract refuses', () => {
	// Offers (0,0) the square (0,1) only while (3,0) moves too: as if the first
	// piece-move needed a square the second one vacates.
	const needsTheOther: Alongside = (_board, from, others) => {
		const {x, y} = positionOfSquare(from);
		if (from === squareAt(0, 0) && others.length === 0) return [];
		return [squareAt(x, y + 1)];
	};
	const legalOnlyWithBoth: IsLegal = (_board, _army, moves) =>
		moves.length !== 1 || moves[0].from !== squareAt(0, 0);

	it('is refused before commit, with a reason that names the piece-move', async () => {
		const t = setup({alongside: needsTheOther, isLegal: legalOnlyWithBoth});
		await t.pick(3, 0, 3, 1);
		await t.pick(0, 0, 0, 1);
		await t.flush();
		expect(t.refusal()).toBeUndefined();
		// Taking back the piece-move it relied on leaves it illegal.
		t.planning.takeBack(squareAt(3, 0));
		await t.flush();
		await t.flush();
		expect(t.refusal()).toBe(
			'The contract refuses (0, 0) to (0, 1) alongside the rest of the move. Take it back or change it.',
		);
		// The verdict is the route's, asked at the game's cap.
		const verdicts = t.wholeMove.mock.calls.filter(
			([name]) => name === 'isLegalWholeMove',
		);
		expect((verdicts.at(-1)![1] as unknown[]).slice(1)).toEqual([
			YOU,
			[{from: squareAt(0, 0), to: squareAt(0, 1)}],
			3n,
		]);
	});

	it('says nothing about a pass or a deployment, and is never asked about them', async () => {
		const route = {
			isLegal: vi.fn(async () => false),
			alongside: vi.fn(async () => []),
		};
		expect(
			await refusalOf({route, pieces: new Map(), army: YOU, moves: []}),
		).toBeUndefined();
		const guard = createWholeMoveGuard({
			board: () => boardOf([]),
			army: () => YOU,
			maxPieceMoves: async () => 3,
			call: fakeRoute(
				() => [],
				() => false,
			),
		});
		expect(await guard(deploymentAt(squareAt(16, 0)))).toBeUndefined();
		expect(await guard([])).toBeUndefined();
		expect(route.isLegal).not.toHaveBeenCalled();
	});

	it('is refused at the commit itself, so the submission never commits it on its own either', async () => {
		const illegal = [{from: squareAt(0, 0), to: squareAt(0, 1)}];
		const guard = createWholeMoveGuard({
			board: () => boardOf([piece(0, 0)]),
			army: () => YOU,
			maxPieceMoves: async () => 3,
			call: fakeRoute(
				() => [],
				() => false,
			),
		});
		const commit = vi.fn(async () => ({}) as never);
		const adapter = refusingIllegalMoves({commit} as never, guard);
		await expect(adapter.commit({actions: illegal} as never)).rejects.toThrow(
			'The contract refuses (0, 0) to (0, 1)',
		);
		expect(commit).not.toHaveBeenCalled();
		// A legal one goes through.
		const accepting = refusingIllegalMoves(
			{commit} as never,
			createWholeMoveGuard({
				board: () => boardOf([piece(0, 0)]),
				army: () => YOU,
				maxPieceMoves: async () => 3,
				call: fakeRoute(() => [squareAt(0, 1)]),
			}),
		);
		await accepting.commit({actions: illegal} as never);
		expect(commit).toHaveBeenCalledOnce();
	});

	it('refuses, saying why, when it cannot ask the contract', async () => {
		const guard = createWholeMoveGuard({
			board: () => ({step: 'Unloaded'}),
			army: () => YOU,
			maxPieceMoves: async () => 3,
			call: fakeRoute(() => []),
		});
		const moves = [{from: squareAt(0, 0), to: squareAt(0, 1)}];
		expect(await guard(moves)).toMatch(/cannot be checked/);
		const failing = createWholeMoveGuard({
			board: () => boardOf([piece(0, 0)]),
			army: () => YOU,
			maxPieceMoves: async () => {
				throw new Error('no route');
			},
			call: fakeRoute(() => []),
		});
		expect(await failing(moves)).toMatch(
			/Could not ask the contract.*no route/,
		);
	});
});

describe('inspecting a stake', () => {
	it('shows the stake of any king or stone clicked, an enemy one too', () => {
		const t = setup();
		t.planning.click(squareAt(40, 40));
		expect(t.plan().inspected).toBe(squareAt(40, 40));
		t.planning.click(squareAt(44, 40));
		expect(t.plan().inspected).toBe(squareAt(44, 40));
	});

	it('selects your own king as well as showing its stake', async () => {
		const t = setup();
		t.planning.click(squareAt(42, 40));
		await t.flush();
		expect(t.plan().inspected).toBe(squareAt(42, 40));
		expect(t.plan().selected).toBe(squareAt(42, 40));
	});

	it('hides it on a click anywhere else, or a second click on it', () => {
		const t = setup();
		t.planning.click(squareAt(40, 40));
		t.planning.click(squareAt(0, 3));
		expect(t.plan().inspected).toBeUndefined();
		t.planning.click(squareAt(40, 40));
		t.planning.click(squareAt(40, 40));
		expect(t.plan().inspected).toBeUndefined();
	});

	it('works while nothing can be planned', () => {
		const t = setup({canMove: false});
		t.planning.click(squareAt(40, 40));
		expect(t.plan().inspected).toBe(squareAt(40, 40));
		expect(t.plan().selected).toBeUndefined();
	});
});

describe('a click on the board', () => {
	const pieces = new Map([
		[squareAt(0, 0), piece(0, 0)],
		[squareAt(1, 1), piece(1, 1, THEM)],
	]);
	const base = {pieces, you: YOU, destinations: [squareAt(1, 1)]};

	it('selects one of your own pieces, never another army’s', () => {
		expect(
			boardClick({...base, square: squareAt(0, 0), selected: undefined}),
		).toEqual({
			kind: 'select',
			square: squareAt(0, 0),
		});
		expect(
			boardClick({...base, square: squareAt(1, 1), selected: undefined}),
		).toEqual({
			kind: 'deselect',
		});
	});

	it('moves onto a highlighted square, enemy-held or not, and lets go elsewhere', () => {
		expect(
			boardClick({...base, square: squareAt(1, 1), selected: squareAt(0, 0)}),
		).toEqual({
			kind: 'move',
			move: {from: squareAt(0, 0), to: squareAt(1, 1)},
		});
		expect(
			boardClick({...base, square: squareAt(0, 0), selected: squareAt(0, 0)}),
		).toEqual({
			kind: 'deselect',
		});
	});

	it('hands the rule every piece within reach of the selected one', () => {
		const map = new Map(
			[
				piece(0, 0),
				piece(MOVE_REACH, -MOVE_REACH),
				piece(MOVE_REACH + 1, 0),
			].map((p) => [p.position, p]),
		);
		expect(piecesAround(map, squareAt(0, 0)).length).toBe(2);
	});
});

describe('a move, as the rest of the client sees it', () => {
	const move = {from: squareAt(0, 0), to: squareAt(2, 1)};

	const second = {from: squareAt(3, 0), to: squareAt(3, 1)};

	it('is a move and not a deployment, and bonds nothing', () => {
		expect(moveOf([move])).toEqual(move);
		expect(moveOf(deploymentAt(squareAt(16, 0)))).toBeUndefined();
		expect(pieceMovesOf([move, second])).toEqual([move, second]);
		expect(pieceMovesOf(deploymentAt(squareAt(16, 0)))).toEqual([]);
		expect(bondFor({stake: 10n} as never, [move])).toBe(0n);
		expect(bondFor({stake: 10n} as never, [move, second])).toBe(0n);
	});

	it('is drawn from its square to its destination', () => {
		const view = mergeBoardView({
			onchain: {
				step: 'Loaded',
				pieces: new Map(),
				spawnPoints: [],
				armies: [],
				outcomes: noOutcomes(),
				cycleNumber: 3,
			} as never,
			local: {
				moves: [move, second],
				selected: squareAt(5, 5),
				destinations: [squareAt(5, 6)],
			},
		} as never);
		// Each piece-move drawn apart, numbered by its place in the move.
		expect(view.plannedMoves).toEqual([
			{from: {x: 0, y: 0}, to: {x: 2, y: 1}, index: 0},
			{from: {x: 3, y: 0}, to: {x: 3, y: 1}, index: 1},
		]);
		expect(view.selected).toEqual({x: 5, y: 5});
		expect(view.destinations).toEqual([{x: 5, y: 6}]);
	});

	it('stays on screen once revealed, until the board takes it over', () => {
		const holding = writable<number | undefined>(3);
		const held = holdPlanUntilBoardReleases({
			submission: writable({
				step: 'Planning',
				cycleNumber: 3,
				actions: [move, second],
			} as never),
			plan: writable({}),
			holding,
		});
		let value: LocalPlan = {};
		const stop = held.subscribe((v) => (value = v));
		expect(value.moves).toEqual([move, second]);
		// Released: drawn from the submission again, which here plans nothing.
		holding.set(undefined);
		expect(value.moves).toBeUndefined();
		stop();
	});

	it('is named in the HUD while the army stands on the board, each piece-move in its colour', () => {
		const deployed = {status: ARMY_STATUS.Deployed};
		expect(
			describeMoving({army: deployed, moves: [move, second], maxPieceMoves: 3}),
		).toEqual({
			pieceMoves: [
				{from: move.from, label: '(0, 0) to (2, 1)', colour: '#ffd166'},
				{from: second.from, label: '(3, 0) to (3, 1)', colour: '#5ad1e6'},
			],
			countLabel: '2 of 3 piece-moves',
		});
		expect(
			describeMoving({army: deployed, moves: [], maxPieceMoves: 1}),
		).toEqual({pieceMoves: [], countLabel: '0 of 1 piece-move'});
		expect(
			describeMoving({army: deployed, moves: [move], refusal: 'no'}),
		).toMatchObject({refusal: 'no'});
		expect(
			describeMoving({army: {status: ARMY_STATUS.Deploying}, moves: [move]}),
		).toBeUndefined();
	});
});
