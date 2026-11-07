import {describe, expect, it} from 'vitest';
import {get, writable} from 'svelte/store';
import type {OnchainStateValue} from '$lib/game/core/seams';
import {PIECE_KIND, type BoardState} from '$lib/chess/board';
import {noOutcomes} from '$lib/chess/outcomes';
import {squareAt} from '$lib/chess/squares';
import {mergeBoardView} from '$lib/chess/view';
import {
	createHoveredSpawnPoint,
	createSpawnGhosts,
	withSpawnGhosts,
	type SimulateDeployment,
} from '$lib/chess/spawn-ghosts';
import {
	BREATH_LOW,
	BREATH_MS,
	breath,
	lookOf,
	HOVERED_GHOST_ALPHA,
	OPEN_GHOST_ALPHA,
	overlayModel,
	pieceLooks,
} from '$lib/chess/render/pixi/view-model';

/**
 * AN OPEN SPAWN POINT IS DRAWN AS THE ARMY THAT WOULD STAND THERE: asked of
 * the contract once per spawn point (a stand-in for the sandbox here), faint,
 * and lit up as the player's own while the mouse is over it.
 */

const A = squareAt(0, 0);
const B = squareAt(16, 0);

const boardOf = (spawnPoints: bigint[]): OnchainStateValue<BoardState> =>
	({
		step: 'Loaded',
		pieces: new Map(),
		spawnPoints,
		armies: [],
		outcomes: noOutcomes(),
	}) as unknown as OnchainStateValue<BoardState>;

/** A king on the spawn point, as a stand-in layout. */
function fakeSimulate(fail = new Set<bigint>()) {
	const calls: bigint[] = [];
	const simulate: SimulateDeployment = async (spawnPoint, army) => {
		calls.push(spawnPoint);
		if (fail.has(spawnPoint)) throw new Error('sandbox down');
		return [{position: spawnPoint, army, kind: PIECE_KIND.King}];
	};
	return {calls, simulate};
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the ghost armies of the open spawn points', () => {
	it('ask the contract once per spawn point, and keep the answer', async () => {
		const board = writable(boardOf([A, B]));
		const {calls, simulate} = fakeSimulate();
		const ghosts = createSpawnGhosts({board, simulate});
		const stop = ghosts.subscribe(() => {});
		await settle();
		expect([...get(ghosts).keys()]).toEqual([A, B]);
		board.set(boardOf([B]));
		board.set(boardOf([A, B]));
		await settle();
		expect(calls).toEqual([A, B]);
		stop();
	});

	it('ask again for a spawn point whose answer failed', async () => {
		const board = writable(boardOf([A]));
		const fail = new Set([A]);
		const {calls, simulate} = fakeSimulate(fail);
		const ghosts = createSpawnGhosts({board, simulate});
		const stop = ghosts.subscribe(() => {});
		await settle();
		expect(get(ghosts).size).toBe(0);
		fail.clear();
		board.set(boardOf([A]));
		await settle();
		expect(calls).toEqual([A, A]);
		expect(get(ghosts).has(A)).toBe(true);
		stop();
	});

	it('stop at the first failure rather than fail once per spawn point', async () => {
		const board = writable(boardOf([A, B]));
		const fail = new Set([A, B]);
		const {calls, simulate} = fakeSimulate(fail);
		const ghosts = createSpawnGhosts({board, simulate});
		const stop = ghosts.subscribe(() => {});
		await settle();
		expect(calls).toEqual([A]);
		fail.clear();
		board.set(boardOf([A, B]));
		await settle();
		expect(calls).toEqual([A, A, B]);
		expect(get(ghosts).size).toBe(2);
		stop();
	});

	it('breathe when open and bob when hovered, never both', () => {
		const king = {
			position: A,
			army: 0n,
			kind: PIECE_KIND.King,
			position2d: {x: 0, y: 0},
		};
		const view = {you: 9n};
		const open = lookOf(king, view, 'open', {x: 0, y: 0})!;
		const lit = lookOf(king, view, 'hovered', {x: 0, y: 0})!;
		expect(open.breathe).toBeDefined();
		expect(open.bob).toBeUndefined();
		expect(lit.bob).toBe(true);
		expect(lit.breathe).toBeUndefined();
		for (let t = 0; t < BREATH_MS; t += 97) {
			const b = breath(t, 0.3);
			expect(b).toBeGreaterThanOrEqual(BREATH_LOW - 1e-9);
			expect(b).toBeLessThanOrEqual(1 + 1e-9);
		}
	});

	it('are drawn faint, the hovered one as the player\u2019s own, the planned one only once', async () => {
		const board = writable(boardOf([A, B]));
		const {simulate} = fakeSimulate();
		const hovered = createHoveredSpawnPoint();
		const plan = withSpawnGhosts(
			writable({}),
			createSpawnGhosts({board, simulate}),
			hovered,
		);
		const stop = plan.subscribe(() => {});
		await settle();
		hovered.hover(B);
		const onchain = boardOf([A, B]) as unknown as BoardState;
		const view = mergeBoardView({onchain, local: get(plan), cycleNumber: 1});
		expect(view.hovered).toBe(B);
		const looks = pieceLooks(view);
		expect(looks.get(`s:${A}:${A}`)?.alpha).toBe(OPEN_GHOST_ALPHA);
		expect(looks.get(`s:${B}:${B}`)?.alpha).toBe(HOVERED_GHOST_ALPHA);
		expect(overlayModel(view).spawns).toMatchObject([
			{hovered: false, ghosted: true},
			{hovered: true, ghosted: true},
		]);

		// planned at A, with its preview in hand: A's open ghost steps aside
		const planned = mergeBoardView({
			onchain,
			local: {
				...get(plan),
				spawnPoint: A,
				army: 9n,
				preview: [{position: A, army: 9n, kind: PIECE_KIND.King}],
			},
			cycleNumber: 1,
		});
		expect([...(planned.spawnGhosts?.keys() ?? [])]).toEqual([B]);
		expect(pieceLooks(planned).has(`g:${A}`)).toBe(true);

		// a spawn point no longer open is not hovered
		const closed = mergeBoardView({
			onchain: boardOf([A]) as unknown as BoardState,
			local: get(plan),
			cycleNumber: 1,
		});
		expect(closed.hovered).toBeUndefined();
		stop();
	});
});
