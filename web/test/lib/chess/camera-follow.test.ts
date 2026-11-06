import {describe, it, expect} from 'vitest';
import {get, writable} from 'svelte/store';
import {createCamera} from '$lib/game/render/camera';
import {createCameraFollow, followTargetOf} from '$lib/chess/camera-follow';
import {ARMY_STATUS} from '$lib/chess/armies';
import {squareAt, type Position} from '$lib/chess/squares';

/**
 * The camera follows the player's army by default (user story 44): it centres
 * on the army's king, keeps doing so as the king moves, lets go the moment the
 * player pans away, and comes back on request.
 */

const config = {
	initialVisible: {width: 24, height: 24},
	limits: {minWidth: 10, minHeight: 10, maxWidth: 100, maxHeight: 100},
};

function setup(initial?: Position) {
	const {cameraControl} = createCamera(config);
	cameraControl.resize(800, 600);
	const target = writable<Position | undefined>(initial);
	const follow = createCameraFollow({cameraControl, target});
	const stop = follow.start();
	const centre = () => {
		const {centerX, centerY} = cameraControl.current.transform;
		return {x: centerX, y: centerY};
	};
	return {cameraControl, target, follow, stop, centre};
}

describe('the camera follows the army', () => {
	it('centres on the army by default', () => {
		const {follow, centre} = setup({x: 40, y: -16});
		expect(centre()).toEqual({x: 40, y: -16});
		expect(get(follow).following).toBe(true);
	});

	it('keeps centring on the king as it moves', () => {
		const {target, centre} = setup({x: 40, y: -16});
		target.set({x: 41, y: -15});
		expect(centre()).toEqual({x: 41, y: -15});
	});

	it('centres on the army when it lands, after a camera with nothing to follow', () => {
		const {target, cameraControl, centre} = setup(undefined);
		// Looking around for a spawn point before there is an army: nothing to
		// follow, so nothing is let go of either.
		cameraControl.handle({type: 'pan', dx: 100, dy: 0});
		target.set({x: 32, y: 32});
		expect(centre()).toEqual({x: 32, y: 32});
	});

	it('lets go when the player pans away, and stays where they left it', () => {
		const {target, cameraControl, follow, centre} = setup({x: 40, y: -16});
		cameraControl.handle({type: 'pan', dx: 160, dy: 0});
		expect(get(follow).following).toBe(false);
		const panned = centre();
		expect(panned).not.toEqual({x: 40, y: -16});

		// The king moves on: the camera does not drag the player back.
		target.set({x: 41, y: -16});
		expect(centre()).toEqual(panned);
	});

	it('comes back to the army on request, and follows it again', () => {
		const {target, cameraControl, follow, centre} = setup({x: 40, y: -16});
		cameraControl.handle({type: 'pan', dx: 160, dy: 0});
		follow.recentre();
		expect(get(follow).following).toBe(true);
		expect(centre()).toEqual({x: 40, y: -16});
		target.set({x: 42, y: -16});
		expect(centre()).toEqual({x: 42, y: -16});
	});

	it('looking somewhere else (the minimap) lets go of the army', () => {
		const {follow, centre, target} = setup({x: 40, y: -16});
		follow.lookAt({x: -100, y: 200});
		expect(centre()).toEqual({x: -100, y: 200});
		expect(get(follow).following).toBe(false);
		target.set({x: 41, y: -16});
		expect(centre()).toEqual({x: -100, y: 200});
	});

	it('says whether there is an army to come back to', () => {
		const {follow, target} = setup(undefined);
		expect(get(follow).hasTarget).toBe(false);
		target.set({x: 0, y: 0});
		expect(get(follow).hasTarget).toBe(true);
	});

	it('stops moving the camera once torn down', () => {
		const {target, stop, centre} = setup({x: 40, y: -16});
		stop();
		target.set({x: 0, y: 0});
		expect(centre()).toEqual({x: 40, y: -16});
	});
});

describe('what the camera follows', () => {
	const army = (
		id: bigint,
		x: number,
		y: number,
		status: number = ARMY_STATUS.Deployed,
	) => ({
		id,
		owner: '0x1111111111111111111111111111111111111111' as const,
		status: status as 2,
		deployedIn: 2n,
		spawnPoint: 0n,
		king: squareAt(x, y),
		stake: 1n,
		capturedBy: 0n,
	});

	it("is the played army's king, read off the board's registry", () => {
		expect(
			followTargetOf({
				board: {step: 'Loaded', armies: [army(1n, 5, 5), army(2n, -8, 3)]},
				you: 2n,
			}),
		).toEqual({x: -8, y: 3});
	});

	it('is nothing while the army is not on the board', () => {
		for (const status of [
			ARMY_STATUS.Deploying,
			ARMY_STATUS.Failed,
			ARMY_STATUS.Captured,
		]) {
			expect(
				followTargetOf({
					board: {step: 'Loaded', armies: [army(1n, 5, 5, status)]},
					you: 1n,
				}),
			).toBeUndefined();
		}
		expect(
			followTargetOf({board: {step: 'Unloaded'}, you: 1n}),
		).toBeUndefined();
		expect(
			followTargetOf({
				board: {step: 'Loaded', armies: [army(1n, 5, 5)]},
				you: undefined,
			}),
		).toBeUndefined();
	});
});
