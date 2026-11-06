import {describe, expect, it} from 'vitest';
import {get, writable} from 'svelte/store';
import {createHud, describeRevealSchedule} from '$lib/chess/ui/hud';
import type {Context} from '$lib/context/types';
import type {SubmissionState} from '$lib/game/core/submission';
import type {Move} from '$lib/chess/commit-reveal';
import type {FuzdSchedule, ScheduledReveal} from '$lib/fuzd';

/**
 * What the HUD says about WHO REVEALS the turn (`with/fuzd`): scheduled, then
 * fuzd's word in the reveal phase, or not scheduled. Its own file so the
 * template's HUD suite stays the template's.
 */
type State = SubmissionState<Move>;

const SCHEDULE: FuzdSchedule = {
	chainId: '31337',
	account: '0x00000000000000000000000000000000000000aa',
	remoteAccount: '0x00000000000000000000000000000000000000fe',
	slot: 'cycle_3',
	cycleNumber: 3,
	batchSize: 2,
	scheduledAt: 1,
	revealDueAt: 100,
	expiryDelta: 10,
	inClear: true,
};

const committed = (revealScheduled?: boolean): State => ({
	step: 'Committed',
	cycleNumber: 3,
	actions: [{from: 1n, to: 1n}],
	...(revealScheduled === undefined ? {} : {revealScheduled}),
});

const scheduled = (status?: ScheduledReveal['status']): ScheduledReveal => ({
	cycleNumber: 3,
	revealScheduled: true,
	schedule: SCHEDULE,
	...(status ? {status} : {}),
});

describe('what the HUD says about who reveals the turn', () => {
	it('says the turn will be revealed for the player once scheduled', () => {
		const line = describeRevealSchedule(scheduled(), committed(true));
		expect(line?.step).toBe('scheduled');
		expect(line?.label).toMatch(/auto-reveal scheduled: safe to close/i);
	});

	it("shows fuzd's status in the reveal phase", () => {
		expect(
			describeRevealSchedule(
				scheduled({step: 'broadcast', sent: 1, total: 2}),
				committed(true),
			)?.label,
		).toMatch(/1 of 2/);
		expect(
			describeRevealSchedule(scheduled({step: 'confirmed'}), {
				step: 'Revealed',
				cycleNumber: 3,
			})?.step,
		).toBe('confirmed');
		const failed = describeRevealSchedule(
			scheduled({step: 'failed', reason: 'a reveal transaction failed'}),
			committed(true),
		);
		expect(failed?.tone).toBe('bad');
		expect(failed?.label).toMatch(/revealing here/);
		expect(
			describeRevealSchedule(scheduled({step: 'unreachable'}), committed(true))
				?.step,
		).toBe('unreachable');
	});

	it('says not scheduled when scheduling failed, while the turn is owed', () => {
		const line = describeRevealSchedule(
			{cycleNumber: 3, revealScheduled: false},
			committed(false),
		);
		expect(line?.step).toBe('not-scheduled');
		expect(line?.label).toMatch(/keep this page open/i);
		expect(
			describeRevealSchedule(
				{cycleNumber: 3, revealScheduled: false},
				{
					step: 'Revealed',
					cycleNumber: 3,
				},
			),
		).toBeUndefined();
	});

	it('says nothing without a scheduler, or for a turn this browser revealed', () => {
		expect(describeRevealSchedule(undefined, committed())).toBeUndefined();
		expect(
			describeRevealSchedule({cycleNumber: 3}, committed()),
		).toBeUndefined();
		expect(
			describeRevealSchedule(scheduled(), {step: 'Revealed', cycleNumber: 3}),
		).toBeUndefined();
	});

	it('reaches the HUD model from the game context', () => {
		const revealSchedule = writable<ScheduledReveal | undefined>(scheduled());
		const cycleInfo = writable<Record<string, unknown>>({
			currentCycleNumber: 3,
		});
		const context = {
			hasLocalSigner: true,
			deployments: {
				get: () => ({chain: {nativeCurrency: {symbol: 'ETH', decimals: 18}}}),
			},
			game: {
				config: {
					sale: {price: 1n, amount: 10n, stipend: 2n},
					cycle: {policy: 'timed'},
				},
				twoPhase: writable({phase: 'reveal', timeLeft: 5, duration: 10}),
				phase: writable('reveal'),
				// `ready`: the account's data loaded (see `SubmissionStore.ready`).
				submission: Object.assign(writable(committed(true)), {
					ready: writable(true),
				}),
				planning: {
					count: writable(0),
					pieceMoves: writable([]),
					maxPieceMoves: writable(3),
					refusal: writable(undefined),
				},
				cost: writable(0n),
				reserve: writable({step: 'Loaded', amount: 100n}),
				cycleInfo,
				missedReveal: writable({step: 'Clear'}),
				setup: writable(undefined),
				acquisition: writable({step: 'Idle'}),
				recovery: writable({step: 'Idle'}),
				savedTurn: writable({status: 'ready'}),
				revealSchedule,
				needsDeployment: writable(false),
				armies: {
					activeArmy: writable(undefined),
					lastOutcome: writable(undefined),
					pendingRefund: writable(0n),
					unpaidExit: writable(undefined),
				},
				exitPayout: writable({busy: false}),
			},
			viewState: writable({step: 'Unloaded'}),
		} as unknown as Context;
		const hud = createHud(context);
		expect(get(hud).revealSchedule?.step).toBe('scheduled');
		revealSchedule.set(scheduled({step: 'confirmed'}));
		expect(get(hud).revealSchedule?.step).toBe('confirmed');
		// No clock in that cycle, so no deadline to warn about.
		expect(get(hud).revealDeadline).toBeUndefined();

		// Near the end of a timed reveal phase: confirmed is landed, anything
		// else is warned about (`describeRevealDeadline`).
		cycleInfo.set({
			type: 'timed',
			currentCycleNumber: 3,
			isCommitPhase: false,
			timeLeftForRevealEnd: 2,
			config: {revealPhaseDuration: 10},
		});
		expect(get(hud).revealDeadline).toBeUndefined();
		revealSchedule.set(scheduled({step: 'unreachable'}));
		expect(get(hud).revealDeadline?.secondsLeft).toBe(2);
	});
});
