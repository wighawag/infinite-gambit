import {describe, it, expect} from 'vitest';
import {ARMY_STATUS} from '$lib/chess/armies';
import {describeSpawnPoints, nearestLabel} from '$lib/chess/spawn-points';
import {spawnPointNear} from '$lib/chess/planning';
import {squareAt} from '$lib/chess/squares';

/**
 * The open spawn points as a player choosing one sees them (user story 3).
 * WHICH are open is the contract's answer; what is computed here is only how
 * far each is from the armies already on the board.
 */

const king = (x: number, y: number, status: number = ARMY_STATUS.Deployed) => ({
	id: 1n << 160n,
	owner: '0x1111111111111111111111111111111111111111' as const,
	status: status as 2,
	deployedIn: 2n,
	spawnPoint: 0n,
	king: squareAt(x, y),
	stake: 1n,
	capturedBy: 0n,
});

describe('how close the nearest armies are', () => {
	it('measures in king steps from each open spawn point, nearest first', () => {
		const [origin, east] = describeSpawnPoints({
			spawnPoints: [squareAt(0, 0), squareAt(16, 0)],
			armies: [king(-2, 16), king(30, 2), king(-40, -40)],
		});
		expect(origin.position).toEqual({x: 0, y: 0});
		expect(origin.nearest).toEqual([16, 30, 40]);
		expect(east.nearest).toEqual([14, 18, 56]);
		expect(nearestLabel(east.nearest)).toBe(
			'nearest armies: 14, 18, 56 squares',
		);
	});

	it('counts only armies on the board', () => {
		const [point] = describeSpawnPoints({
			spawnPoints: [squareAt(0, 0)],
			armies: [
				king(3, 3, ARMY_STATUS.Failed),
				king(5, 0, ARMY_STATUS.Deploying),
			],
		});
		expect(point.nearest).toEqual([]);
		expect(nearestLabel(point.nearest)).toBe('no army on the board yet');
	});

	it('counts a frozen army, which stays on the board with its stake', () => {
		const [point] = describeSpawnPoints({
			spawnPoints: [squareAt(0, 0)],
			armies: [king(3, 3, ARMY_STATUS.Frozen)],
		});
		expect(point.nearest).toEqual([3]);
	});
});

describe('picking a spawn point by clicking the board', () => {
	const open = [squareAt(0, 0), squareAt(9, 0)];

	it('picks the spawn point whose footprint the click lands on', () => {
		expect(spawnPointNear({x: 0, y: 0}, open)).toBe(open[0]);
		expect(spawnPointNear({x: -2, y: 2}, open)).toBe(open[0]);
		expect(spawnPointNear({x: 7, y: -1}, open)).toBe(open[1]);
	});

	it('picks nothing between spawn points', () => {
		expect(spawnPointNear({x: 4, y: 0}, open)).toBeUndefined();
		expect(spawnPointNear({x: 5, y: 0}, open)).toBeUndefined();
		expect(spawnPointNear({x: 0, y: 3}, open)).toBeUndefined();
	});
});
