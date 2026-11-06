/**
 * Turning clicks into a plan: the spawn point a deployment commits to, or the
 * one move a deployed army makes this cycle.
 *
 * The plan itself lives in the framework's submission (it is what gets hashed,
 * and it has to survive a reload), so this keeps no second copy of it. What it
 * keeps is the SELECTION, which is not part of any plan: the piece the player
 * clicked, whose legal destinations are highlighted until they pick one.
 *
 * Which destinations are legal is the CONTRACT's rule, run from the Simulation
 * route's own bytecode in the sandbox (`legalMoves`), never a TypeScript copy
 * of it (`docs/adr/0007-rules-live-only-in-the-contract.md`). This file only
 * asks, and draws nothing from the answer but the squares it names.
 */
import {derived, get, writable, type Readable} from 'svelte/store';
import type {SubmissionState, SubmissionStore} from '$lib/game/core/submission';
import type {OnchainStateValue} from '$lib/game/core/seams';
import type {GameIdentity} from '$lib/game/identity';
import {latestResult} from '$lib/game/simulation';
import {PIECE_KIND, type BoardState, type Piece, type PieceKind} from './board';
import {deploymentAt, moveOf, spawnPointOf, type Move} from './commit-reveal';
import {kingDistance, positionOf, type Position} from './squares';
import type {LocalPlan} from './view';

/** The plan is only changeable while the submission has not been committed. */
export function isPlannable(state: SubmissionState<Move>): boolean {
	return (
		state.step === 'Idle' ||
		state.step === 'Planning' ||
		state.step === 'Revealed' ||
		state.step === 'Missed' ||
		(state.step === 'Error' && state.during === 'commit')
	);
}

function plannedActionsOf(state: SubmissionState<Move>): readonly Move[] {
	return 'actions' in state ? state.actions : [];
}

/**
 * How near a spawn point a click must land to pick it: anywhere on the
 * footprint an army deployed there would stand on, which reaches two squares
 * from its spawn point on each axis (`docs/adr/0015`).
 */
export const PICK_RADIUS = 2;

/**
 * The open spawn point a click at `position` picks, if any: the nearest one
 * within {@link PICK_RADIUS} king steps.
 */
export function spawnPointNear(
	position: Position,
	spawnPoints: readonly bigint[],
): bigint | undefined {
	let best: {spawnPoint: bigint; distance: number} | undefined;
	for (const spawnPoint of spawnPoints) {
		const distance = kingDistance(position, positionOf(spawnPoint));
		if (distance > PICK_RADIUS) continue;
		if (!best || distance < best.distance) best = {spawnPoint, distance};
	}
	return best?.spawnPoint;
}

/**
 * How far from a piece the board can matter to its moves: a slider reaches 7
 * squares and a king looks one square past its destination, so 8 covers
 * every square `legalMoves` reads.
 */
export const MOVE_REACH = 8;

/**
 * The pieces within {@link MOVE_REACH} of `from`: what `legalMoves` is handed,
 * so the sandbox is asked about the neighbourhood rather than the whole view.
 */
export function piecesAround(
	pieces: ReadonlyMap<bigint, Piece>,
	from: bigint,
): Piece[] {
	const centre = positionOf(from);
	const around: Piece[] = [];
	for (const piece of pieces.values()) {
		if (kingDistance(centre, positionOf(piece.position)) <= MOVE_REACH) {
			around.push(piece);
		}
	}
	return around.sort((a, b) =>
		a.position < b.position ? -1 : a.position > b.position ? 1 : 0,
	);
}

/** Whether a piece holds its army's stake, which a click on it shows. */
function isStakeHolder(kind: PieceKind | undefined): boolean {
	return kind === PIECE_KIND.King || kind === PIECE_KIND.Stone;
}

/** What a click on a square means for a deployed army's plan. */
export type BoardClick =
	| {kind: 'move'; move: Move}
	| {kind: 'select'; square: bigint}
	| {kind: 'deselect'};

/**
 * What a click on `square` does: onto a highlighted destination of the
 * selected piece it plans that move; onto one of the player's own pieces it
 * selects it (a second click on it lets go); anywhere else it lets go.
 */
export function boardClick(params: {
	square: bigint;
	pieces: ReadonlyMap<bigint, Piece>;
	you: bigint | undefined;
	selected: bigint | undefined;
	destinations: readonly bigint[];
}): BoardClick {
	const {square, selected} = params;
	if (selected !== undefined && params.destinations.includes(square)) {
		return {kind: 'move', move: {from: selected, to: square}};
	}
	const piece = params.pieces.get(square);
	if (
		piece !== undefined &&
		params.you !== undefined &&
		piece.army === params.you &&
		square !== selected
	) {
		return {kind: 'select', square};
	}
	return {kind: 'deselect'};
}

type HighlightInput = {from: bigint; pieces: Piece[]; key: string};

const keyOf = (from: bigint, pieces: readonly Piece[]) =>
	`${from}|${pieces.map((p) => `${p.position}:${p.army}:${p.kind}`).join(',')}`;

