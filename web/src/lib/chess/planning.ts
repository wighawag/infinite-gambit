/**
 * Turning clicks into a plan: the spawn point a deployment commits to, or the
 * move a deployed army makes this cycle, which is up to three piece-moves,
 * each by a different piece (one at a table that turns three off,
 * `docs/adr/0016-an-army-moves-up-to-three-pieces-a-cycle-simultaneously.md`).
 *
 * The plan itself lives in the framework's submission (it is what gets hashed,
 * and it has to survive a reload), so this keeps no second copy of it. What it
 * keeps is the SELECTION, which is not part of any plan: the piece the player
 * clicked, whose legal destinations are highlighted until they pick one.
 *
 * Which destinations are legal, and whether a whole move is, is the CONTRACT's
 * rule, run from the Simulation route's own bytecode in the sandbox (the
 * whole-move route, `./piece-moves.ts`: `legalMovesAlongside` and
 * `isLegalWholeMove`, at the cap the game reports), never a TypeScript copy
 * of it (`docs/adr/0007-rules-live-only-in-the-contract.md`). This file keeps
 * no rule of its own: not the cap, not "two to one square", not "one piece
 * twice", not "own movers count as gone". It only asks, and draws nothing
 * from the answers but the squares and verdicts they name.
 */
import {derived, get, writable, type Readable} from 'svelte/store';
import type {SubmissionState, SubmissionStore} from '$lib/game/core/submission';
import type {OnchainStateValue} from '$lib/game/core/seams';
import type {GameIdentity} from '$lib/game/identity';
import {latestResult} from '$lib/game/simulation';
import {PIECE_KIND, type BoardState, type Piece, type PieceKind} from './board';
import {
	deploymentAt,
	pieceMovesOf,
	spawnPointOf,
	type Move,
} from './commit-reveal';
import {
	wholeMoveRoute,
	type WholeMoveCall,
	type WholeMoveRoute,
} from './piece-moves';
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
 * The pieces within {@link MOVE_REACH} of `from` (or of any of several
 * squares): what the route is handed, so the sandbox is asked about the
 * neighbourhood of the piece-moves rather than the whole view.
 */
