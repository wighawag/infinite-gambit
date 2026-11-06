import type {DeploymentsStore} from '$lib/deployments-store';
import type {EIP1193ProviderLike} from '$lib/embedded';
import {
	createPlayedKeys,
	createSerialisedLoop,
	type SerialisedLoop,
} from '$lib/game/core/played';
import {playedSeatSecret} from '$lib/game/core/secret';
import {
	RANDOM_LEVEL,
	decidePlayedTurn,
	seededRandom,
	type PlayedTurnStore,
	type Strategy,
} from '$lib/game/core/strategy';
import {createCycleReader} from '$lib/game/core/commit-reveal/cycle';
import {chunkDueNext} from '$lib/game/core/commit-reveal/chain';
import type {ChessConfig} from '$lib/chess/config';
import {
	bondFor,
	buildMoveChain,
	deploymentAt,
	type Move,
} from '$lib/chess/commit-reveal';
import {
	ARMY_STATUS,
	armyViewOf,
	chooseArmy,
	type ArmyView,
} from '$lib/chess/armies';

/**
 * THE OTHER PLAYERS IN THE OFFLINE WORLD, because a commit-reveal game with one
 * player is not one.
 *
 * WHY THE WORLD PLAYS THEM. Under the manual cycle policy nothing moves until
 * every waited-for member has acted, so a member that never acts does not make
 * a quiet game, it makes a FROZEN one. Either the world plays them or it must
 * not enrol them.
 *
 * WHAT A SEAT DOES, IN CHESS. Only armies are members, so a seat is nothing to
 * the cycle until it has deployed one (`docs/adr/0006-stake-erc20-reserve-exit-only.md`).
 * So a seat's first submission is a DEPLOYMENT, at an open spawn point it can
 * work out again at reveal time. After that, at the `greedy` level, it asks the
 * game's STRATEGY (`$lib/chess/strategy`, through `$lib/game/core/strategy`)
 * for one move each cycle, in the commit phase, and the move it decided is
 * STORED before it is committed, because a move that depends on the board
 * cannot be re-derived once the board has moved. At `random` it PASSES (an
 * empty submission) every cycle.
 *
 * A SEAT WHOSE ARMY IS GONE DEPLOYS ANOTHER. An account may own several armies
 * (`nonce << 160 | owner`), so a seat plays the most recent live army it OWNS,
 * and with none (its army failed to deploy, was captured, froze, or a capture
 * loop handed it to someone else) its NEXT army id, which is what it deploys
 * as. Everything a seat keeps is keyed by the army it is for (the derived
 * secret, the stored move), so a new army starts on new keys and leaves
 * nothing in flight behind: the old army is dead, and any commitment it still
 * holds from a past cycle is settled first. When the account's reserve cannot
 * pay for the new army (counting a failed deployment's refund the commit will
 * write), the seat buys a stake with its own play money, through the same
 * `StakeSale.purchase` provisioning used.
 *
 * IT DEPLOYS AT ONCE, and the cycle does not run away with it: the world names
 * every seat, the people's included, as deployments its cycle waits for
 * (`$lib/chess/awaited-deployments`), so no commit phase closes before each of
 * them has deployed.
 *
 * THEY HOLD NOTHING IN MEMORY, AND THAT IS THE LOAD-BEARING PROPERTY. The
 * secret is DERIVED from (chain, game, identity, cycle) and so is the spawn
 * point: the K-th open spawn point from the far end of the set the cycle STARTED
 * with, which reads the same at reveal time as at commit time. A reload
 * reconstructs both exactly, so a commitment is never left that this build
 * cannot open. AND BECAUSE IT IS DERIVED, THE DERIVATION IS A WIRE: a build that
 * changes it can no longer open what an earlier build committed, which under a
 * manual cycle is a frozen world. The commit path re-commits in the commit phase
 * whenever the head on chain is not one this build would have made.
 */

/** One player the world plays: a key it holds, and the army it plays as. */
export type OfflinePlayer = {
	privateKey: `0x${string}`;
	/** The account the key is. */
	address: `0x${string}`;
	/**
	 * Its FIRST army (`1 << 160 | address`), which it plays until that army is
	 * gone; then each later one in turn (see the module).
	 */
	identity: bigint;
	/**
	 * Which of the world's seats it is, from zero, so the seats deploy on
	 * different spawn points.
	 */
	seat: number;
	/** How it plays: absent means `random` (deploys, then passes). */
	level?: string;
};

/**
 * WHICH ARMY A SEAT PLAYS: the most recent live army its account still OWNS,
 * and with none, its next army id (which its next deployment creates). An army
 * a capture loop handed to another account is listed under its creator but
 * played by its new owner, so it does not count.
 */
