import {createPublicClient, custom} from 'viem';
import type {DeploymentsStore} from '$lib/deployments-store';
import type {EIP1193ProviderLike} from '$lib/embedded';
import {advancePermitted} from '$lib/game/core/advance';
import {playedSeatSecret} from '$lib/game/core/secret';
import {createCycleReader} from '$lib/game/core/commit-reveal/cycle';
import {chunkDueNext} from '$lib/game/core/commit-reveal/chain';
import type {ChessConfig} from '$lib/chess/config';
import {bondFor, buildMoveChain, deploymentAt} from '$lib/chess/commit-reveal';
import {ARMY_STATUS, armyViewOf, type ArmyView} from '$lib/chess/armies';
import {
	countStillToDeploy,
	firstArmyOf,
	withAwaitedDeployments,
} from '$lib/chess/awaited-deployments';
import {spawnPointForSeat} from '$lib/offline-players';

/**
 * THE OPENING OF A FRESH OFFLINE WORLD: every seat, the people at this device
 * included, already has an army on the board when the board first shows.
 *
 * WHY. On one device a hidden spawn choice buys nothing, and leaving the person
 * to pick one made them collide with the seats the world plays (which deploy
 * on their own, from the far end of the open set): both deployments failed by
 * count, the seat redeployed, and the person had to deploy again. So the world
 * starts the way a table does. Online, deployment stays hidden and chosen.
 *
 * HOW, AND WHY ONLY THE HUMANS ARE DEPLOYED HERE. The machine seats keep
 * deploying through their own loop (`$lib/offline-players`), which rebuilds a
 * seat's deployment from `spawnPointForSeat(seat, open)` and its derived
 * secret at commit AND at reveal: that is a WIRE, so a boot that placed a
 * machine seat itself would leave a commitment the loop replaces or cannot
 * open. The boot only drives the cycle (one tick of that loop per step, and the
 * advances) so their deployments land in the same boot. Each human seat gets a
 * seat number AFTER the machine seats' (see {@link humanBootSeat}), so every
 * seat gets a distinct spawn point by the same rule, as long as the world opens
 * at least as many spawn points as it has seats (`OFFLINE_DEPLOYMENT`).
 *
 * THE PERSON'S SECRET IS DERIVED, with the existing `playedSeatSecret` on that
 * seat's FIRST army id, which no machine seat ever uses. So nothing of the boot
 * is kept in storage, and no new derivation is added: a reload rebuilds every
 * commitment it made from the chain and the seat number alone. AND IT DECIDES
 * FROM THE CHAIN, never from a flag: a seat with no army is deployed, a
 * deployment of its first army still owed a reveal is revealed, and anything
 * else (a deployed army, a later army, a commitment this boot did not make) is
 * left to the game, so a restored world that already has its armies deploys
 * nothing and a world interrupted at any point of the boot finishes it. An
 * unrevealed deployment BURNS its stake, which is why the finishing matters.
 *
 * IT NEVER REPLACES A COMMITMENT: it commits only for a seat with no army at
 * all, so a deployment the person committed themselves (in an earlier build) is
 * theirs to open.
 */

/** One person at this device, as the boot deploys them. */
export type BootHuman = {
	/** Their account, which owns their army and signs the boot's sends. */
	address: `0x${string}`;
	/** The seat number their spawn point is counted from (`humanBootSeat`). */
	seat: number;
};

/**
 * THE SEAT NUMBER A PERSON'S OPENING DEPLOYMENT IS COUNTED FROM: after every
 * seat the world plays (which are numbered `0..played - 1` among themselves,
 * `playedByTheWorld`), so no two seats of a table share one, and the machine
 * seats' numbers (part of their wire) stay what they were. `index` is the
 * person's place among the humans at this device, `you` first.
 *
 * Counted from the far end like every seat, so the people get the spawn points
 * nearest the origin once the world's seats have taken theirs.
 *
 * A WIRE FOR THE LENGTH OF ONE BOOT: an interrupted boot reveals the person's
 * deployment by rebuilding it from this number.
 */
export function humanBootSeat(index: number, played: number): number {
	return played + index;
}

/** What `getCommitment` hands back. */
type Commitment = {hash: `0x${string}`; cycleNumber: bigint; bond: bigint};

/** `payee` on a commit or a reveal: nobody is being paid. */
const NO_PAYEE = '0x0000000000000000000000000000000000000000' as const;

/** How many steps (a commit or reveal pass, then an advance) the boot may take. */
const MOST_STEPS = 12;

/**
 * Deploy every human seat of a fresh world, and drive the cycle until their
 * deployments (and the machine seats' beside them) are on the board.
 *
 * Returns how many transactions it sent for the people (0 on a restore that
 * needed nothing). Throws when the boot cannot finish, so the world is not
 * shown half-booted; a reload runs it again and it carries on from the chain.
 */
