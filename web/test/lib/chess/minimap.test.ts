import {describe, it, expect} from 'vitest';
import {ARMY_STATUS} from '$lib/chess/armies';
import {minimapOf, minimapPoint, MAX_MINIMAP_EXITS} from '$lib/chess/minimap';
import {squareAt} from '$lib/chess/squares';

/**
 * The minimap (user story 45): the spawn spiral and every army on the board,
 * read off the contract's registry and open-spawn-point views (never the
 * pieces, which stay fetched only for the area in view), with the camera's
 * extent on it, and a point on it to send the camera to.
 */

const army = (
	id: bigint,
	opts: {king: [number, number]; spawn: [number, number]; status?: number},
) => ({
	id,
	owner: '0x1111111111111111111111111111111111111111' as const,
	status: (opts.status ?? ARMY_STATUS.Deployed) as 2,
	deployedIn: 2n,
	spawnPoint: squareAt(...opts.spawn),
	king: squareAt(...opts.king),
	stake: 1n,
	capturedBy: 0n,
});

const camera = {x: 0, y: 0, width: 24, height: 12};

describe('what the minimap shows', () => {
	it('marks the open spawn points and those an army landed on', () => {
		const map = minimapOf({
			spawnPoints: [squareAt(16, 0), squareAt(16, 16)],
			armies: [
				army(1n, {king: [1, 2], spawn: [0, 0]}),
				// Its king was taken, but it landed: the spawn point is taken.
				army(2n, {
					king: [0, 0],
					spawn: [-16, 0],
					status: ARMY_STATUS.Captured,
				}),
				// Its deployment failed: it never stood there.
				army(3n, {king: [0, 0], spawn: [0, 16], status: ARMY_STATUS.Failed}),
			],
			you: undefined,
			camera,
		});
		expect(map.spawnPoints).toEqual([
			{x: 16, y: 0, open: true},
			{x: 16, y: 16, open: true},
			{x: 0, y: 0, open: false},
			{x: -16, y: 0, open: false},
		]);
	});

	it("marks every army on the board at its king, the player's own apart", () => {
		const map = minimapOf({
			spawnPoints: [],
			armies: [
				army(1n, {king: [1, 2], spawn: [0, 0]}),
				army(2n, {king: [20, -3], spawn: [16, 0]}),
				// Not yet revealed: where it goes is still a secret.
				army(3n, {king: [0, 0], spawn: [0, 0], status: ARMY_STATUS.Deploying}),
				army(4n, {king: [0, 0], spawn: [0, 16], status: ARMY_STATUS.Captured}),
				// Frozen by a missed reveal: still on the board, with its stake.
				army(5n, {king: [-17, 1], spawn: [-16, 0], status: ARMY_STATUS.Frozen}),
			],
			you: 2n,
			camera,
		});
		expect(map.armies.map(({id, x, y, you}) => ({id, x, y, you}))).toEqual([
			{id: 1n, x: 1, y: 2, you: false},
			{id: 2n, x: 20, y: -3, you: true},
			{id: 5n, x: -17, y: 1, you: false},
		]);
		expect(map.spawnPoints).toContainEqual({x: -16, y: 0, open: false});
	});

	it('shows the camera as the rectangle it sees', () => {
		const map = minimapOf({
			spawnPoints: [],
			armies: [],
			you: undefined,
			camera: {x: 10, y: -4, width: 24, height: 12},
		});
		expect(map.view).toEqual({x: -2, y: -10, width: 24, height: 12});
	});

	it('covers everything it marks and the camera, as a square', () => {
		const map = minimapOf({
			spawnPoints: [squareAt(32, 0)],
			armies: [army(1n, {king: [-40, 10], spawn: [-32, 16]})],
			you: undefined,
			camera: {x: 0, y: 100, width: 24, height: 12},
		});
		const {bounds} = map;
		expect(bounds.width).toBe(bounds.height);
		for (const [x, y] of [
			[32, 0],
			[-40, 10],
			[-32, 16],
			[-12, 94],
			[12, 106],
		]) {
			expect(x).toBeGreaterThan(bounds.x);
			expect(x).toBeLessThan(bounds.x + bounds.width);
			expect(y).toBeGreaterThan(bounds.y);
			expect(y).toBeLessThan(bounds.y + bounds.height);
		}
	});
});

describe('navigating from the minimap', () => {
	it('turns a point on the map, as a fraction of its size, into a square', () => {
		const map = minimapOf({
			spawnPoints: [],
			armies: [],
			you: undefined,
			camera,
		});
		const {bounds} = map;
		expect(minimapPoint(map, {x: 0.5, y: 0.5})).toEqual({
			x: bounds.x + bounds.width / 2,
			y: bounds.y + bounds.height / 2,
		});
		expect(minimapPoint(map, {x: 0, y: 1})).toEqual({
			x: bounds.x,
			y: bounds.y + bounds.height,
		});
	});
});

describe('the exits on the minimap', () => {
	it('marks every exit the map covers: the 2 by 2 block at the centre of each spawn-grid cell', () => {
		const map = minimapOf({
			spawnPoints: [squareAt(9, 0)],
			armies: [],
			you: undefined,
			camera,
			spawnSpacing: 9,
		});
		const {bounds} = map;
		expect(map.exits.length).toBeGreaterThan(0);
		const band = (v: number) => [4, 5].includes(((v % 9) + 9) % 9);
		for (const {x, y} of map.exits) {
			expect(band(x)).toBe(true);
			expect(band(y)).toBe(true);
			expect(x).toBeGreaterThanOrEqual(bounds.x);
			expect(x).toBeLessThanOrEqual(bounds.x + bounds.width);
			expect(y).toBeGreaterThanOrEqual(bounds.y);
			expect(y).toBeLessThanOrEqual(bounds.y + bounds.height);
		}
		for (const square of [
			{x: 4, y: 4},
			{x: 5, y: 4},
			{x: 4, y: 5},
			{x: 5, y: 5},
			{x: 4, y: -4},
		]) {
			expect(map.exits).toContainEqual(square);
		}
	});

	it('marks none without a spawn grid (a table), or when too dense to tell apart', () => {
		expect(
			minimapOf({spawnPoints: [], armies: [], you: undefined, camera}).exits,
		).toEqual([]);
		const far = minimapOf({
			spawnPoints: [squareAt(9 * 100, 0)],
			armies: [],
			you: undefined,
			camera,
			spawnSpacing: 9,
		});
		expect(4 * (far.bounds.width / 9) ** 2).toBeGreaterThan(MAX_MINIMAP_EXITS);
		expect(far.exits).toEqual([]);
	});
});
