/**
 * Turning clicks into a plan: picking the spawn point a deployment commits to.
 *
 * The plan itself lives in the framework's submission (it is what gets hashed,
 * and it has to survive a reload), so this keeps no second copy. It translates
 * "the player clicked near spawn point X" into the submission's actions.
 *
 * Moves are the next thing this game gains; until then the only plan a player
 * makes is a deployment, and a deployed army's submission is a pass.
 */
import {derived, get, type Readable} from 'svelte/store';
import type {SubmissionState, SubmissionStore} from '$lib/game/core/submission';
import type {GameIdentity} from '$lib/game/identity';
import {deploymentAt, spawnPointOf, type Move} from './commit-reveal';
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

function plannedSpawnPointOf(state: SubmissionState<Move>): bigint | undefined {
	if (!('actions' in state)) return undefined;
	return spawnPointOf(state.actions);
}

/**
 * How near a spawn point a click must land to pick it: anywhere on the
 * footprint an army deployed there would stand on.
 */
export const PICK_RADIUS = 3;

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

export type PlanningStore = {
	/** What the player has planned, for the view merge. */
	plan: Readable<LocalPlan>;
	/** The same, in the shape the contract is committed to. */
	actions: Readable<readonly Move[]>;
	/** Whether clicks currently change anything. */
	canPlan: Readable<boolean>;
	/** How many actions are planned: one for a deployment, or none. */
	count: Readable<number>;
	/** Pick a spawn point to deploy at, or drop it if it is the one picked. */
	choose(spawnPoint: bigint): void;
	clear(): void;
};

export function createPlanning(params: {
	submission: SubmissionStore<GameIdentity, Move>;
	/**
	 * Whether the army this client plays still has to be deployed. A plan is a
	 * deployment, so nothing can be planned for an army already on the board.
	 */
	needsDeployment: Readable<boolean>;
	/** The army the deployment is for, for the preview. */
	army: Readable<GameIdentity | undefined>;
}): PlanningStore {
	const {submission, needsDeployment, army} = params;

	const planned = derived(submission, plannedSpawnPointOf);

	const plan = derived([planned, army], ([$planned, $army]): LocalPlan => ({
		...($planned !== undefined ? {spawnPoint: $planned} : {}),
		...($army !== undefined ? {army: $army} : {}),
	}));

	const actions = derived(planned, ($planned): readonly Move[] =>
		$planned === undefined ? [] : deploymentAt($planned),
	);

	// AND ONLY ONCE THE SUBMISSION CAN TAKE A PLAN: after an account switch the
	// new account's data loads, and a click then would change nothing.
	const canPlan = derived(
		[submission, submission.ready, needsDeployment],
		([$submission, $ready, $needs]) =>
			$ready && $needs && isPlannable($submission),
	);

	const count = derived(planned, ($planned) =>
		$planned === undefined ? 0 : 1,
	);

	function choose(spawnPoint: bigint) {
		if (!get(canPlan)) return;
		// A second click on the one picked takes it back off.
		if (plannedSpawnPointOf(submission.value) === spawnPoint) {
			submission.plan([]);
			return;
		}
		submission.plan(deploymentAt(spawnPoint));
	}

	function clear() {
		if (!isPlannable(submission.value)) return;
		submission.plan([]);
	}

	return {plan, actions, canPlan, count, choose, clear};
}