export async function deployEverySeat(params: {
	provider: EIP1193ProviderLike;
	deployments: DeploymentsStore;
	config: ChessConfig;
	humans: readonly BootHuman[];
	/**
	 * Every account whose first deployment the cycle must wait for: the people
	 * and the seats the world plays (`awaitDeploymentsOf`). No advance is sent
	 * while one of them has not deployed.
	 */
	seats: readonly `0x${string}`[];
	/**
	 * Send one call to the game as a person's account, and resolve once it is
	 * mined; throw when it reverts. `request` is merged over the game contract.
	 */
	sendAs: (
		address: `0x${string}`,
		request: Record<string, unknown>,
	) => Promise<void>;
	/** The machine seats' loop: one pass per step. */
	machines: {tick(): Promise<void>};
}): Promise<number> {
	const {provider, deployments, config, humans, sendAs, machines} = params;
	const records = deployments.get();
	const game = {
		address: records.contracts.Game.address,
		abi: records.contracts.Game.abi,
	};
	const publicClient = createPublicClient({
		chain: {
			id: records.chain.id,
			name: records.chain.name,
			nativeCurrency: records.chain.nativeCurrency,
			rpcUrls: {default: {http: [] as string[]}},
		},
		transport: custom(provider as never),
	});
	const readCycle = createCycleReader({publicClient, contract: game});
	const read = async <T>(functionName: string, args: unknown[] = []) =>
		(await publicClient.readContract({
			...game,
			functionName,
			args,
		} as never)) as T;

	const chainFor = (human: BootHuman, cycleNumber: number, open: bigint[]) => {
		const spawnPoint = spawnPointForSeat(human.seat, open);
		if (spawnPoint === undefined) return undefined;
		const actions = deploymentAt(spawnPoint);
		const secret = playedSeatSecret({
			chainId: records.chain.id,
			contract: game.address,
			identity: firstArmyOf(human.address),
			cycleNumber,
		});
		return {
			actions,
			secret,
			chain: buildMoveChain({
				actions,
				secret,
				actionsPerReveal: config.actionsPerReveal,
			}),
		};
	};

	/**
	 * What the boot still owes a person: `commit` when they have no army;
	 * `reveal` when their first army is deploying in this cycle under a
	 * commitment this boot made and the reveal phase is open; `advance` when
	 * that deployment is committed (or already opened) and only the cycle has
	 * to move on for it to stand on the board; nothing otherwise.
	 */
	async function owed(
		human: BootHuman,
		cycle: {cycleNumber: number; isCommitPhase: boolean},
		open: bigint[],
	): Promise<'commit' | 'advance' | {reveal: number} | undefined> {
		const {cycleNumber} = cycle;
		const army = firstArmyOf(human.address);
		const next = await read<bigint>('getNextArmy', [human.address]);
		if (next === army) return 'commit';
		const view: ArmyView = armyViewOf(
			await read<Parameters<typeof armyViewOf>[0]>('getArmy', [army]),
		);
		if (view.status !== ARMY_STATUS.Deploying) return undefined;
		if (Number(view.deployedIn) !== cycleNumber) return undefined;
		const onChain = await read<Commitment>('getCommitment', [army]);
		// Opened in full: the base clears the commitment's cycle.
		if (onChain.cycleNumber === 0n) return 'advance';
		if (Number(onChain.cycleNumber) !== cycleNumber) return undefined;
		const ours = chainFor(human, cycleNumber, open);
		const from = ours && chunkDueNext(ours.chain, onChain.hash);
		// A commitment this boot did not make is the person's own to open.
		if (from === undefined) return undefined;
		return cycle.isCommitPhase ? 'advance' : {reveal: from};
	}

	let sent = 0;
	for (let step = 0; step < MOST_STEPS; step++) {
		const cycle = await readCycle();
		// THE SET THE CYCLE STARTED WITH, which reads the same at reveal time as
		// at commit time: the same reading the machine seats deploy from.
		const [open] =
			await read<readonly [readonly bigint[], bigint]>('getOpenSpawnPoints');
		const debts = await Promise.all(
			humans.map((human) => owed(human, cycle, [...open])),
		);
		if (debts.every((debt) => debt === undefined)) return sent;

		for (const [i, human] of humans.entries()) {
			const debt = debts[i];
			if (debt === undefined || debt === 'advance') continue;
			const ours = chainFor(human, cycle.cycleNumber, [...open]);
			if (!ours) throw new Error('the offline world opens no spawn point');
			if (debt === 'commit') {
				// A seat with no army waits for the next commit phase.
				if (!cycle.isCommitPhase) continue;
				await sendAs(human.address, {
					functionName: 'makeCommitment',
					args: [
						firstArmyOf(human.address),
						ours.chain[0].hash,
						bondFor(config, ours.actions),
						NO_PAYEE,
					],
					gas: config.gas.commit,
				});
				sent++;
			} else {
				for (let c = debt.reveal; c < ours.chain.length; c++) {
					await sendAs(human.address, {
						functionName: 'reveal',
						args: [
							firstArmyOf(human.address),
							ours.chain[c].actions,
							ours.secret,
							ours.chain[c].furtherActions,
							NO_PAYEE,
						],
						gas: config.gas.reveal,
					});
					sent++;
				}
			}
		}

		await machines.tick();

		const attendance = await read<{
			waitedFor: bigint;
			committed: bigint;
			revealed: bigint;
		}>('getAttendance');
		const stillToDeploy = await countStillToDeploy({
			accounts: params.seats,
			nextArmyOf: (account) => read<bigint>('getNextArmy', [account]),
		});
		const verdict = advancePermitted({
			policy: config.cycle.policy,
			isCommitPhase: cycle.isCommitPhase,
			attendance: withAwaitedDeployments(
				{
					waitedFor: Number(attendance.waitedFor),
					committed: Number(attendance.committed),
					revealed: Number(attendance.revealed),
				},
				stillToDeploy,
			),
		});
		if (verdict.permitted && humans[0]) {
			await sendAs(humans[0].address, {
				functionName: 'advanceCycle',
				args: [],
			});
		}
	}
	throw new Error(
		'the offline world could not deploy every seat; reloading carries on',
	);
}
