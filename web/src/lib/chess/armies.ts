/**
 * ARMIES: the registry's entries as the client reads them, and which army this
 * client plays.
 *
 * The registry is the contract's (`getArmy`, `getArmies`, `getArmiesOf`), and it
 * answers RESOLVED values, so nothing here works out a status: it reads one.
 * No indexer is involved (`docs/adr/0007-rules-live-only-in-the-contract.md`).
 */
import {derived, get, writable, type Readable} from 'svelte/store';
import type {Abi, PublicClient} from 'viem';
import type {ActiveIdentityStore, GameIdentity} from '$lib/game/identity';

/** `UsingGameTypes.ArmyStatus`, by value. The order is the contract's. */
export const ARMY_STATUS = {
	None: 0,
	Deploying: 1,
	Deployed: 2,
	Failed: 3,
	Unrevealed: 4,
	Cancelled: 5,
	/** Its king was taken: its pieces and stake are `mergedInto`'s now. */
	Captured: 6,
	/**
	 * Its king landed alone on an exit: its own pieces left the board, those it
	 * merged are rocks, and `stake` is what `exit(army)` still has to pay.
	 */
	Exited: 7,
	/**
	 * Frozen by a missed reveal: it stands on the board with its stake and can
	 * still be captured, but never moves again and its king cannot exit
	 * (`docs/adr/0005-missed-reveal-freezes-the-army.md`). Not played: its
	 * owner deploys again.
	 */
	Frozen: 8,
} as const;
export type ArmyStatus = (typeof ARMY_STATUS)[keyof typeof ARMY_STATUS];

/** One registry entry, as `getArmy` returns it. */
export type ArmyView = {
	id: bigint;
	owner: `0x${string}`;
	status: ArmyStatus;
	/** The cycle its deployment was committed in. */
	deployedIn: bigint;
	/** Where it was revealed; zero until then. */
	spawnPoint: bigint;
	/** Where its king stands, while it is deployed. */
	king: bigint;
	/**
	 * What it holds: its own stake plus those of the armies it merged in;
	 * zero once captured, its stake being its captor's then.
	 */
	stake: bigint;
	/** The army it plays for: itself, or once captured, the one it merged into. */
	mergedInto: bigint;
};

/** Normalise what viem hands back (numbers as `number`, ids as `bigint`). */
export function armyViewOf(raw: {
	id: bigint;
	owner: string;
	status: number;
	deployedIn: bigint;
	spawnPoint: bigint;
	king: bigint;
	stake: bigint;
	mergedInto: bigint;
}): ArmyView {
	return {
		id: raw.id,
		owner: raw.owner as `0x${string}`,
		status: raw.status as ArmyStatus,
		deployedIn: raw.deployedIn,
		spawnPoint: raw.spawnPoint,
		king: raw.king,
		stake: raw.stake,
		mergedInto: raw.mergedInto,
	};
}

/**
 * Whether an army can still act: committed this cycle, or on the board and
 * not frozen.
 */
export function isLive(army: Pick<ArmyView, 'status'>): boolean {
	return (
		army.status === ARMY_STATUS.Deploying ||
		army.status === ARMY_STATUS.Deployed
	);
}

/**
 * WHICH ARMY THIS CLIENT PLAYS, out of the account's.
 *
 * The most recent live one (deploying or deployed). With none, the account's
 * NEXT army: the id its deployment would create, which is what a deployment's
 * submission is keyed by before the army exists, so the same identity carries
 * the submission across its own creation. An army whose deployment failed or
 * was never revealed, or that a missed reveal froze, is not played: its owner
 * deploys again.
 */
export function chooseArmy(
	armies: readonly Pick<ArmyView, 'id' | 'status'>[],
	next: GameIdentity,
): GameIdentity {
	for (let i = armies.length - 1; i >= 0; i--) {
		if (isLive(armies[i])) return armies[i].id;
	}
	return next;
}

/**
 * WHAT BECAME OF THE ACCOUNT'S LAST DEPLOYMENT, when it is not playing: its most
 * recent army, if that one failed, was cancelled, was never revealed, had its
 * king taken, or froze. The
 * player is back at deployment then, and this is what to tell them.
 */
export function lastDeploymentOutcome<T extends Pick<ArmyView, 'status'>>(
	armies: readonly T[],
): T | undefined {
	const last = armies[armies.length - 1];
	if (!last || isLive(last)) return undefined;
	return last;
}

