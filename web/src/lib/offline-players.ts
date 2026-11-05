import type {DeploymentsStore} from '$lib/deployments-store';
import type {EIP1193ProviderLike} from '$lib/embedded';
import {
	createPlayedKeys,
	createSerialisedLoop,
	type SerialisedLoop,
} from '$lib/game/core/played';
import {playedSeatSecret} from '$lib/game/core/secret';
import {createCycleReader} from '$lib/game/core/commit-reveal/cycle';
import {chunkDueNext} from '$lib/game/core/commit-reveal/chain';
import type {ChessConfig} from '$lib/chess/config';
import {
	bondFor,
	buildMoveChain,
	deploymentAt,
	type Move,
} from '$lib/chess/commit-reveal';
import {ARMY_STATUS, armyViewOf, type ArmyView} from '$lib/chess/armies';

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
 * work out again at reveal time; after that it PASSES (an empty submission)
 * every cycle, until the greedy bot (`chess-greedy-bot`) gives it moves.
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
	/** The army it plays as: its first (`nonce << 160 | address`). */
	identity: bigint;
	/**
	 * Which of the world's seats it is, from zero, so the seats deploy on
	 * different spawn points.
	 */
	seat: number;
	/** How it plays: absent means `random`, the only level there is yet. */
	level?: string;
};

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
 * collides with a seat.
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
	/** How often to look. The framework's loop owns the default. */
	pollInterval?: number;
	/** Called after a pass in which a player actually SENT something. */
	onActed?: () => void;
}): SerialisedLoop {
	const {provider, deployments, config, players} = params;

	const records = deployments.get();
	const game = {
		address: records.contracts.Game.address,
		abi: records.contracts.Game.abi,
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

	const secretFor = (player: OfflinePlayer, cycleNumber: number) =>
		playedSeatSecret({
			chainId: records.chain.id,
			contract: game.address,
			identity: player.identity,
			cycleNumber,
		});

	const chainOf = (actions: readonly Move[], secret: `0x${string}`) =>
		buildMoveChain({
			actions,
			secret,
			actionsPerReveal: config.actionsPerReveal,
		});

	async function armyOf(player: OfflinePlayer): Promise<ArmyView> {
		return armyViewOf(await read('getArmy', [player.identity]));
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
	 * Every submission this file could have committed for a seat in a cycle: its
	 * deployment (when it was deploying then) and a pass. The hash decides.
	 */
	async function candidates(
		player: OfflinePlayer,
		army: ArmyView,
		cycleNumber: number,
	): Promise<(readonly Move[])[]> {
		const deploying =
			army.status === ARMY_STATUS.Deploying &&
			Number(army.deployedIn) === cycleNumber;
		const deployment = deploying ? await deploymentFor(player) : undefined;
		return deployment ? [deployment, PASS] : [PASS];
	}

	async function commit(
		player: OfflinePlayer,
		army: ArmyView,
		cycleNumber: number,
		onChain: Commitment,
	): Promise<void> {
		const secret = secretFor(player, cycleNumber);
		let actions: readonly Move[];
		if (army.status === ARMY_STATUS.None) {
			const deployment = await deploymentFor(player);
			if (!deployment) return;
			actions = deployment;
		} else if (
			army.status === ARMY_STATUS.Deploying &&
			Number(army.deployedIn) === cycleNumber
		) {
			// Its deployment, committed this cycle: re-made below only if the head
			// on chain is not the one this build would have made.
			actions = (await deploymentFor(player)) ?? PASS;
		} else {
			actions = PASS;
		}
		const chainOfActions = chainOf(actions, secret);

		// ALREADY DONE, OR DONE WRONG: a commitment this build cannot open would
		// freeze the world once the reveal phase opened, and the commit phase is
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
				player.identity,
				chainOfActions[0].hash,
				bondFor(config, actions),
				NO_PAYEE,
			],
			gas: config.gas.commit,
		});
	}

	async function reveal(
		player: OfflinePlayer,
		army: ArmyView,
		cycleNumber: number,
		onChain: Commitment,
	): Promise<void> {
		// Nothing committed in this cycle means nothing owed.
		if (Number(onChain.cycleNumber) !== cycleNumber) return;
		const secret = secretFor(player, cycleNumber);
		for (const actions of await candidates(player, army, cycleNumber)) {
			const chainOfActions = chainOf(actions, secret);
			const from = chunkDueNext(chainOfActions, onChain.hash);
			if (from === undefined) continue;
			for (let i = from; i < chainOfActions.length; i++) {
				await send(player, {
					functionName: 'reveal',
					args: [
						player.identity,
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
			{identity: player.identity, cycleNumber},
		);
	}

	/**
	 * Settle a commitment from a past cycle: shown a pass, which costs nothing,
	 * when that is what it was; otherwise without the chunks. A missed
	 * deployment cannot be rebuilt once its cycle is over (the open set has
	 * moved on), and forfeiting its stake is what it costs anyway.
	 */
	async function settle(
		player: OfflinePlayer,
		onChain: Commitment,
	): Promise<void> {
		const cycleNumber = Number(onChain.cycleNumber);
		const secret = secretFor(player, cycleNumber);
		const pass = chainOf(PASS, secret);
		if (chunkDueNext(pass, onChain.hash) !== undefined) {
			await send(player, {
				functionName: 'acknowledgeMissedReveal',
				args: [player.identity, PASS, secret, pass[0].furtherActions],
				gas: config.gas.reveal,
			});
			return;
		}
		await send(player, {
			functionName: 'forfeitMissedReveal',
			args: [player.identity],
		});
	}

	async function act(
		player: OfflinePlayer,
		cycle: {cycleNumber: number; commiting: boolean},
	): Promise<void> {
		const [onChain, army] = await Promise.all([
			read<Commitment>('getCommitment', [player.identity]),
			armyOf(player),
		]);

		// A COMMITMENT FROM A PAST CYCLE IS SETTLED RATHER THAN CARRIED: the
		// contract refuses every later commitment until it is.
		if (
			onChain.cycleNumber !== 0n &&
			Number(onChain.cycleNumber) < cycle.cycleNumber
		) {
			await settle(player, onChain);
			return;
		}

		if (cycle.commiting) {
			await commit(player, army, cycle.cycleNumber, onChain);
		} else {
			await reveal(player, army, cycle.cycleNumber, onChain);
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