export function armyToPlay(
	armies: readonly Pick<ArmyView, 'id' | 'status' | 'owner'>[],
	next: bigint,
	address: `0x${string}`,
): bigint {
	const owned = armies.filter(
		(army) => army.owner.toLowerCase() === address.toLowerCase(),
	);
	return chooseArmy(owned, next);
}

/**
 * Whether a seat must buy a stake before it can deploy: its account reserve,
 * plus the refund of a failed most recent deployment (which the deployment's
 * commit writes first), is less than one army's stake.
 */
export function needsStake(params: {
	reserve: bigint;
	last: Pick<ArmyView, 'status' | 'stake'> | undefined;
	stake: bigint;
}): boolean {
	const refund =
		params.last?.status === ARMY_STATUS.Failed ? params.last.stake : 0n;
	return params.reserve + refund < params.stake;
}

/** What `getCommitment` hands back. */
type Commitment = {hash: `0x${string}`; cycleNumber: bigint; bond: bigint};

/** `payee` on a commit or a reveal: nobody is being paid. */
const NO_PAYEE = '0x0000000000000000000000000000000000000000' as const;

/** No move: what an army's pass reveals. */
const PASS: readonly Move[] = [];

/**
 * WHERE A SEAT DEPLOYS, from the open set the cycle started with: seat `k`
 * takes the `k`th from the FAR end, so two seats never pick the same spawn
 * point and a person, who is likelier to pick one near the origin, rarely
 * collides with a seat. A fresh world's opening deployments of the PEOPLE use
 * the same rule, numbered after the world's seats (`$lib/offline-boot`).
 */
export function spawnPointForSeat(
	seat: number,
	spawnPoints: readonly bigint[],
): bigint | undefined {
	if (spawnPoints.length === 0) return undefined;
	return spawnPoints[
		Math.max(0, spawnPoints.length - 1 - (seat % spawnPoints.length))
	];
}

