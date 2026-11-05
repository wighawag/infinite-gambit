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
	/** What it holds. */
	stake: bigint;
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
}): ArmyView {
	return {
		id: raw.id,
		owner: raw.owner as `0x${string}`,
		status: raw.status as ArmyStatus,
		deployedIn: raw.deployedIn,
		spawnPoint: raw.spawnPoint,
		king: raw.king,
		stake: raw.stake,
	};
}

/** Whether an army can still act: committed this cycle, or on the board. */
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
 * was never revealed is not played: its owner deploys again.
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

	return {subscribe: state.subscribe, active, activeArmy, update};
}
