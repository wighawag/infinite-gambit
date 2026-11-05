import {describe, it, expect} from 'vitest';
import {
	awaitDeploymentsOf,
	awaitedDeployersOn,
	countStillToDeploy,
	firstArmyOf,
	withAwaitedDeployments,
} from '$lib/chess/awaited-deployments';
import {advancePermitted} from '$lib/game/core/advance';

/**
 * A world that seats everyone before the first cycle waits for every seat to
 * deploy: only armies are members, so otherwise the first to deploy would
 * close the commit phase on the rest.
 */

const ALICE = '0x1111111111111111111111111111111111111111' as const;
const BOB = '0x2222222222222222222222222222222222222222' as const;

describe('waiting for every seat to deploy', () => {
	it('counts a seat with no army as a member still to commit', () => {
		const attendance = {waitedFor: 1, committed: 1, revealed: 0};
		expect(
			advancePermitted({policy: 'manual', isCommitPhase: true, attendance})
				.permitted,
		).toBe(true);
		const waiting = withAwaitedDeployments(attendance, 1);
		expect(waiting).toEqual({waitedFor: 2, committed: 1, revealed: 0});
		expect(
			advancePermitted({
				policy: 'manual',
				isCommitPhase: true,
				attendance: waiting,
			}).permitted,
		).toBe(false);
		expect(withAwaitedDeployments(attendance, 0)).toBe(attendance);
	});

	it('stops counting a seat once it has created an army', async () => {
		const next = new Map<`0x${string}`, bigint>([
			[ALICE, firstArmyOf(ALICE)],
			[BOB, (2n << 160n) | BigInt(BOB)],
		]);
		expect(
			await countStillToDeploy({
				accounts: [ALICE, BOB],
				nextArmyOf: async (owner) => next.get(owner)!,
			}),
		).toBe(1);
	});

	it('is kept per chain, and undone by the world that set it', () => {
		const undo = awaitDeploymentsOf(5, [ALICE]);
		expect(awaitedDeployersOn(5)).toEqual([ALICE]);
		expect(awaitedDeployersOn(6)).toEqual([]);
		undo();
		expect(awaitedDeployersOn(5)).toEqual([]);
	});
});
