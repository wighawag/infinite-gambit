/**
 * A TABLE'S PAYOUT: what the army this client plays is owed once the table is
 * over (`work/specs/tasked/infinite-chess.md`, stories 40 and 41).
 *
 * The outcome is the contract's to say (`getTableOutcome`, `getTableShare`):
 * the last king standing takes every stake, and at the cycle cap the stakes
 * are split by the material each standing army has left. Nothing here works
 * either out. The payout itself is `claim(army)`, sent by `./exits.ts`'s
 * payout store, which anyone may send and which always pays the army's owner.
 */
import {derived, get, writable, type Readable} from 'svelte/store';
import type {PublicClient} from 'viem';
import type {CommitRevealContract} from '$lib/game/core/commit-reveal/contract';
import {ARMY_STATUS, type ArmyView} from './armies';

/** `IGameTable.getTableOutcome`, as viem hands it back. */
export type TableOutcome = {
	over: boolean;
	settled: boolean;
	tallied: boolean;
	winner: bigint;
	pot: bigint;
	totalMaterial: bigint;
};

/** What the played army may claim, while it may. */
export type TableClaim = {
	army: bigint;
	/** Whether it is the last king standing, which takes every stake. */
	winner: boolean;
	/** Its share, once the first claim has written the outcome; else unknown. */
	share: bigint | undefined;
};

/**
 * WHETHER TO OFFER A CLAIM: the table is over, the army is not paid, and it
 * can be owed something. A settled outcome says exactly what (a zero share
 * offers nothing). Before the first claim writes it, only the last king
 * standing is known to be owed; at the cap any army still standing may be,
 * its share counted by the claim.
 */
export function tableClaimOf(params: {
	army: Pick<ArmyView, 'id' | 'status'> | undefined;
	outcome: TableOutcome | undefined;
	share: bigint;
	paid: boolean;
}): TableClaim | undefined {
	const {army, outcome, share, paid} = params;
	if (!army || !outcome?.over || paid) return undefined;
	const winner = outcome.winner === army.id;
	if (outcome.settled) {
		return share > 0n ? {army: army.id, winner, share} : undefined;
	}
	if (outcome.winner !== 0n) {
		return winner ? {army: army.id, winner, share: undefined} : undefined;
	}
	const standing =
		army.status === ARMY_STATUS.Deployed || army.status === ARMY_STATUS.Frozen;
	return standing ? {army: army.id, winner, share: undefined} : undefined;
}

export type TableClaimStore = Readable<TableClaim | undefined> & {
	/** Read the outcome and the army's share again. */
	update(): Promise<void>;
};

export function createTableClaim(params: {
	publicClient: Pick<PublicClient, 'readContract'>;
	contract: CommitRevealContract;
	/** The army this client plays, resolved. */
	army: Readable<Pick<ArmyView, 'id' | 'status'> | undefined>;
}): TableClaimStore {
	const {publicClient, contract} = params;
	const read = <T>(functionName: string, args: unknown[] = []) =>
		publicClient.readContract({
			address: contract.address,
			abi: contract.abi,
			functionName,
			args,
		} as never) as Promise<T>;
	const facts = writable<
		| {id: bigint; outcome: TableOutcome; share: bigint; paid: boolean}
		| undefined
	>(undefined);

	async function update() {
		const army = get(params.army);
		if (!army) return;
		const [outcome, [share, paid]] = await Promise.all([
			read<TableOutcome>('getTableOutcome'),
			read<readonly [bigint, boolean]>('getTableShare', [army.id]),
		]);
		facts.set({id: army.id, outcome, share, paid});
	}

	const claim = derived([params.army, facts], ([$army, $facts]) =>
		$facts && $army && $facts.id === $army.id
			? tableClaimOf({army: $army, ...$facts})
			: undefined,
	);
	return {subscribe: claim.subscribe, update};
}
