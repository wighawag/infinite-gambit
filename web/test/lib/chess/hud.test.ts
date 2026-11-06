import {describe, it, expect} from 'vitest';
import {
	describeArmy,
	describeDeployment,
	describeLastDeployment,
	describeRevealDeadline,
	describeSubmission,
	REVEAL_DEADLINE_WARNING_SHARE,
} from '$lib/chess/ui/hud';
import {SignerOutOfFundsError} from '$lib/game/core/commit-reveal/errors';
import {ARMY_STATUS} from '$lib/chess/armies';
import {squareAt} from '$lib/chess/squares';

/** What the HUD says about an army and its deployment, as plain functions. */

describe('the HUD', () => {
	it('says where the army is', () => {
		expect(describeArmy(undefined)).toBeUndefined();
		expect(
			describeArmy({status: ARMY_STATUS.Deploying, stake: 10n})?.tone,
		).toBe('busy');
		expect(
			describeArmy({status: ARMY_STATUS.Deployed, stake: 10n})?.label,
		).toBe('On the board.');
		expect(describeArmy({status: ARMY_STATUS.Failed, stake: 10n})?.tone).toBe(
			'bad',
		);
		const captured = describeArmy({status: ARMY_STATUS.Captured, stake: 0n});
		expect(captured?.tone).toBe('bad');
		expect(captured?.label).toContain('king was taken');
	});

	it('says nothing of rocks or merges, and shows the total an army holds, the stakes it captured included', () => {
		const statuses = Object.values(ARMY_STATUS);
		for (const status of statuses) {
			for (const capturedBy of [0n, 5n]) {
				const army = {status, stake: 10n, capturedBy};
				const words = [
					describeArmy(army),
					describeLastDeployment({needsDeployment: true, last: army}),
				]
					.flatMap((said) => (said ? [said.label, said.stakeLabel] : []))
					.join(' ');
				expect(words).not.toMatch(/rock|merge|joined the army|play for/i);
			}
		}
		const deployed = describeArmy({
			status: ARMY_STATUS.Deployed,
			stake: 30n * 10n ** 18n,
		});
		expect(deployed?.stakeLabel).toContain('30');
		expect(deployed?.stakeLabel).toContain('every stake it captured');
		const exited = describeArmy({status: ARMY_STATUS.Exited, stake: 0n});
		expect(exited?.label).toContain('its pieces left the board');
	});

	it('tells the player their king is a stone holding their stake, while nobody has captured it', () => {
		const stone = {
			status: ARMY_STATUS.Captured,
			stake: 10n * 10n ** 18n,
			capturedBy: 0n,
		};
		expect(describeArmy(stone)?.label).toContain('stone');
		const last = describeLastDeployment({needsDeployment: true, last: stone});
		expect(last?.label).toContain('stone');
		expect(last?.stakeLabel).toContain('10');
		expect(last?.stakeLabel).toContain('whoever captures it');
	});

	it('tells the player their king was taken, and that its stake went with its pieces, while they deploy again', () => {
		const captured = describeLastDeployment({
			needsDeployment: true,
			last: {status: ARMY_STATUS.Captured, stake: 0n},
		});
		expect(captured?.tone).toBe('bad');
		expect(captured?.label).toContain('king was taken');
		expect(captured?.label).toContain('deploy again');
		expect(captured?.stakeLabel).toContain('captor');
	});

	it('tells the player what became of a failed, cancelled or missed deployment while they deploy again', () => {
		const failed = describeLastDeployment({
			needsDeployment: true,
			last: {status: ARMY_STATUS.Failed, stake: 10n},
		});
		expect(failed?.tone).toBe('bad');
		expect(failed?.label).toContain('deploy again');
		expect(failed?.stakeLabel).toContain('refund pending');
		expect(
			describeLastDeployment({
				needsDeployment: true,
				last: {status: ARMY_STATUS.Failed, stake: 0n},
			})?.stakeLabel,
		).toContain('refunded');
		expect(
			describeLastDeployment({
				needsDeployment: true,
				last: {status: ARMY_STATUS.Cancelled, stake: 0n},
			})?.stakeLabel,
		).toContain('refunded');
		expect(
			describeLastDeployment({
				needsDeployment: true,
				last: {status: ARMY_STATUS.Unrevealed, stake: 0n},
			})?.stakeLabel,
		).toContain('burned');
		// Nothing to say once the player is playing again, or without one.
		expect(
			describeLastDeployment({
				needsDeployment: false,
				last: {status: ARMY_STATUS.Failed, stake: 10n},
			}),
		).toBeUndefined();
		expect(
			describeLastDeployment({needsDeployment: true, last: undefined}),
		).toBeUndefined();
	});

	it('lists the open spawn points while the army still has to be deployed', () => {
		const view = {
			step: 'Loaded' as const,
			cycleNumber: 3,
			pieces: new Map(),
			ghost: [],
			outcomes: [],
			outcomesCycle: -1,
			spawnPoints: [
				{spawnPoint: squareAt(0, 0), position: {x: 0, y: 0}, nearest: []},
				{spawnPoint: squareAt(16, 0), position: {x: 16, y: 0}, nearest: [5]},
			],
			planned: {
				spawnPoint: squareAt(16, 0),
				position: {x: 16, y: 0},
				nearest: [5],
			},
		};
		const deployment = describeDeployment({needsDeployment: true, view});
		expect(deployment?.picked).toBe('(16, 0)');
		expect(deployment?.spawnPoints.map((p) => p.picked)).toEqual([false, true]);
		expect(deployment?.spawnPoints[1].nearest).toBe('nearest army: 5 squares');
		expect(describeDeployment({needsDeployment: false, view})).toBeUndefined();
	});

	it('names a committed deployment for what it is', () => {
		expect(
			describeSubmission({
				step: 'Planning',
				cycleNumber: 3,
				actions: [{from: 0n, to: 0n}],
			} as never).label,
		).toBe('Deployment picked, not yet committed');
	});

	it('says a frozen army stays on the board with its stake, and that the player deploys again', () => {
		const frozen = describeArmy({status: ARMY_STATUS.Frozen, stake: 10n});
		expect(frozen?.tone).toBe('bad');
		expect(frozen?.label).toContain('frozen');
		const last = describeLastDeployment({
			needsDeployment: true,
			last: {status: ARMY_STATUS.Frozen, stake: 10n},
		});
		expect(last?.label).toContain('frozen');
		expect(last?.label).toContain('deploy again');
		expect(last?.stakeLabel).toContain('stays on the board');
	});
});

