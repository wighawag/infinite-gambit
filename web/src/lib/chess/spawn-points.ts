/**
 * The open spawn points, as a player choosing one sees them: where each is, and
 * how close the nearest armies are (user story 3).
 *
 * WHICH spawn points are open is the contract's answer (`getOpenSpawnPoints`):
 * nothing here decides it. What is computed is a DISTANCE, from the registry's
 * resolved king positions, which is presentation rather than a rule: it changes
 * nothing anyone may do.
 */
import {ARMY_STATUS, type ArmyView} from './armies';
import {kingDistance, positionOf, type Position} from './squares';

export type SpawnPointView = {
	spawnPoint: bigint;
	position: Position;
	/**
	 * How far, in king steps, the nearest deployed armies' kings are, nearest
	 * first; empty when the board has no army yet.
	 */
	nearest: readonly number[];
};

/** How many of the nearest armies are reported per spawn point. */
export const NEAREST_COUNT = 3;

export function describeSpawnPoints(params: {
	spawnPoints: readonly bigint[];
	armies: readonly ArmyView[];
	count?: number;
}): SpawnPointView[] {
	const count = params.count ?? NEAREST_COUNT;
	const kings = params.armies
		// A frozen army stands on the board with its stake, like any other.
		.filter(
			(army) =>
				army.status === ARMY_STATUS.Deployed ||
				army.status === ARMY_STATUS.Frozen,
		)
		.map((army) => positionOf(army.king));
	return params.spawnPoints.map((spawnPoint) => {
		const position = positionOf(spawnPoint);
		const nearest = kings
			.map((king) => kingDistance(position, king))
			.sort((a, b) => a - b)
			.slice(0, count);
		return {spawnPoint, position, nearest};
	});
}

/** The words for a spawn point's neighbours, for the HUD. */
export function nearestLabel(nearest: readonly number[]): string {
	if (nearest.length === 0) return 'no army on the board yet';
	return `nearest ${nearest.length === 1 ? 'army' : 'armies'}: ${nearest.join(', ')} squares`;
}
