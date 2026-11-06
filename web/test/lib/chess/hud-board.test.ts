import {describe, it, expect} from 'vitest';
import {ARMY_STATUS, type ArmyView} from '$lib/chess/armies';
import {squareAt} from '$lib/chess/squares';
import {
	frozenArmiesOf,
	kingsOf,
	mergeBoardView,
	stonesOf,
} from '$lib/chess/view';
import {PIECE_KIND, type Piece} from '$lib/chess/board';
import {noOutcomes} from '$lib/chess/outcomes';
import {describeCountdown, formatCountdown} from '$lib/chess/ui/hud';
import type {CycleInfo} from '$lib/game/core/cycle';

/**
 * WHAT A PLAYER JUDGES A CYCLE BY (stories 46 and 47): every king labelled
 * with its army's stake and frozen armies told apart, both as the registry
 * says, and a countdown to the end of the contract's current phase.
 */

const army = (
	id: bigint,
	status: number,
	opts: {king?: [number, number]; stake?: bigint} = {},
): ArmyView => ({
	id,
	owner: '0x1111111111111111111111111111111111111111',
	status: status as ArmyView['status'],
	deployedIn: 2n,
	spawnPoint: 0n,
	king: squareAt(...(opts.king ?? [0, 0])),
	stake: opts.stake ?? 0n,
	capturedBy: 0n,
});

describe('the kings and their stakes', () => {
	it("label every king on the board with the registry's stake, a frozen one as frozen", () => {
		const kings = kingsOf([
			army(1n, ARMY_STATUS.Deployed, {king: [1, 2], stake: 30n * 10n ** 18n}),
			army(2n, ARMY_STATUS.Frozen, {king: [20, -3], stake: 10n * 10n ** 18n}),
			// Gone from the board: its king was taken, it left, or never landed.
			army(3n, ARMY_STATUS.Captured),
			army(4n, ARMY_STATUS.Exited, {stake: 5n}),
			army(5n, ARMY_STATUS.Deploying),
		]);
		expect(
			kings.map(({army, position2d, stake, frozen}) => ({
				army,
				position2d,
				stake,
				frozen,
			})),
		).toEqual([
			{
				army: 1n,
				position2d: {x: 1, y: 2},
				stake: 30n * 10n ** 18n,
				frozen: false,
			},
			{
				army: 2n,
				position2d: {x: 20, y: -3},
				stake: 10n * 10n ** 18n,
				frozen: true,
			},
		]);
		expect(kings[0].stakeLabel).toContain('30');
		expect(kings[0].stakeLabel).toContain('TOK');
		expect(kings[1].stakeLabel).toContain('frozen');
	});

	it('labels every stone in view with the stake its army still holds, as the registry says', () => {
		const stone = (x: number, y: number, army: bigint): Piece => ({
			position: squareAt(x, y),
			army,
			kind: PIECE_KIND.Stone,
		});
		const pawn: Piece = {...stone(9, 9, 1n), kind: PIECE_KIND.Pawn};
		const pieces = new Map(
			[stone(4, 5, 6n), pawn].map((p) => [p.position, p] as const),
		);
		const stones = stonesOf(pieces, [
			army(1n, ARMY_STATUS.Deployed, {stake: 30n * 10n ** 18n}),
			army(6n, ARMY_STATUS.Captured, {stake: 12n * 10n ** 18n}),
		]);
		expect(
			stones.map(({army, position2d, stake}) => ({army, position2d, stake})),
		).toEqual([{army: 6n, position2d: {x: 4, y: 5}, stake: 12n * 10n ** 18n}]);
		expect(stones[0].stakeLabel).toContain('12');
		expect(stones[0].stakeLabel).toContain('stone');
	});

	it('names the frozen armies, a missed reveal not yet settled included (the registry counts it)', () => {
		expect(
			frozenArmiesOf([
				army(1n, ARMY_STATUS.Deployed),
				army(2n, ARMY_STATUS.Frozen),
			]),
		).toEqual(new Set([2n]));
	});

	it('reach the view the renderer draws', () => {
		const view = mergeBoardView({
			onchain: {
				pieces: new Map(),
				spawnPoints: [],
				armies: [
					army(1n, ARMY_STATUS.Deployed, {king: [1, 2], stake: 3n}),
					army(2n, ARMY_STATUS.Frozen, {king: [4, 4], stake: 1n}),
				],
				outcomes: noOutcomes(),
				cycleNumber: 3,
			},
			local: {},
		} as never);
		expect(view.kings?.map((k) => k.army)).toEqual([1n, 2n]);
		expect(view.frozen).toEqual(new Set([2n]));
		expect(view.attacked).toEqual([]);
	});
});

const config = {
	commitPhaseDuration: 100,
	revealPhaseDuration: 40,
	startTime: 0,
	commitTimeAllowance: 10,
	policy: 'timed',
} as unknown as CycleInfo['config'];

const clocked = (
	type: 'timed' | 'hybrid',
	isCommitPhase: boolean,
	left: {commit: number; reveal: number},
): CycleInfo =>
	({
		type,
		currentCycleNumber: 4,
		isCommitPhase,
		config,
		timeLeftInCycle: left.reveal,
		timeInCurrentCycle: 0,
		timeLeftInPhase: isCommitPhase ? left.commit : left.reveal,
		timeLeftForCommitEnd: left.commit,
		timeLeftForRevealEnd: left.reveal,
		currentPhaseDuration: 0,
		revealOpensAt: 0,
	}) as CycleInfo;

describe('the phase countdown', () => {
	it('counts to the end of the commit phase, then to the end of the reveal phase', () => {
		// Not the dial's span, which runs this browser's commit margin and the
		// reveal phase together: the contract's own deadline.
		const commit = describeCountdown(
			clocked('timed', true, {commit: 4.2, reveal: 44.2}),
		);
		expect(commit).toEqual({
			label: 'Commitments close in 5s',
			secondsLeft: 5,
		});
		const reveal = describeCountdown(
			clocked('timed', false, {commit: 0, reveal: 125}),
		);
		expect(reveal).toEqual({
			label: 'Reveals must land within 2:05',
			secondsLeft: 125,
		});
	});

	it('says an early advance can end the phase sooner', () => {
		expect(
			describeCountdown(clocked('hybrid', true, {commit: 30, reveal: 70}))
				?.label,
		).toBe('Commitments close in 30s, sooner once every army has acted');
	});

	it('has nothing to count without a clock', () => {
		expect(
			describeCountdown({
				type: 'manual',
				currentCycleNumber: 4,
				isCommitPhase: true,
				config,
			}),
		).toBeUndefined();
	});

	it('reads seconds, minutes and hours as a clock does', () => {
		expect(formatCountdown(0)).toBe('0s');
		expect(formatCountdown(-3)).toBe('0s');
		expect(formatCountdown(59.2)).toBe('1:00');
		expect(formatCountdown(187)).toBe('3:07');
		expect(formatCountdown(3729)).toBe('1:02:09');
	});
});
