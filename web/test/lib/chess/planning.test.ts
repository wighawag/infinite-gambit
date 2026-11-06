import {describe, it, expect, vi} from 'vitest';
import {get, writable} from 'svelte/store';
import {
	boardClick,
	createPlanning,
	piecesAround,
	MOVE_REACH,
} from '$lib/chess/planning';
import {PIECE_KIND, type BoardState, type Piece} from '$lib/chess/board';
import {
	bondFor,
	deploymentAt,
	moveOf,
	type Move,
} from '$lib/chess/commit-reveal';
import {squareAt} from '$lib/chess/squares';
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
 * go, and turning a click on one of those squares into the submission's one
 * move. The rule itself is never here: `legalMoves` is the Simulation route,
 * faked in these tests by whatever a test says it answers.
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

function setup(options: {needsDeployment?: boolean; answer?: bigint[]} = {}) {
	const submission = fakeSubmission();
	const board = writable(
		boardOf([piece(0, 0), piece(1, 1, THEM), piece(20, 20)]),
	);
	const legalMoves = vi.fn(
		async () => options.answer ?? [squareAt(1, 2), squareAt(2, 1)],
	);
	const planning = createPlanning({
		submission,
		needsDeployment: writable(options.needsDeployment ?? false),
		canMove: writable(true),
		army: writable(YOU),
		board,
		legalMoves,
	});
	// The plan is only computed while somebody reads it, as the view does.
	let plan: LocalPlan = {};
	planning.plan.subscribe((p) => (plan = p));
	const flush = () => new Promise((r) => setTimeout(r, 0));
	return {submission, planning, legalMoves, flush, plan: () => plan};
}

describe('planning a move', () => {
	it('highlights the destinations the contract names for the selected piece', async () => {
		const t = setup();
		t.planning.click(squareAt(0, 0));
		await t.flush();
		expect(t.plan().selected).toBe(squareAt(0, 0));
		expect(t.plan().destinations).toEqual([squareAt(1, 2), squareAt(2, 1)]);
		// Asked about the neighbourhood only: the far piece is not sent.
		const [[sent, from]] = t.legalMoves.mock.calls as unknown as [
			Piece[],
			bigint,
		][];
		expect(from).toBe(squareAt(0, 0));
		expect(sent.map((p) => p.position).sort()).toEqual(
			[squareAt(0, 0), squareAt(1, 1)].sort(),
		);
	});

	it('plans the move on a click onto a highlighted square, and takes it back on a second', async () => {
		const t = setup();
		t.planning.click(squareAt(0, 0));
		await t.flush();
		t.planning.click(squareAt(2, 1));
		const move = {from: squareAt(0, 0), to: squareAt(2, 1)};
		expect(get(t.planning.actions)).toEqual([move]);
		expect(t.plan().move).toEqual(move);
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
		expect(t.legalMoves).not.toHaveBeenCalled();
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

	it('is a move and not a deployment, and bonds nothing', () => {
		expect(moveOf([move])).toEqual(move);
		expect(moveOf(deploymentAt(squareAt(16, 0)))).toBeUndefined();
		expect(bondFor({stake: 10n} as never, [move])).toBe(0n);
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
			local: {move, selected: squareAt(5, 5), destinations: [squareAt(5, 6)]},
		} as never);
		expect(view.plannedMove).toEqual({from: {x: 0, y: 0}, to: {x: 2, y: 1}});
		expect(view.selected).toEqual({x: 5, y: 5});
		expect(view.destinations).toEqual([{x: 5, y: 6}]);
	});

	it('stays on screen once revealed, until the board takes it over', () => {
		const holding = writable<number | undefined>(3);
		const held = holdPlanUntilBoardReleases({
			submission: writable({
				step: 'Planning',
				cycleNumber: 3,
				actions: [move],
			} as never),
			plan: writable({}),
			holding,
		});
		let value: LocalPlan = {};
		const stop = held.subscribe((v) => (value = v));
		expect(value.move).toEqual(move);
		// Released: drawn from the submission again, which here plans nothing.
		holding.set(undefined);
		expect(value.move).toBeUndefined();
		stop();
	});

	it('is named in the HUD while the army stands on the board', () => {
		expect(
			describeMoving({army: {status: ARMY_STATUS.Deployed}, move}),
		).toEqual({
			planned: '(0, 0) to (2, 1)',
		});
		expect(
			describeMoving({army: {status: ARMY_STATUS.Deployed}, move: undefined}),
		).toEqual({});
		expect(
			describeMoving({army: {status: ARMY_STATUS.Deploying}, move}),
		).toBeUndefined();
	});
});