export function createOfflinePlayers(params: {
	provider: EIP1193ProviderLike;
	deployments: DeploymentsStore;
	config: ChessConfig;
	players: readonly OfflinePlayer[];
	/**
	 * How a seat at a level other than `random` decides its move. Without it
	 * (or without {@link turns}) every seat passes once deployed.
	 */
	strategy?: Strategy<Move>;
	/** Where a decided move is kept between its commit and its reveal. */
	turns?: PlayedTurnStore<Move>;
	/** How often to look. The framework's loop owns the default. */
	pollInterval?: number;
	/** Called after a pass in which a player actually SENT something. */
	onActed?: () => void;
}): SerialisedLoop {
	const {provider, deployments, config, players, strategy, turns} = params;

	const records = deployments.get();
	const game = {
		address: records.contracts.Game.address,
		abi: records.contracts.Game.abi,
	};
	const sale = {
		address: config.sale.address,
		abi: records.contracts.StakeSale.abi,
	};
	const chain = {
		id: records.chain.id,
		name: records.chain.name,
		nativeCurrency: records.chain.nativeCurrency,
		rpcUrls: {default: {http: [] as string[]}},
	};

	const keys = createPlayedKeys({provider, chain, contract: game});
	const publicClient = keys.publicClient;
	const readCycle = createCycleReader({publicClient, contract: game});

	async function read<T>(functionName: string, args: unknown[]): Promise<T> {
		return (await publicClient.readContract({
			...game,
			functionName,
			args,
		} as never)) as T;
	}

	const send = (player: OfflinePlayer, request: Record<string, unknown>) =>
		keys.send(player.privateKey, request);

	const secretFor = (identity: bigint, cycleNumber: number) =>
		playedSeatSecret({
			chainId: records.chain.id,
			contract: game.address,
			identity,
			cycleNumber,
		});

	const chainOf = (actions: readonly Move[], secret: `0x${string}`) =>
		buildMoveChain({
			actions,
			secret,
			actionsPerReveal: config.actionsPerReveal,
		});

	/** Whether this seat asks the strategy rather than passing. */
	function decides(player: OfflinePlayer): boolean {
		return (
			strategy !== undefined &&
			turns !== undefined &&
			(player.level ?? RANDOM_LEVEL) !== RANDOM_LEVEL
		);
	}

	/** The move this seat stored for an army in a cycle, if it decided one. */
	function storedTurn(
		player: OfflinePlayer,
		identity: bigint,
		cycleNumber: number,
	): readonly Move[] | undefined {
		return decides(player) ? turns?.get(identity, cycleNumber) : undefined;
	}

	/**
	 * The move a deployed army makes this cycle: the strategy's, decided once
	 * and stored before it is returned, so a commit never carries a move that
	 * is not stored. A strategy that throws (its sandbox did not start, a read
	 * failed) is answered with a pass, stored in its place: a seat that cannot
	 * decide still commits, because a seat that does not commit holds up the
	 * cycle.
	 */
	async function turnFor(
		player: OfflinePlayer,
		identity: bigint,
		cycleNumber: number,
	): Promise<readonly Move[]> {
		if (!decides(player) || !strategy || !turns) return PASS;
		return decidePlayedTurn({
			store: turns,
			strategy: async (input) => {
				try {
					return await strategy(input);
				} catch (err) {
					console.warn(
						'an offline player could not decide its move, and passes',
						err,
					);
					return PASS;
				}
			},
			identity,
			cycleNumber,
			level: player.level ?? RANDOM_LEVEL,
			random: seededRandom({
				chainId: records.chain.id,
				contract: game.address,
				identity,
				cycleNumber,
			}),
			// One move per army per cycle, of up to the game's cap of piece-moves
			// (the strategy reads it, `docs/adr/0016`): what the seat pays for is
			// one reveal transaction, which carries `actionsPerReveal` of them.
			budget: {actionsAtMost: config.actionsPerReveal},
		});
	}

	/** The deployment this seat makes in this cycle, from its open set. */
	async function deploymentFor(
		player: OfflinePlayer,
	): Promise<readonly Move[] | undefined> {
		const [open] = await read<readonly [readonly bigint[], bigint]>(
			'getOpenSpawnPoints',
			[],
		);
		const spawnPoint = spawnPointForSeat(player.seat, open);
		return spawnPoint === undefined ? undefined : deploymentAt(spawnPoint);
	}

	/**
	 * Every submission this file could have committed for an army in a cycle:
	 * its deployment (when it was deploying then), the move it stored, and a
	 * pass. The hash decides.
	 */
	async function candidates(
		player: OfflinePlayer,
		army: ArmyView | undefined,
		identity: bigint,
		cycleNumber: number,
	): Promise<(readonly Move[])[]> {
		const deploying =
			army?.status === ARMY_STATUS.Deploying &&
			Number(army.deployedIn) === cycleNumber;
		const deployment = deploying ? await deploymentFor(player) : undefined;
		const stored = storedTurn(player, identity, cycleNumber);
		return [
			...(deployment ? [deployment] : []),
			...(stored ? [stored] : []),
			PASS,
		];
	}

	/**
	 * Make sure the account can pay for its next army: buy one stake with the
	 * seat's own play money when its reserve (and a pending refund) falls short.
	 */
	async function fund(
		player: OfflinePlayer,
		last: ArmyView | undefined,
	): Promise<void> {
		const reserve = await read<bigint>('getReserve', [BigInt(player.address)]);
		if (!needsStake({reserve, last, stake: config.stake})) return;
		await send(player, {
			...sale,
			functionName: 'purchase',
			// No stipend and no key to forward it to: the seat's own key pays its
			// gas, and the sale refuses a stipend with nowhere to go.
			args: [player.address, NO_PAYEE, 0n],
			value: config.sale.price,
		});
	}

	async function commit(
		player: OfflinePlayer,
		army: ArmyView | undefined,
		identity: bigint,
		last: ArmyView | undefined,
		cycleNumber: number,
		onChain: Commitment,
	): Promise<void> {
		const secret = secretFor(identity, cycleNumber);
		let actions: readonly Move[];
		if (army === undefined) {
			const deployment = await deploymentFor(player);
			if (!deployment) return;
			await fund(player, last);
			actions = deployment;
		} else if (
			army.status === ARMY_STATUS.Deploying &&
			Number(army.deployedIn) === cycleNumber
		) {
			// Its deployment, committed this cycle: re-made below only if the head
			// on chain is not the one this build would have made.
			actions = (await deploymentFor(player)) ?? PASS;
		} else if (army.status === ARMY_STATUS.Deployed) {
			actions = await turnFor(player, identity, cycleNumber);
		} else {
			actions = PASS;
		}
		const chainOfActions = chainOf(actions, secret);

		// ALREADY DONE, OR DONE WRONG: a commitment this build cannot open would
		// freeze the army once the reveal phase opened, and the commit phase is
		// the only phase in which anything can still be done about it. Replacing a
		// commitment made in the same cycle is counted once.
		if (
			Number(onChain.cycleNumber) === cycleNumber &&
			onChain.hash.toLowerCase() === chainOfActions[0].hash.toLowerCase()
		) {
			return;
		}

		await send(player, {
			functionName: 'makeCommitment',
			args: [
				identity,
				chainOfActions[0].hash,
				bondFor(config, actions),
				NO_PAYEE,
			],
			gas: config.gas.commit,
		});
	}

	async function reveal(
		player: OfflinePlayer,
		army: ArmyView | undefined,
		identity: bigint,
		cycleNumber: number,
		onChain: Commitment,
	): Promise<void> {
		// Nothing committed in this cycle means nothing owed.
		if (Number(onChain.cycleNumber) !== cycleNumber) return;
		const secret = secretFor(identity, cycleNumber);
		for (const actions of await candidates(
			player,
			army,
			identity,
			cycleNumber,
		)) {
			const chainOfActions = chainOf(actions, secret);
			const from = chunkDueNext(chainOfActions, onChain.hash);
			if (from === undefined) continue;
			for (let i = from; i < chainOfActions.length; i++) {
				await send(player, {
					functionName: 'reveal',
					args: [
						identity,
						chainOfActions[i].actions,
						secret,
						chainOfActions[i].furtherActions,
						NO_PAYEE,
					],
					gas: config.gas.reveal,
				});
			}
			return;
		}
		console.warn(
			'an offline player is holding a commitment this build cannot open, so the cycle cannot close',
			{identity, cycleNumber},
		);
	}

	/**
	 * Settle a commitment from a past cycle: shown, which costs nothing more,
	 * when it was a pass or the move this seat stored; otherwise without the
	 * chunks. A missed deployment cannot be rebuilt once its cycle is over (the
	 * open set has moved on), and forfeiting its stake is what it costs anyway.
	 */
	async function settle(
		player: OfflinePlayer,
		identity: bigint,
		onChain: Commitment,
	): Promise<void> {
		const cycleNumber = Number(onChain.cycleNumber);
		const secret = secretFor(identity, cycleNumber);
		const stored = storedTurn(player, identity, cycleNumber);
		for (const actions of [...(stored ? [stored] : []), PASS]) {
			const chainOfActions = chainOf(actions, secret);
			if (chunkDueNext(chainOfActions, onChain.hash) !== undefined) {
				await send(player, {
					functionName: 'acknowledgeMissedReveal',
					args: [
						identity,
						chainOfActions[0].actions,
						secret,
						chainOfActions[0].furtherActions,
					],
					gas: config.gas.reveal,
				});
				return;
			}
		}
		await send(player, {
			functionName: 'forfeitMissedReveal',
			args: [identity],
		});
	}

	/** Whether `onChain` is a commitment from a cycle before `cycleNumber`. */
	const isStale = (onChain: Commitment, cycleNumber: number) =>
		onChain.cycleNumber !== 0n && Number(onChain.cycleNumber) < cycleNumber;

	async function act(
		player: OfflinePlayer,
		cycle: {cycleNumber: number; commiting: boolean},
	): Promise<void> {
		const [rawArmies, next] = await Promise.all([
			read<readonly Parameters<typeof armyViewOf>[0][]>('getArmiesOf', [
				player.address,
			]),
			read<bigint>('getNextArmy', [player.address]),
		]);
		const armies = rawArmies.map(armyViewOf);
		const identity = armyToPlay(armies, next, player.address);
		const army = armies.find((candidate) => candidate.id === identity);
		const owned = armies.filter(
			(candidate) =>
				candidate.owner.toLowerCase() === player.address.toLowerCase(),
		);
		const last = owned[owned.length - 1];

		// A COMMITMENT FROM A PAST CYCLE IS SETTLED RATHER THAN CARRIED: the
		// contract refuses every later commitment until it is. The army played,
		// and the account's most recent one when that is a dead army (a seat
		// moves on to a new army only once the old one cannot act).
		for (const id of new Set([
			...(army ? [identity] : []),
			...(last ? [last.id] : []),
		])) {
			const onChain = await read<Commitment>('getCommitment', [id]);
			if (isStale(onChain, cycle.cycleNumber)) {
				await settle(player, id, onChain);
				return;
			}
		}

		const onChain = await read<Commitment>('getCommitment', [identity]);
		if (cycle.commiting) {
			await commit(player, army, identity, last, cycle.cycleNumber, onChain);
		} else {
			await reveal(player, army, identity, cycle.cycleNumber, onChain);
		}
	}

	async function pass(): Promise<boolean> {
		const before = keys.sends();
		try {
			const cycle = await readCycle();
			const at = {
				cycleNumber: cycle.cycleNumber,
				commiting: cycle.isCommitPhase,
			};
			// IN SEQUENCE: one chain in one worker, and a revert stops the pass
			// rather than being one rejected promise among several.
			for (const player of players) {
				await act(player, at);
			}
		} catch (err) {
			// These players have no UI: the next pass sees the same chain and
			// tries again, which is right for every transient cause.
			console.warn('an offline player could not act this pass', err);
		}
		return keys.sends() > before;
	}

	return createSerialisedLoop({
		pass,
		onActed: params.onActed,
		pollInterval: params.pollInterval,
	});
}
