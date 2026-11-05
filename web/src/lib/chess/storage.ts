/**
 * Where this game's pending submission is kept between page loads.
 *
 * The storage is the base's client's (`$lib/game/core/commit-reveal/storage`),
 * in the ACCOUNT DATA: the plan and every committed turn, synced and encrypted
 * wherever the account data is. What is this game's is the FORMAT below: how
 * one move is written. Its KEY is the base's, scoped by chain, contract and
 * identity, and the identity here is an ARMY id (`$lib/game/identity`), so no
 * record written by the template's game (keyed by an account) can ever be read
 * as one of these.
 *
 * THE FORMAT IS A WIRE, and changing it is a decision rather than a tidy-up
 * (`AGENTS.md`, "Commit-reveal rules"). Once this game has users, changing how
 * a move is written means `load()` cannot read what the previous build wrote;
 * it discards the record, and with it the secret that opens a commitment in
 * flight: an army that cannot reveal FREEZES. Every suite stays green while it
 * happens, so read this before touching the format.
 *
 * Chosen at the first chess build, when nothing was deployed (checked:
 * `git ls-files contracts/deployments` is empty), so the template's placement
 * format was dropped rather than read: no record of it can be in flight.
 */
import {
	createAccountDataSubmissionStorage,
	noSubmissionStorage as baseNoSubmissionStorage,
	type AccountDataSubmissionStorage,
	type SubmissionAccountData,
	type SubmissionStorageFormat,
} from '$lib/game/core/commit-reveal/storage';
import type {SubmissionStorage} from '$lib/game/core/submission';
import type {GameIdentity} from '$lib/game/identity';
import type {Move} from './commit-reveal';

/**
 * How this game writes a move: `{from, to}`, each square as a decimal string,
 * because bigint has no JSON representation.
 */
export const MOVE_STORAGE: SubmissionStorageFormat<Move> = {
	encode: (move) => ({from: move.from.toString(), to: move.to.toString()}),
	decode: (stored) => {
		const {from, to} = stored as {from: string; to: string};
		return {from: BigInt(from), to: BigInt(to)};
	},
};

/** One army's submission, in the account data. */
export function createSubmissionStorage(params: {
	accountData: SubmissionAccountData;
	chainId: string | number;
	contract: `0x${string}`;
	player: GameIdentity;
}): AccountDataSubmissionStorage<Move> {
	return createAccountDataSubmissionStorage<Move, {}, GameIdentity>({
		accountData: params.accountData,
		format: MOVE_STORAGE,
		chainId: params.chainId,
		contract: params.contract,
		identity: params.player,
	});
}

/** A storage that keeps nothing, for SSR and for a disconnected player. */
export const noSubmissionStorage: SubmissionStorage<Move> =
	baseNoSubmissionStorage<Move>();