describe('the reveal deadline warning', () => {
	const move = {from: 1n, to: 2n};
	const deployment = {from: 3n, to: 3n};
	const committed = (actions = [move]) =>
		({step: 'Committed', cycleNumber: 5, actions}) as const;
	const clock = (secondsToRevealEnd: number, isCommitPhase = false) => ({
		currentCycleNumber: 5,
		isCommitPhase,
		revealPhaseDuration: 60,
		secondsToRevealEnd,
	});

	it('says nothing while there is still time, or nothing is owed', () => {
		expect(
			describeRevealDeadline({cycle: clock(50), submission: committed()}),
		).toBeUndefined();
		// The commit phase: the reveal is not due yet.
		expect(
			describeRevealDeadline({cycle: clock(5, true), submission: committed()}),
		).toBeUndefined();
		// Revealed, or a turn of another cycle.
		expect(
			describeRevealDeadline({
				cycle: clock(5),
				submission: {step: 'Revealed', cycleNumber: 5},
			}),
		).toBeUndefined();
		expect(
			describeRevealDeadline({
				cycle: clock(5),
				submission: {step: 'Committed', cycleNumber: 4, actions: [move]},
			}),
		).toBeUndefined();
		// Revealed for the player by the reveal service.
		expect(
			describeRevealDeadline({
				cycle: clock(5),
				submission: committed(),
				revealSchedule: 'confirmed',
			}),
		).toBeUndefined();
	});

	it('says nothing without a clock: a manual cycle waits for every reveal', () => {
		expect(
			describeRevealDeadline({
				cycle: {
					currentCycleNumber: 5,
					isCommitPhase: false,
					revealPhaseDuration: 0,
					secondsToRevealEnd: undefined,
				},
				submission: committed(),
			}),
		).toBeUndefined();
	});

	it('warns loudly once the deadline is close and the reveal has not landed', () => {
		const at = 60 * REVEAL_DEADLINE_WARNING_SHARE;
		const warning = describeRevealDeadline({
			cycle: clock(at - 0.4),
			submission: committed(),
		});
		expect(warning?.secondsLeft).toBe(Math.ceil(at - 0.4));
		expect(warning?.headline).toContain('not landed');
		expect(warning?.detail).toContain('freezes');
		// Still being sent counts too.
		expect(
			describeRevealDeadline({
				cycle: clock(3),
				submission: {step: 'Revealing', cycleNumber: 5, actions: [move]},
			})?.headline,
		).toContain('not landed');
		// A deployment is not frozen: its stake is burned.
		expect(
			describeRevealDeadline({
				cycle: clock(3),
				submission: committed([deployment]),
			})?.detail,
		).toContain('burned');
	});

	it('warns as soon as the reveal failed, and names the empty gas tank', () => {
		const failed = (error: unknown) =>
			({
				step: 'Error',
				cycleNumber: 5,
				during: 'reveal',
				message: 'nope',
				error,
				actions: [move],
			}) as const;
		const outOfGas = describeRevealDeadline({
			cycle: clock(55),
			submission: failed(new SignerOutOfFundsError('no gas')),
		});
		expect(outOfGas?.detail).toContain('gas');
		expect(outOfGas?.detail).toContain('freezes');
		expect(
			describeRevealDeadline({
				cycle: clock(55),
				submission: failed(new Error('nope')),
			})?.detail,
		).toContain('Retry reveal');
	});
});
