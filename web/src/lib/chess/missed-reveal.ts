/**
 * A commitment the player never revealed: the base's settlement, given this
 * game's action and penalty.
 *
 * What this game decides is what a missed submission costs when its chunks are
 * shown: a deployment forfeits the stake, a move or a pass forfeits nothing
 * here (`UsingGameInternal._acknowledgeMissedReveal`; what a missed move costs
 * is the freeze, `docs/adr/0005-missed-reveal-freezes-the-army.md`).
 *
 * The base only says how many actions were missed, and a deployment and a
 * move are both one, so the count cannot tell them apart. The BOND can: the
 * base caps the penalty at it, a deployment bonds the stake and everything
 * else bonds nothing (`./commit-reveal.ts`, `bondFor`). So the penalty is the
 * stake, and the cap makes it the stake for a deployment and zero for the
 * rest, which is what the contract charges.
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

/**
 * What settling a missed reveal WITH its chunks forfeits, before the base
 * caps it at the bond: the stake. See the file comment for why the bond, not
 * the count, decides between a deployment and a move.
 */
export function missedRevealPenalty(
	config: Pick<ChessConfig, 'stake'>,
): bigint {
	return config.stake;
}

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
		penaltyFor: () => missedRevealPenalty(config),
		identity: params.identity,
		committedTurn: params.committedTurn,
		onSettled: params.onSettled,
	});
}
