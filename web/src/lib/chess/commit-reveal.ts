/**
 * This game's `CommitRevealAdapter`: the base's client, given this game's
 * action.
 *
 * The framework's submission decides WHEN these are called and keeps the secret
 * between the two; the translation into the base's calls is the framework's
 * too (`$lib/game/core/commit-reveal/`). What is left here is this game's part:
 * what a move is to the contract, which contract, and what to bond.
 */
import {get} from 'svelte/store';
import type {TypedDeployments} from '$lib/core/connection/types';
import type {CommitRevealAdapter} from '$lib/game/core/seams';
import {
	buildChainedCommitment,
	buildCommitmentChain,
	type CommitmentChunk,
} from '$lib/game/core/commit-reveal/chain';
import type {
	ActionEncoding,
	CommitRevealContract,
} from '$lib/game/core/commit-reveal/contract';
import {createCommitRevealContractAdapter} from '$lib/game/core/commit-reveal/adapter';
import type {MoveDeps} from '$lib/game/core/commit-reveal/send';
import {onchainIdentity, type GameIdentity} from '$lib/game/identity';
import type {ChessConfig} from './config';

/**
 * One move, matching the contract's `Move` struct: a piece from one square to
 * another, both packed (`./squares.ts`).
 *
 * ALSO A DEPLOYMENT. An army's first submission is its deployment, and it is
 * one `Move` from and to the chosen spawn point (see `UsingGameTypes.Move`).
 */
export type Move = {from: bigint; to: bigint};

/**
 * A move, to the contract: the components of `Move` in `reveal`.
 *
 * It must match `UsingGameInternal._digest` exactly - same types, same order.
 * A mismatch is not a compile error and not a failed read: the commit
 * succeeds, and the reveal reverts with `CommitmentHashNotMatching` once the
 * stake is already bonded. `contracts/test/js/utils` computes the hash the
 * same way from the other side.
 */
export const MOVE_ENCODING: ActionEncoding = {
	components: [
		{name: 'from', type: 'uint64'},
		{name: 'to', type: 'uint64'},
	],
};

/** The submission that deploys an army at `spawnPoint`. */
export function deploymentAt(spawnPoint: bigint): Move[] {
	return [{from: spawnPoint, to: spawnPoint}];
}

/** The spawn point a submission deploys at, if it is a deployment. */
export function spawnPointOf(actions: readonly Move[]): bigint | undefined {
	if (actions.length !== 1) return undefined;
	const [move] = actions;
	return move.from === move.to ? move.to : undefined;
}

/**
 * The piece-moves a submission makes: every `Move` of it, unless it is a
 * deployment, which moves nothing. Empty for a pass. A move is up to three
 * piece-moves (`docs/adr/0016`); how many the contract accepts is its own
 * rule, judged by the whole-move route, never here.
 */
export function pieceMovesOf(actions: readonly Move[]): readonly Move[] {
	return spawnPointOf(actions) !== undefined ? [] : actions;
}

/**
 * The move a submission makes, if it is ONE piece-move: a single `Move` whose
 * `from` and `to` differ. A deployment is not a move. See {@link pieceMovesOf}
 * for a move of several.
 */
export function moveOf(actions: readonly Move[]): Move | undefined {
	if (actions.length !== 1) return undefined;
	const [move] = actions;
	return move.from !== move.to ? move : undefined;
}

/**
 * What a submission bonds: the stake for a deployment, nothing for anything
 * else. The deployment's commit moves the stake into the new army's reserve
 * and bonds it there, so a deployment that is never revealed has its stake to
 * lose (`docs/adr/0005-missed-reveal-freezes-the-army.md`). A pass bonds
 * nothing: what a missed reveal costs a deployed army is the freeze.
 */
export function bondFor(config: ChessConfig, actions: readonly Move[]): bigint {
	return spawnPointOf(actions) !== undefined ? config.stake : 0n;
}

/** One reveal transaction's worth of a submission. */
export type MoveChunk = CommitmentChunk<Move>;

/** The game contract, which inherits the commit-reveal base. */
export function gameContract(
	deployments: TypedDeployments,
): CommitRevealContract {
	return deployments.contracts.Game;
}

/** The hash chain a submission is committed as. */
export function buildMoveChain(params: {
	actions: readonly Move[];
	secret: `0x${string}`;
	actionsPerReveal: number;
}): MoveChunk[] {
	return buildCommitmentChain({...params, encoding: MOVE_ENCODING});
}

/** The commitment for a whole submission: the head of its chain. */
export function buildMoveCommitment(params: {
	actions: readonly Move[];
	secret: `0x${string}`;
	actionsPerReveal: number;
}): {hash: `0x${string}`; encoded: `0x${string}`} {
	return buildChainedCommitment({...params, encoding: MOVE_ENCODING});
}

/**
 * What the adapter needs: the SIGNER executor, so a submission never prompts.
 */
export type CommitRevealDeps = MoveDeps;

export function createChessCommitReveal(params: {
	deps: CommitRevealDeps;
	config: ChessConfig;
	/** See `beforeCommit` in `$lib/game/core/commit-reveal/adapter`. */
	beforeCommit?: () => Promise<void>;
	/** See {@link refusingIllegalMoves}. */
	refuse?: (actions: readonly Move[]) => Promise<string | undefined>;
}): CommitRevealAdapter<GameIdentity, Move> {
	const {deps, config} = params;
	const adapter = createCommitRevealContractAdapter<GameIdentity, Move>({
		deps,
		// Deployments are fixed for the life of the app.
		contract: gameContract(get(deps.deployments)),
		encoding: MOVE_ENCODING,
		onchainIdentity,
		actionsPerReveal: config.actionsPerReveal,
		gas: config.gas,
		revealPhaseDuration: config.cycle.revealPhaseDuration,
		// THE STAKE FOR A DEPLOYMENT, not the reserve's cap: the army being
		// committed for has no reserve until this very commit funds it, which is
		// why the reserve the adapter read beforehand (zero) is not the cap here.
		bondFor: (actions) => bondFor(config, actions),
		beforeCommit: params.beforeCommit,
	});
	return params.refuse ? refusingIllegalMoves(adapter, params.refuse) : adapter;
}

/**
 * The adapter, refusing to commit a move `refuse` names a reason against.
 *
 * WHY AT THE COMMIT and not only on the Commit button: the submission also
 * commits BY ITSELF when the player leaves it late, and a move the reveal
 * judges illegal reverts it (`IllegalMove`), which is a missed reveal and a
 * frozen army (`docs/adr/0005`). Refused here, the worst it costs is a cycle
 * without that move. The reason is thrown, so the submission's Error state
 * carries it to the player, as the framework's own `beforeCommit` does.
 */
export function refusingIllegalMoves(
	adapter: CommitRevealAdapter<GameIdentity, Move>,
	refuse: (actions: readonly Move[]) => Promise<string | undefined>,
): CommitRevealAdapter<GameIdentity, Move> {
	return {
		...adapter,
		async commit(args) {
			const reason = await refuse(args.actions);
			if (reason !== undefined) throw new Error(reason);
			return adapter.commit(args);
		},
	};
}
