/**
 * Keeping the player's own deployment or move (its piece-moves) on screen
 * until the board takes it over.
 *
 * The framework decides WHEN (`game/core/handover.ts`); this is what a
 * remembered submission LOOKS like here. The submission drops its actions the
 * moment it reaches `Revealed`, while the army only stands on the board once the
 * cycle is over, so without this the planned army would vanish for the rest of
 * the reveal phase. FOR DISPLAY ONLY: everything that acts on a turn keeps
 * reading the submission.
 */
import {derived, type Readable} from 'svelte/store';
import type {SubmissionState} from '$lib/game/core/submission';
import {heldTurnUntilBoardReleases} from '$lib/game/core/handover';
import {pieceMovesOf, spawnPointOf, type Move} from './commit-reveal';
import type {LocalPlan} from './view';

export function holdPlanUntilBoardReleases(params: {
	submission: Readable<SubmissionState<Move>>;
	plan: Readable<LocalPlan>;
	holding: Readable<number | undefined>;
}): Readable<LocalPlan> {
	const held = heldTurnUntilBoardReleases({
		submission: params.submission,
		holding: params.holding,
	});
	return derived([params.plan, held], ([$plan, $held]): LocalPlan => {
		if ($held === undefined) return $plan;
		const spawnPoint = spawnPointOf($held);
		// A held move keeps its marks until the board shows it landed; a held
		// pass draws nothing; a held deployment keeps its ghost while the
		// preview for it is still the one in hand.
		const moves = pieceMovesOf($held);
		if (moves.length > 0) return {...$plan, moves, preview: undefined};
		if (spawnPoint === undefined) return {...$plan, preview: undefined};
		return {
			...$plan,
			spawnPoint,
			...($plan.spawnPoint === spawnPoint ? {} : {preview: undefined}),
		};
	});
}
