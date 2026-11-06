/**
 * EXITS: where they are, and the call that pays an army that left through one
 * (which of the account's armies is owed is `armies.ts`'s `unpaidExit`)
 * (`docs/adr/0011-an-exit-removes-its-own-army-and-leaves-rocks.md`, whose
 * rocks `docs/adr/0013` removed: an exited army's pieces leave the board, and
 * its payout includes every stake it captured).
 *
 * Whether an army has exited is the contract's to say (the registry's
 * `Exited` status, resolved lazily from closed-cycle facts); nothing here works
 * it out. What is here is the exit squares' PLACE, a constant of the map like
 * the spawn grid itself: the 2 by 2 block at the centre of each spawn-grid
 * cell, the squares ⌊S/2⌋ and ⌊S/2⌋ + 1 off a spawn point on both axes for a
 * spacing S (`UsingGameBoard._isExit`, `docs/adr/0015`). At S = 9 that is
 * offsets 4 and 5, two squares diagonally off each army's corner.
 */
import {get, writable, type Readable} from 'svelte/store';
import type {CoreServices} from '$lib/context/core';
import type {CommitRevealContract} from '$lib/game/core/commit-reveal/contract';

/** `v` modulo `spacing`, never negative. */
const mod = (v: number, spacing: number) => ((v % spacing) + spacing) % spacing;

/** Whether coordinate `v` is in the exit band of its spawn-grid cell. */
function inExitBand(v: number, spacing: number): boolean {
	const offset = mod(v, spacing);
	const half = Math.floor(spacing / 2);
	return offset === half || offset === half + 1;
}

/** Whether (x, y) is an exit on a grid of spawn points `spacing` apart. */
export function isExitSquare(x: number, y: number, spacing: number): boolean {
	return inExitBand(x, spacing) && inExitBand(y, spacing);
}

/** The coordinates of the exit bands in [min, max], ascending. */
function bandIn(min: number, max: number, spacing: number): number[] {
	const half = Math.floor(spacing / 2);
	const out: number[] = [];
	const firstCell = Math.floor((min - half - 1) / spacing);
	for (let cell = firstCell; cell * spacing + half <= max; cell++) {
		for (const v of [cell * spacing + half, cell * spacing + half + 1]) {
			if (v >= min && v <= max) out.push(v);
		}
	}
	return out;
}

/** Every exit square in the rectangle, inclusive on every side. */
export function exitsIn(
	bounds: {minX: number; minY: number; maxX: number; maxY: number},
	spacing: number,
): {x: number; y: number}[] {
	const xs = bandIn(bounds.minX, bounds.maxX, spacing);
	const ys = bandIn(bounds.minY, bounds.maxY, spacing);
	const exits: {x: number; y: number}[] = [];
	for (const y of ys) for (const x of xs) exits.push({x, y});
	return exits;
}

export type ExitPayoutState = {busy: boolean; error?: string};

export type ExitPayoutStore = Readable<ExitPayoutState> & {
	/** Pay `army`'s whole stake, in ETH, to its owner (`exit(army)`). */
	claim(army: bigint): Promise<void>;
};

export type ExitPayoutDeps = Pick<
	CoreServices,
	'connection' | 'accountExecutor' | 'publicClient'
>;

/**
 * THE PAYOUT CALL. Anyone may send it, and it always pays the army's owner, so
 * it is sent from the account itself, which is who is waiting for the ETH.
 */
export function createExitPayout(params: {
	deps: ExitPayoutDeps;
	contract: CommitRevealContract;
	/**
	 * The call that pays: `exit` in the world, `claim` at a table, where there
	 * are no exits and the table's outcome pays instead (`./table-payout.ts`).
	 * Both take the army, may be sent by anyone, and pay its owner.
	 */
	functionName?: 'exit' | 'claim';
	/** Called once the payout has landed, to re-read the registry. */
	onPaid?: () => void | Promise<void>;
}): ExitPayoutStore {
	const {deps, contract} = params;
	const state = writable<ExitPayoutState>({busy: false});

	async function claim(army: bigint) {
		if (get(state).busy) return;
		state.set({busy: true});
		try {
			await deps.connection.ensureConnected();
			const executor = get(deps.accountExecutor);
			if (executor.status !== 'ready') {
				throw new Error('No account connected.');
			}
			const hash = await executor.client.writeContract({
				address: contract.address,
				abi: contract.abi,
				functionName: params.functionName ?? 'exit',
				args: [army],
				account: executor.account,
				chain: null,
			} as never);
			const receipt = await deps.publicClient.waitForTransactionReceipt({
				hash,
			});
			if (receipt.status === 'reverted') throw new Error('The payout failed');
			state.set({busy: false});
			await params.onPaid?.();
		} catch (error) {
			state.set({
				busy: false,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	return {subscribe: state.subscribe, claim};
}