export type PlanningStore = {
	/** What the player has planned, for the view merge. */
	plan: Readable<LocalPlan>;
	/** The same, in the shape the contract is committed to. */
	actions: Readable<readonly Move[]>;
	/** Whether clicks currently change anything. */
	canPlan: Readable<boolean>;
	/** How many actions are planned: one (a deployment or a move), or none. */
	count: Readable<number>;
	/** The planned move, if the plan is one. */
	move: Readable<Move | undefined>;
	/** Pick a spawn point to deploy at, or drop it if it is the one picked. */
	choose(spawnPoint: bigint): void;
	/** A click on `square` of the board, for a deployed army. */
	click(square: bigint): void;
	clear(): void;
};

export function createPlanning(params: {
	submission: SubmissionStore<GameIdentity, Move>;
	/**
	 * Whether the army this client plays still has to be deployed. Its plan is
	 * then a deployment, and nothing else can be planned.
	 */
	needsDeployment: Readable<boolean>;
	/** Whether the army this client plays stands on the board, so may move. */
	canMove: Readable<boolean>;
	/** The army the plan is for: the deployment's preview, the pieces' owner. */
	army: Readable<GameIdentity | undefined>;
	/** The board as the chain resolves it for the cycle in progress. */
	board: Readable<OnchainStateValue<BoardState>>;
	/** `legalMoves`, the contract's rule, run in the sandbox. */
	legalMoves: (pieces: readonly Piece[], from: bigint) => Promise<bigint[]>;
}): PlanningStore {
	const {submission, needsDeployment, canMove, army, board} = params;

	const planned = derived(submission, plannedActionsOf);
	const plannedSpawnPoint = derived(planned, ($p) => spawnPointOf($p));
	const plannedMove = derived(planned, ($p) => moveOf($p));

	/** The piece clicked, until a destination is picked or it is let go. */
	const selected = writable<bigint | undefined>(undefined);
	/**
	 * The king or stone whose stake is shown, until the next click elsewhere
	 * (or on it again). Any army's: what a player judges a target by.
	 */
	const inspected = writable<bigint | undefined>(undefined);

	const highlightInput = derived(
		[selected, board],
		([$selected, $board]): HighlightInput | undefined => {
			if ($selected === undefined || $board.step !== 'Loaded') return undefined;
			const pieces = piecesAround($board.pieces, $selected);
			return {from: $selected, pieces, key: keyOf($selected, pieces)};
		},
	);
	const highlights = latestResult(
		highlightInput,
		({from, pieces}) => params.legalMoves(pieces, from),
		{equal: (a, b) => a.key === b.key},
	);
	const destinations = derived(
		[highlights, selected],
		([$h, $selected]): readonly bigint[] =>
			$h.step === 'Ready' && $h.input.from === $selected ? $h.result : [],
	);

	const plan = derived(
		[plannedSpawnPoint, plannedMove, army, selected, destinations, inspected],
		([
			$spawn,
			$move,
			$army,
			$selected,
			$destinations,
			$inspected,
		]): LocalPlan => ({
			...($inspected !== undefined ? {inspected: $inspected} : {}),
			...($spawn !== undefined ? {spawnPoint: $spawn} : {}),
			...($move !== undefined ? {move: $move} : {}),
			...($army !== undefined ? {army: $army} : {}),
			...($selected !== undefined
				? {selected: $selected, destinations: $destinations}
				: {}),
		}),
	);

	const actions = derived(
		[plannedSpawnPoint, plannedMove],
		([$spawn, $move]): readonly Move[] =>
			$spawn !== undefined ? deploymentAt($spawn) : $move ? [$move] : [],
	);

	// AND ONLY ONCE THE SUBMISSION CAN TAKE A PLAN: after an account switch the
	// new account's data loads, and a click then would change nothing.
	const canPlan = derived(
		[submission, submission.ready, needsDeployment, canMove],
		([$submission, $ready, $needs, $canMove]) =>
			$ready && ($needs || $canMove) && isPlannable($submission),
	);

	const count = derived(actions, ($actions) => $actions.length);

	function choose(spawnPoint: bigint) {
		if (!get(canPlan) || !get(needsDeployment)) return;
		// A second click on the one picked takes it back off.
		if (spawnPointOf(plannedActionsOf(submission.value)) === spawnPoint) {
			submission.plan([]);
			return;
		}
		submission.plan(deploymentAt(spawnPoint));
	}

	function click(square: bigint) {
		if (get(needsDeployment)) return;
		const $board = get(board);
		if ($board.step !== 'Loaded') return;
		// Showing a stake changes no plan, so it works whatever the phase.
		const holdsStake = isStakeHolder($board.pieces.get(square)?.kind);
		inspected.set(holdsStake && get(inspected) !== square ? square : undefined);
		if (!get(canPlan)) return;
		const outcome = boardClick({
			square,
			pieces: $board.pieces,
			you: get(army),
			selected: get(selected),
			destinations: get(destinations),
		});
		if (outcome.kind === 'select') {
			selected.set(outcome.square);
			return;
		}
		selected.set(undefined);
		if (outcome.kind === 'move') {
			// One move per army per cycle: a new one replaces the one planned, and
			// picking the planned one again takes it back off.
			const current = moveOf(plannedActionsOf(submission.value));
			const same =
				current?.from === outcome.move.from && current?.to === outcome.move.to;
			submission.plan(same ? [] : [outcome.move]);
		}
	}

	function clear() {
		selected.set(undefined);
		inspected.set(undefined);
		if (!isPlannable(submission.value)) return;
		submission.plan([]);
	}

	return {
		plan,
		actions,
		canPlan,
		count,
		move: plannedMove,
		choose,
		click,
		clear,
	};
}
