import {describe, it, expect} from 'vitest';
import {writable} from 'svelte/store';
import {createMissedReveal} from '$lib/chess/missed-reveal';
import {
	bondFor,
	buildMoveCommitment,
	deploymentAt,
	type Move,
} from '$lib/chess/commit-reveal';
import {squareAt} from '$lib/chess/squares';
import type {ChessConfig} from '$lib/chess/config';

/**
 * WHAT A MISSED REVEAL IS SHOWN TO COST must be what the contract charges
 * (`UsingGameInternal._acknowledgeMissedReveal`): the stake for a missed
 * deployment, nothing for a missed move or pass (a missed move costs the
 * freeze, `docs/adr/0005-missed-reveal-freezes-the-army.md`).
 */

const STAKE = 10n ** 19n;
const ARMY = 1n << 160n;
const SECRET =
	'0x00000000000000000000000000000000000000000000000000000000000000aa' as const;
const config = {stake: STAKE, actionsPerReveal: 1} as unknown as ChessConfig;

/** The forfeit shown for a commitment of `actions`, missed in cycle 3. */
async function forfeitShownFor(actions: Move[]): Promise<bigint | undefined> {
	const {hash} = buildMoveCommitment({
		actions,
		secret: SECRET,
		actionsPerReveal: 1,
	});
	const reads: Record<string, unknown> = {
		getCommitment: {hash, cycleNumber: 3n, bond: bondFor(config, actions)},
		getCycleNumber: [5n, true],
	};
	const deps = {
		deployments: {get: () => ({contracts: {Game: {address: '0x1', abi: []}}})},
		publicClient: {
			readContract: async ({functionName}: {functionName: string}) =>
				reads[functionName],
		},
	};
	const store = createMissedReveal({
		deps: deps as never,
		config,
		identity: writable(ARMY),
		committedTurn: () => ({
			cycleNumber: 3,
			actions,
			secret: SECRET,
			committed: true,
		}),
	});
	await store.check();
	const state = store.value;
	return state.step === 'Blocked' ? state.forfeit : undefined;
}

describe('a missed reveal, as the client shows it', () => {
	it('loses the stake for a missed deployment', async () => {
		expect(await forfeitShownFor(deploymentAt(squareAt(16, 0)))).toBe(STAKE);
	});

	it('is not shown as losing the stake for a missed move', async () => {
		expect(
			await forfeitShownFor([{from: squareAt(-2, 1), to: squareAt(-2, 3)}]),
		).toBe(0n);
	});

	it('costs nothing for a missed pass', async () => {
		expect(await forfeitShownFor([])).toBe(0n);
	});
});
