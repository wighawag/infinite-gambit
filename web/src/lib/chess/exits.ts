/**
 * EXITS: where they are, and the call that pays an army that left through one
 * (which of the account's armies is owed is `armies.ts`'s `unpaidExit`)
 * (`docs/adr/0011-an-exit-removes-its-own-army-and-leaves-rocks.md`).
 *
 * Whether an army has exited is the contract's to say (the registry's
 * `Exited` status, resolved lazily from closed-cycle facts); nothing here works
 * it out. What is here is the exit squares' PLACE, a constant of the map like
 * the spawn grid itself: the centre of each spawn-grid cell, half the spacing
 * off a spawn point on both axes (`UsingGameBoard._isExit`).
 */
import {get, writable, type Readable} from 'svelte/store';
import type {CoreServices} from '$lib/context/core';
import type {CommitRevealContract} from '$lib/game/core/commit-reveal/contract';

/** Whether (x, y) is an exit on a grid of spawn points `spacing` apart. */
export function isExitSquare(x: number, y: number, spacing: number): boolean {
	const half = Math.trunc(spacing / 2);
	return (x - half) % spacing === 0 && (y - half) % spacing === 0;
}

/** Every exit in the rectangle, inclusive on every side. */
export function exitsIn(
	bounds: {minX: number; minY: number; maxX: number; maxY: number},
	spacing: number,
): {x: number; y: number}[] {
	const half = Math.trunc(spacing / 2);
	const first = (min: number) =>
		Math.ceil((min - half) / spacing) * spacing + half;
	const exits: {x: number; y: number}[] = [];
	for (let y = first(bounds.minY); y <= bounds.maxY; y += spacing) {
		for (let x = first(bounds.minX); x <= bounds.maxX; x += spacing) {
			exits.push({x, y});
		}
	}
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
