/**
 * WAITING FOR EVERY SEAT TO DEPLOY, in a world that seats them.
 *
 * Only armies are members (`docs/adr/0006-stake-erc20-reserve-exit-only.md`),
 * so the contract's cycle waits for nobody who has not deployed yet. In the
 * offline world every seat is known before the first cycle, and under its
 * manual cycle this client pushes the cycle on the moment every MEMBER has
 * acted: the first person at the device to deploy would turn the cycle over
 * before the second had picked a spawn point, and the seats the world plays
 * would race them. So that world names its seats here, and this client counts
 * each seat that has not created an army yet as a member still to commit.
 *
 * WHAT IT CHANGES IS ONLY WHEN THIS CLIENT ADVANCES. The contract still judges
 * every advance (anyone may send one), and the count is taken from the chain
 * each time: a seat that has deployed is no longer counted, whatever happened
 * to its deployment.
 *
 * KEYED BY CHAIN, because the app holds two contexts at once (the remote one
 * from the layout and a world's own), and a world's seats mean nothing on any
 * other chain. A world's chain id is minted for it.
 */
import type {Attendance} from '$lib/game/core/advance';

const awaited = new Map<number, readonly `0x${string}`[]>();

/**
 * Name the accounts whose first deployment the cycle on `chainId` waits for.
 * Returns the undo.
 */
export function awaitDeploymentsOf(
	chainId: number,
	accounts: readonly `0x${string}`[],
): () => void {
	awaited.set(chainId, accounts);
	return () => {
		if (awaited.get(chainId) === accounts) awaited.delete(chainId);
	};
}

/** The accounts named for `chainId`, if any. */
export function awaitedDeployersOn(chainId: number): readonly `0x${string}`[] {
	return awaited.get(chainId) ?? [];
}

/** The id of an account's first army (`1 << 160 | account`). */
export function firstArmyOf(account: `0x${string}`): bigint {
	return (1n << 160n) | BigInt(account);
}

/**
 * The attendance with each seat still to deploy counted as a member that has
 * not committed: what keeps `advancePermitted` from closing a commit phase on
 * a seat that has not had the chance to deploy.
 */
export function withAwaitedDeployments(
	attendance: Attendance,
	stillToDeploy: number,
): Attendance {
	if (stillToDeploy === 0) return attendance;
	return {...attendance, waitedFor: attendance.waitedFor + stillToDeploy};
}

/**
 * How many of `accounts` have not created an army: their next army is still
 * their first.
 */
export async function countStillToDeploy(params: {
	accounts: readonly `0x${string}`[];
	nextArmyOf: (account: `0x${string}`) => Promise<bigint>;
}): Promise<number> {
	const nexts = await Promise.all(params.accounts.map(params.nextArmyOf));
	return nexts.filter((next, i) => next === firstArmyOf(params.accounts[i]))
		.length;
}
