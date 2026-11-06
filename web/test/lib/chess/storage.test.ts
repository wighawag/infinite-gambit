import {describe, it, expect, vi} from 'vitest';
import {get} from 'svelte/store';
import {createAccountData} from '$lib/account/AccountData';
import {SUBMISSION_FIELDS} from '$lib/game/core/commit-reveal/storage';
import type {PersistedSubmission} from '$lib/game/core/submission';
import {createSubmissionStorage, MOVE_STORAGE} from '$lib/chess/storage';
import type {Move} from '$lib/chess/commit-reveal';
import {squareAt} from '$lib/chess/squares';
import {
	ALICE,
	SCOPE,
	accountStore,
	controlledStorage,
	deployments,
} from '../account/account-data-harness';

/**
 * A MOVE OF THREE PIECE-MOVES IS STORED AS ONE WAS (`docs/adr/0016`): the
 * framework's record already holds a list of actions, and `MOVE_STORAGE`
 * writes each piece-move as it always wrote a move. The record is a WIRE
 * (AGENTS.md, "Renaming a persisted key or field..."): a reload must read what
 * the previous build wrote, or the secret that opens a commitment is gone and
 * the army freezes. So this pins the key and every field, literally.
 */

const GAME = '0x00000000000000000000000000000000000000c0' as const;
const ARMY = 7n << 160n;
const SECRET =
	'0x00000000000000000000000000000000000000000000000000000000000000aa' as const;

function device(storage: ReturnType<typeof controlledStorage>) {
	const accountData = createAccountData({
		accountStore: accountStore(ALICE),
		deployments,
		clock: {now: () => 1000} as never,
		scopeAddress: SCOPE,
		storageAdapter: storage.adapter,
		fields: SUBMISSION_FIELDS,
	});
	const stop = accountData.subscribe(() => {});
	const submissions = createSubmissionStorage({
		accountData,
		chainId: 1,
		contract: GAME,
		player: ARMY,
	});
	return {accountData, submissions, stop};
}

describe('a three-piece-move submission, in the account data', () => {
	const moves: Move[] = [
		{from: squareAt(0, 0), to: squareAt(1, 0)},
		{from: squareAt(-1, 0), to: squareAt(0, 0)},
		{from: squareAt(0, 1), to: squareAt(2, 2)},
	];
	const turn: PersistedSubmission<Move> = {
		cycleNumber: 4,
		actions: moves,
		secret: SECRET,
		committed: true,
		commitmentHash: `0x${'ab'.repeat(24)}`,
	};

	it('is written under the same key and fields as a one-piece-move one, and read back after a reload', async () => {
		const storage = controlledStorage();
		const first = device(storage);
		try {
			await vi.waitFor(() => expect(get(first.submissions.ready)).toBe(true));
			await first.submissions.saveDurably(turn);
			expect(first.submissions.load()).toEqual(turn);

			// THE WIRE, literally: the key is chain, contract and army id, and
			// every piece-move is `{from, to}` in decimal strings.
			const record = first.accountData.read()!.submissions[`1_${GAME}_${ARMY}`];
			expect(record.turn!.actions).toEqual(
				moves.map((move) => ({
					from: move.from.toString(),
					to: move.to.toString(),
				})),
			);
			expect(record.turn!.actions).toEqual(moves.map(MOVE_STORAGE.encode));
		} finally {
			first.stop();
		}

		// Another load of the page, from what was saved.
		const second = device(storage);
		try {
			await vi.waitFor(() => expect(get(second.submissions.ready)).toBe(true));
			expect(second.submissions.load()).toEqual(turn);
			expect(second.submissions.committedTurns(4)).toEqual([turn]);
		} finally {
			second.stop();
		}
	});
});
