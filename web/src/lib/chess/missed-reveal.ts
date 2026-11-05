/**
 * A commitment the player never revealed: the base's settlement, given this
 * game's action and penalty.
 *
 * What this game decides is what a missed submission costs when its chunks are
 * shown: a deployment forfeits the stake, a pass forfeits nothing
 * (`UsingGameInternal._acknowledgeMissedReveal`). Today the only submission
 * with an action in it is a deployment, so the count says which it was.
 */
import type {Readable} from 'svelte/store';
import {
	createMissedReveal as createBaseMissedReveal,
	type MissedRevealDeps,
	type MissedRevealStore,
} from '$lib/game/core/commit-reveal/missed-reveal';
import type {PersistedSubmission} from '$lib/game/core/submission';
import {onchainIdentity, type GameIdentity} from '$lib/game/identity';
import type {ChessConfig} from './config';
import {gameContract, MOVE_ENCODING, type Move} from './commit-reveal';

export {
	blocksCommitting,
	type MissedRevealDeps,
	type MissedRevealState,
	type MissedRevealStore,
} from '$lib/game/core/commit-reveal/missed-reveal';

export function createMissedReveal(params: {
	deps: MissedRevealDeps;
	config: ChessConfig;
	/** WHO PLAYS, and so whose commitment this is. */
	identity: Readable<GameIdentity | undefined>;
	committedTurn?: (
		player: GameIdentity,
		cycleNumber: number,
	) =>
		| PersistedSubmission<Move>
		| readonly PersistedSubmission<Move>[]
		| undefined;
	onSettled?: (settled: {player: GameIdentity; cycleNumber: number}) => void;
}): MissedRevealStore {
	const {deps, config} = params;
	return createBaseMissedReveal<GameIdentity, Move>({
		deps,
		contract: gameContract(deps.deployments.get()),
		encoding: MOVE_ENCODING,
		onchainIdentity,
		actionsPerReveal: config.actionsPerReveal,
		penaltyFor: (count) => (count > 0 ? config.stake : 0n),
		identity: params.identity,
		committedTurn: params.committedTurn,
		onSettled: params.onSettled,
	});
}
