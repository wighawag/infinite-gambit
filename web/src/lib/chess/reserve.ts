/**
 * What the ACCOUNT holds in reserve: stake bought and not yet deployed.
 *
 * TWO RESERVES, and this is the account's
 * (`docs/adr/0006-stake-erc20-reserve-exit-only.md`). It is freely withdrawable,
 * and it is what a deployment's commit takes the army's stake from. An army's
 * own reserve IS its stake, never withdrawn directly, and the registry reports
 * it (`./armies.ts`).
 *
 * The store is the base's (`$lib/game/core/commit-reveal/reserve`), keyed by
 * the account widened to the contract's `uint256`, the same id `StakeSale`
 * credits.
 */
import {derived, get, type Readable} from 'svelte/store';
import {
	createReserve as createBaseReserve,
	type ReserveDeps,
	type ReserveStore,
} from '$lib/game/core/commit-reveal/reserve';
import type {ChessConfig} from './config';
import {gameContract} from './commit-reveal';

export type {
	ReserveDeps,
	ReserveState,
	ReserveStore,
} from '$lib/game/core/commit-reveal/reserve';

/** The id an account's reserve is kept under: its address, widened. */
export function accountId(account: `0x${string}`): bigint {
	return BigInt(account);
}

export function createAccountReserve(params: {
	deps: ReserveDeps;
	config: ChessConfig;
	/** WHO IS SIGNED IN: whose reserve this is. */
	account: Readable<`0x${string}` | undefined>;
}): ReserveStore {
	const {deps, config} = params;
	return createBaseReserve<bigint>({
		deps,
		// Deployments are fixed for the life of the app.
		contract: gameContract(get(deps.deployments)),
		tokenAddress: config.tokenAddress,
		onchainIdentity: (id) => id,
		identity: derived(params.account, ($account) =>
			$account === undefined ? undefined : accountId($account),
		),
	});
}