/**
 * The refund still to be WRITTEN for the account: the stake of its most recent
 * army when that deployment failed and nobody has settled it yet (the army
 * still holds its stake). The contract writes it on the account's next
 * deployment or withdrawal (`settleDeployment`), so it is as good as in the
 * account's reserve for either. Only the most recent army, which is the only
 * one those settle.
 */
export function pendingRefund(
	armies: readonly Pick<ArmyView, 'status' | 'stake'>[],
): bigint {
	const last = lastDeploymentOutcome(armies);
	return last?.status === ARMY_STATUS.Failed ? last.stake : 0n;
}

/**
 * The account's most recent army that has exited and is still owed a payout
 * (the registry reports what is still to be paid as its stake).
 */
export function unpaidExit<T extends Pick<ArmyView, 'status' | 'stake'>>(
	armies: readonly T[],
): T | undefined {
	for (let i = armies.length - 1; i >= 0; i--) {
		const army = armies[i];
		if (army.status === ARMY_STATUS.Exited && army.stake > 0n) return army;
	}
	return undefined;
}

export type ArmiesState =
	| {step: 'Unloaded'}
	| {
			step: 'Loaded';
			owner: `0x${string}`;
			/** Every army the owner created, oldest first. */
			armies: readonly ArmyView[];
			/** The id the owner's next deployment creates. */
			next: GameIdentity;
	  };

export type ArmiesStore = Readable<ArmiesState> & {
	/** The army this client plays, or undefined while nothing is loaded. */
	active: ActiveIdentityStore;
	/** The army this client plays, resolved, once it exists. */
	activeArmy: Readable<ArmyView | undefined>;
	/** The account's last deployment, while it failed, was cancelled or missed. */
	lastOutcome: Readable<ArmyView | undefined>;
	/** The refund the account's next deployment or withdrawal writes. */
	pendingRefund: Readable<bigint>;
	/** The account's army that has exited and is still owed its payout. */
	unpaidExit: Readable<ArmyView | undefined>;
	/** Read the account's armies again. */
	update(): Promise<void>;
};

export function createArmies(params: {
	publicClient: Pick<PublicClient, 'readContract'>;
	contract: {address: `0x${string}`; abi: Abi};
	/** WHO IS SIGNED IN: the account whose armies these are. */
	account: Readable<`0x${string}` | undefined>;
}): ArmiesStore {
	const {publicClient, contract, account} = params;
	const state = writable<ArmiesState>({step: 'Unloaded'});
	let reading = 0;

	async function read<T>(functionName: string, args: unknown[]): Promise<T> {
		return (await publicClient.readContract({
			address: contract.address,
			abi: contract.abi,
			functionName,
			args,
		} as never)) as T;
	}

	async function update() {
		const owner = get(account);
		const ticket = ++reading;
		if (!owner) {
			state.set({step: 'Unloaded'});
			return;
		}
		const [armies, next] = await Promise.all([
			read<readonly Parameters<typeof armyViewOf>[0][]>('getArmiesOf', [owner]),
			read<bigint>('getNextArmy', [owner]),
		]);
		// A read that started before a newer one, or for an account that is no
		// longer the one signed in, is stale: dropped rather than shown.
		if (ticket !== reading || get(account) !== owner) return;
		state.set({
			step: 'Loaded',
			owner,
			armies: armies.map(armyViewOf),
			next,
		});
	}

	const active: ActiveIdentityStore = derived(state, ($armies) =>
		$armies.step === 'Loaded'
			? chooseArmy($armies.armies, $armies.next)
			: undefined,
	);
	const activeArmy = derived(state, ($armies) => {
		if ($armies.step !== 'Loaded') return undefined;
		const id = chooseArmy($armies.armies, $armies.next);
		return $armies.armies.find((army) => army.id === id);
	});

	const lastOutcome = derived(state, ($armies) =>
		$armies.step === 'Loaded'
			? lastDeploymentOutcome($armies.armies)
			: undefined,
	);
	const refund = derived(state, ($armies) =>
		$armies.step === 'Loaded' ? pendingRefund($armies.armies) : 0n,
	);

	return {
		subscribe: state.subscribe,
		active,
		activeArmy,
		lastOutcome,
		pendingRefund: refund,
		unpaidExit: derived(state, ($armies) =>
			$armies.step === 'Loaded' ? unpaidExit($armies.armies) : undefined,
		),
		update,
	};
}