export function piecesAround(
	pieces: ReadonlyMap<bigint, Piece>,
	from: bigint | readonly bigint[],
): Piece[] {
	const centres = (typeof from === 'bigint' ? [from] : from).map(positionOf);
	const around: Piece[] = [];
	for (const piece of pieces.values()) {
		const at = positionOf(piece.position);
		if (centres.some((centre) => kingDistance(centre, at) <= MOVE_REACH)) {
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

/** A square's coordinates, as a player reads them. */
function squareLabel(square: bigint): string {
	const {x, y} = positionOf(square);
	return `(${x}, ${y})`;
}

/** A piece-move, as a player reads it: `(0, 0) to (1, 0)`. */
export function pieceMoveLabel(move: Move): string {
	return `${squareLabel(move.from)} to ${squareLabel(move.to)}`;
}

/**
 * The piece-moves a piece's destinations are judged alongside: every planned
 * one but its own. With a cap of one there is no "alongside", the new
 * piece-move REPLACES the planned one, as a move always did before
 * `docs/adr/0016`, so none.
 */
export function othersThan(
	moves: readonly Move[],
	from: bigint,
	maxPieceMoves: number,
): Move[] {
	return maxPieceMoves <= 1 ? [] : moves.filter((move) => move.from !== from);
}

/**
 * The move once a piece-move of the piece on `move.from` is picked: on the
 * square it is already planned to, it is taken back; otherwise it replaces
 * that piece's planned piece-move where it stands in the list, or joins the
 * end. With a cap of one it replaces whatever is planned. Whether the result
 * is legal is the route's to say, and the destinations offered came from it.
 */
export function withPieceMove(
	moves: readonly Move[],
	move: Move,
	maxPieceMoves: number,
): Move[] {
	const own = moves.find((planned) => planned.from === move.from);
	if (own?.to === move.to) return moves.filter((m) => m !== own);
	if (maxPieceMoves <= 1) return [move];
	return own
		? moves.map((planned) => (planned === own ? move : planned))
		: [...moves, move];
}

/**
 * Why the contract would refuse `moves` for `army`, or undefined when it
 * accepts them (a pass always is).
 *
 * THE VERDICT IS THE ROUTE'S (`isLegalWholeMove`). When it refuses, the reason
 * names the piece-moves it is about, again by asking the route: a piece-move
 * whose destination `legalMovesAlongside` no longer offers it alongside the
 * others. Nothing here knows WHY, so the words say what to do, not which rule.
 */
export async function refusalOf(params: {
	route: Pick<WholeMoveRoute, 'isLegal' | 'alongside'>;
	pieces: ReadonlyMap<bigint, Piece>;
	army: bigint;
	moves: readonly Move[];
}): Promise<string | undefined> {
	const {route, pieces, army, moves} = params;
	if (moves.length === 0) return undefined;
	const around = piecesAround(
		pieces,
		moves.map((move) => move.from),
	);
	if (await route.isLegal(around, army, moves)) return undefined;
	const culprits: Move[] = [];
	for (const move of moves) {
		const others = moves.filter((other) => other !== move);
		const offered = await route.alongside(around, move.from, others);
		if (!offered.includes(move.to)) culprits.push(move);
	}
	if (culprits.length === 0) {
		return 'The contract refuses this move. Take a piece-move back.';
	}
	const named = culprits.map(pieceMoveLabel).join(', ');
	return culprits.length === 1
		? `The contract refuses ${named} alongside the rest of the move. Take it back or change it.`
		: `The contract refuses ${named} alongside the rest of the move. Take them back or change them.`;
}

/**
 * The check a commit runs (`refusingIllegalMoves` in `./commit-reveal.ts`):
 * the reason the contract would refuse a submission's piece-moves on the
 * board as it is now, or undefined. A deployment and a pass are never
 * refused here. When the check cannot be made it REFUSES, saying so: an
 * illegal move committed is a reveal that reverts and an army that freezes,
 * while a refused commit costs a cycle at worst.
 */
export function createWholeMoveGuard(params: {
	board: () => OnchainStateValue<BoardState>;
	army: () => bigint | undefined;
	maxPieceMoves: () => Promise<number>;
	call: WholeMoveCall;
}): (actions: readonly Move[]) => Promise<string | undefined> {
	return async (actions) => {
		const moves = pieceMovesOf(actions);
		if (moves.length === 0) return undefined;
		const board = params.board();
		const army = params.army();
		if (board.step !== 'Loaded' || army === undefined) {
			return 'The board has not loaded yet, so this move cannot be checked. Try again in a moment.';
		}
		try {
			const route = wholeMoveRoute({
				call: params.call,
				maxPieceMoves: await params.maxPieceMoves(),
			});
			return await refusalOf({route, pieces: board.pieces, army, moves});
		} catch (error) {
			return `Could not ask the contract whether this move is legal, so it was not committed: ${error instanceof Error ? error.message : String(error)}`;
		}
	};
}

type HighlightInput = {
	from: bigint;
	pieces: Piece[];
	others: Move[];
	maxPieceMoves: number;
	key: string;
};

type VerdictInput = {
	pieces: ReadonlyMap<bigint, Piece>;
	army: bigint;
	moves: readonly Move[];
	maxPieceMoves: number;
	key: string;
};

const keyOf = (from: bigint, pieces: readonly Piece[]) =>
	`${from}|${pieces.map((p) => `${p.position}:${p.army}:${p.kind}`).join(',')}`;

const movesKey = (moves: readonly Move[]) =>
	moves.map((m) => `${m.from}>${m.to}`).join(',');

/**
 * Where the selected piece may go, as far as the client knows: nothing
 * selected, the route still answering, its answer (possibly none), or why it
 * could not answer. A failure is NOT "nowhere to go": the two used to look the
 * same, a selected piece with no squares, which hid every failure of the
 * sandbox behind what reads as a rule.
 */
export type DestinationsLookup =
	| {step: 'Idle'}
	| {step: 'Pending'}
	| {step: 'Ready'; count: number}
	| {step: 'Failed'; reason: string};

/** An error, as one short line a player can quote back. */
export function lookupFailureReason(error: unknown): string {
	const text =
		error && typeof error === 'object' && 'shortMessage' in error
			? String((error as {shortMessage: unknown}).shortMessage)
			: error instanceof Error
				? error.message
				: String(error);
	const line = text.split('\n')[0].trim() || 'unknown error';
	return line.length > 160 ? `${line.slice(0, 157)}...` : line;
}

export type PlanningStore = {
	/** What the player has planned, for the view merge. */
	plan: Readable<LocalPlan>;
	/** The same, in the shape the contract is committed to. */
	actions: Readable<readonly Move[]>;
	/** Whether clicks currently change anything. */
	canPlan: Readable<boolean>;
	/** How many actions are planned: the deployment, the piece-moves, or none. */
	count: Readable<number>;
	/** The planned piece-moves, in the order they were picked. */
	pieceMoves: Readable<readonly Move[]>;
	/** The cap the game reports (3, or 1 at a table); undefined until read. */
	maxPieceMoves: Readable<number | undefined>;
	/**
	 * Why the contract would refuse the planned move, once the route has
	 * answered; undefined while it accepts it, or has not answered yet.
	 */
	refusal: Readable<string | undefined>;
	/** Where the selected piece may go, or why that is not known. */
	destinationsLookup: Readable<DestinationsLookup>;
	/** Pick a spawn point to deploy at, or drop it if it is the one picked. */
	choose(spawnPoint: bigint): void;
	/** A click on `square` of the board, for a deployed army. */
	click(square: bigint): void;
	/** Take back the planned piece-move of the piece on `from`. */
	takeBack(from: bigint): void;
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
	/**
	 * The game's cap (`getMaxPieceMoves`, `./piece-moves.ts`), undefined until
	 * it is read. Nothing is offered before it is.
	 */
	maxPieceMoves: Readable<number | undefined>;
	/** The whole-move route, the contract's rule, run in the sandbox. */
	wholeMove: WholeMoveCall;
}): PlanningStore {
	const {submission, needsDeployment, canMove, army, board, maxPieceMoves} =
		params;

	const planned = derived(submission, plannedActionsOf);
	const plannedSpawnPoint = derived(planned, ($p) => spawnPointOf($p));
	const pieceMoves = derived(planned, ($p) => pieceMovesOf($p));

	/** The piece clicked, until a destination is picked or it is let go. */
	const selected = writable<bigint | undefined>(undefined);
	/**
	 * The king or stone whose stake is shown, until the next click elsewhere
	 * (or on it again). Any army's: what a player judges a target by.
	 */
	const inspected = writable<bigint | undefined>(undefined);

	const highlightInput = derived(
		[selected, board, pieceMoves, maxPieceMoves],
		([$selected, $board, $moves, $cap]): HighlightInput | undefined => {
			if ($selected === undefined || $board.step !== 'Loaded') return undefined;
			if ($cap === undefined) return undefined;
			const others = othersThan($moves, $selected, $cap);
			const pieces = piecesAround($board.pieces, [
				$selected,
				...others.map((move) => move.from),
			]);
			return {
				from: $selected,
				pieces,
				others,
				maxPieceMoves: $cap,
				key: `${keyOf($selected, pieces)}|${movesKey(others)}|${$cap}`,
			};
		},
	);
	const highlights = latestResult(
		highlightInput,
		({from, pieces, others, maxPieceMoves: cap}) =>
			wholeMoveRoute({call: params.wholeMove, maxPieceMoves: cap}).alongside(
				pieces,
				from,
				others,
			),
		{equal: (a, b) => a.key === b.key},
	);
	const destinations = derived(
		[highlights, selected],
		([$h, $selected]): readonly bigint[] =>
			$h.step === 'Ready' && $h.input.from === $selected ? $h.result : [],
	);

	// WHAT THE PLAYER IS TOLD about the selected piece. A selection whose input
	// cannot be built yet (the board or the cap still loading) is pending too:
	// from where the player sits, the answer is on its way.
	let lastLogged: unknown;
	const destinationsLookup = derived(
		[selected, highlights],
		([$selected, $h]): DestinationsLookup => {
			if ($selected === undefined) return {step: 'Idle'};
			if ($h.step === 'Ready' && $h.input.from === $selected) {
				return {step: 'Ready', count: $h.result.length};
			}
			if ($h.step === 'Failed' && $h.input.from === $selected) {
				if (lastLogged !== $h.error) {
					lastLogged = $h.error;
					console.error('legalMovesAlongside failed', $h.error);
				}
				return {step: 'Failed', reason: lookupFailureReason($h.error)};
			}
			return {step: 'Pending'};
		},
	);

	// THE WHOLE MOVE, JUDGED AS THE REVEAL WILL JUDGE IT: each piece-move was
	// offered alongside the others, but taking one back, or the board changing
	// under the plan, can leave the rest illegal.
	const verdictInput = derived(
		[pieceMoves, board, army, maxPieceMoves],
		([$moves, $board, $army, $cap]): VerdictInput | undefined => {
			if ($moves.length === 0 || $board.step !== 'Loaded') return undefined;
			if ($army === undefined || $cap === undefined) return undefined;
			const pieces = piecesAround(
				$board.pieces,
				$moves.map((move) => move.from),
			);
			return {
				pieces: $board.pieces,
				army: $army,
				moves: $moves,
				maxPieceMoves: $cap,
				key: `${keyOf($army, pieces)}|${movesKey($moves)}|${$cap}`,
			};
		},
	);
	const verdict = latestResult(
		verdictInput,
		({pieces, army: $army, moves, maxPieceMoves: cap}) =>
			refusalOf({
				route: wholeMoveRoute({call: params.wholeMove, maxPieceMoves: cap}),
				pieces,
				army: $army,
				moves,
			}),
		{equal: (a, b) => a.key === b.key},
	);
	const refusal = derived(verdict, ($v) =>
		$v.step === 'Ready' ? $v.result : undefined,
	);

	const plan = derived(
		[plannedSpawnPoint, pieceMoves, army, selected, destinations, inspected],
		([
			$spawn,
			$moves,
			$army,
			$selected,
			$destinations,
			$inspected,
		]): LocalPlan => ({
			...($inspected !== undefined ? {inspected: $inspected} : {}),
			...($spawn !== undefined ? {spawnPoint: $spawn} : {}),
			...($moves.length > 0 ? {moves: $moves} : {}),
			...($army !== undefined ? {army: $army} : {}),
			...($selected !== undefined
				? {selected: $selected, destinations: $destinations}
				: {}),
		}),
	);

	const actions = derived(
		[plannedSpawnPoint, pieceMoves],
		([$spawn, $moves]): readonly Move[] =>
			$spawn !== undefined ? deploymentAt($spawn) : $moves,
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
		const cap = get(maxPieceMoves);
		if (outcome.kind === 'move' && cap !== undefined) {
			const current = pieceMovesOf(plannedActionsOf(submission.value));
			submission.plan(withPieceMove(current, outcome.move, cap));
		}
	}

	function takeBack(from: bigint) {
		if (!get(canPlan) || get(needsDeployment)) return;
		const current = pieceMovesOf(plannedActionsOf(submission.value));
		if (!current.some((move) => move.from === from)) return;
		if (get(selected) === from) selected.set(undefined);
		submission.plan(current.filter((move) => move.from !== from));
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
		pieceMoves,
		maxPieceMoves,
		refusal,
		destinationsLookup,
		choose,
		click,
		takeBack,
		clear,
	};
}
