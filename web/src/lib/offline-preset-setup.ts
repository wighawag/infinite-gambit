import {createPublicClient, custom, encodePacked, keccak256} from 'viem';
import type {DeploymentsStore} from '$lib/deployments-store';
import type {EIP1193ProviderLike} from '$lib/embedded';
import {createCycleReader} from '$lib/game/core/commit-reveal/cycle';
import type {ChessConfig} from '$lib/chess/config';
import {
	bondFor,
	buildMoveChain,
	deploymentAt,
	type Move,
} from '$lib/chess/commit-reveal';
import {ARMY_STATUS, armyViewOf} from '$lib/chess/armies';
import {firstArmyOf} from '$lib/chess/awaited-deployments';

/**
 * PLAY A PRESET'S SETUP THROUGH THE REAL CONTRACT (`$lib/offline-presets`):
 * deploy every army on its spawn point in one cycle, then play each setup
 * cycle, every army committing (its moves, or a pass), the cycle advanced,
 * every commitment revealed and the cycle advanced again. The same calls a
 * player makes, in the same order, so a position the rules do not allow
 * reverts here rather than appearing on the board.
 *
 * ON A FRESH WORLD ONLY, AND FINISHED BEFORE THE BOARD SHOWS. A preset world
 * is never persisted (`$lib/offline`), so there is no restore to finish and no
 * secret to keep: each commitment's secret is derived here and forgotten once
 * its reveal is mined. Nothing of the setup is left in flight: every
 * commitment it made is opened, so the first cycle the people see is a clean
 * commit phase.
 */

/** One army of the setup: who owns it (and signs for it), where it deploys. */
export type SetupArmy = {owner: `0x${string}`; spawnPoint: bigint};

/** What `getCommitment` hands back. */
type Commitment = {hash: `0x${string}`; cycleNumber: bigint; bond: bigint};

/** `payee` on a commit or a reveal: nobody is being paid. */
const NO_PAYEE = '0x0000000000000000000000000000000000000000' as const;

/** A secret nobody else derives: the setup's own, per army and cycle. */
function setupSecret(identity: bigint, cycleNumber: number): `0x${string}` {
	return keccak256(
		encodePacked(
			['string', 'uint256', 'uint64'],
			['OfflinePreset:setup', identity, BigInt(cycleNumber)],
		),
	);
}

export async function playPresetSetup(params: {
	provider: EIP1193ProviderLike;
	deployments: DeploymentsStore;
	config: ChessConfig;
	/** One army per owner: the owner's FIRST army is the one deployed. */
	armies: readonly SetupArmy[];
	/** Per cycle, the moves of the armies that move (by index); the rest pass. */
	cycles: readonly (readonly {army: number; moves: readonly Move[]}[])[];
	/**
	 * Send one call to the game as `owner`, and resolve once it is mined; throw
	 * when it reverts. `request` is merged over the game contract.
	 */
	sendAs: (
		owner: `0x${string}`,
		request: Record<string, unknown>,
	) => Promise<void>;
	/** Told before each cycle, for a boot screen. */
	onCycle?: (done: number, of: number) => void;
	/**
	 * Deploy the armies first (the default). `false` plays `cycles` on armies
	 * already deployed, which is how a test plays a preset's decisive move with
	 * the calls its setup uses.
	 */
	deploy?: boolean;
}): Promise<void> {
	const {provider, deployments, config, armies, sendAs} = params;
	if (armies.length === 0) return;
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

	const advance = () =>
		sendAs(armies[0].owner, {functionName: 'advanceCycle', args: []});

	/**
	 * One cycle: `turns[i]` is what army `i` submits, `undefined` for an army
	 * that cannot act (captured, exited): it is not waited for.
	 */
	async function playCycle(turns: readonly (readonly Move[] | undefined)[]) {
		const {cycleNumber, isCommitPhase} = await readCycle();
		if (!isCommitPhase) {
			throw new Error('a preset setup cycle must start in a commit phase');
		}
		const chains = turns.map((actions, i) => {
			if (actions === undefined) return undefined;
			const identity = firstArmyOf(armies[i].owner);
			const secret = setupSecret(identity, cycleNumber);
			return {
				identity,
				actions,
				secret,
				chain: buildMoveChain({
					actions,
					secret,
					actionsPerReveal: config.actionsPerReveal,
				}),
			};
		});
		for (const [i, turn] of chains.entries()) {
			if (!turn) continue;
			await sendAs(armies[i].owner, {
				functionName: 'makeCommitment',
				args: [
					turn.identity,
					turn.chain[0].hash,
					bondFor(config, turn.actions),
					NO_PAYEE,
				],
				gas: config.gas.commit,
			});
		}
		await advance();
		for (const [i, turn] of chains.entries()) {
			if (!turn) continue;
			for (const chunk of turn.chain) {
				await sendAs(armies[i].owner, {
					functionName: 'reveal',
					args: [
						turn.identity,
						chunk.actions,
						turn.secret,
						chunk.furtherActions,
						NO_PAYEE,
					],
					gas: config.gas.reveal,
				});
			}
		}
		await advance();
		// Every commitment opened: the base clears each one's cycle.
		for (const turn of chains) {
			if (!turn) continue;
			const left = await read<Commitment>('getCommitment', [turn.identity]);
			if (left.cycleNumber !== 0n) {
				throw new Error('a preset setup left a commitment unopened');
			}
		}
	}

	const deploy = params.deploy ?? true;
	const total = params.cycles.length + (deploy ? 1 : 0);
	if (deploy) {
		params.onCycle?.(0, total);
		await playCycle(armies.map((army) => deploymentAt(army.spawnPoint)));
	}

	for (const [k, cycle] of params.cycles.entries()) {
		params.onCycle?.(k + (deploy ? 1 : 0), total);
		const turns: (readonly Move[] | undefined)[] = [];
		for (const army of armies) {
			const view = armyViewOf(
				await read<Parameters<typeof armyViewOf>[0]>('getArmy', [
					firstArmyOf(army.owner),
				]),
			);
			turns.push(view.status === ARMY_STATUS.Deployed ? [] : undefined);
		}
		for (const {army, moves} of cycle) {
			if (turns[army] === undefined) {
				throw new Error(`preset army ${army} cannot move: it is not deployed`);
			}
			// One army's piece-moves in one cycle are one move (`docs/adr/0016`).
			turns[army] = [...turns[army], ...moves];
		}
		await playCycle(turns);
	}
}
