/**
 * The game half of the app context.
 *
 * `core.ts` is jolly-roger's, merged down from upstream and best left alone;
 * this file is chess composed on the commit-reveal skeleton
 * (`$lib/game/core/commit-reveal-game`). The skeleton owns the WIRING (which
 * store re-checks what, and when); this file hands it the game's parts.
 *
 * Constructed synchronously and off-browser, like the core half: nothing here
 * starts IO, which belongs to `start()`.
 */
import {derived, get, writable, type Readable} from 'svelte/store';
import {env} from '$env/dynamic/public';
import type {CoreServices} from '$lib/context/core';
import type {SignerGrant} from '$lib/ui/delegation/grant';
import type {ChainTimeStore} from '$lib/game/core/chain-time';
import type {CycleInfoStore, ThreePhase, TwoPhase} from '$lib/game/core/cycle';
import type {SubmissionStore} from '$lib/game/core/submission';
import type {CycleAdvanceStore} from '$lib/game/core/advance';
import type {ActiveIdentityStore, GameIdentity} from '$lib/game/identity';
import type {RecoveryStore} from '$lib/game/core/recovery';
import type {CyclePhase} from '$lib/game/core/cycle-phase';
import {
	createCommitRevealGame,
	type SavedTurn,
	type SetupNeeded as FrameworkSetupNeeded,
} from '$lib/game/core/commit-reveal-game';
import type {AcquisitionStore} from '$lib/game/acquire';
import type {CameraControl, CameraWatcher} from '$lib/game/render/camera';
import type {CanvasEventEmitter} from '$lib/game/render/events';
import type {GameRenderer, OnchainStateValue} from '$lib/game/core/seams';
import type {OnchainStateStore} from '$lib/onchain/state';
import type {ViewStateStore} from '$lib/view';
import {isEmbeddedChainId} from '$lib/embedded/chain-id';
import {resolveURLForThisPage} from '$lib/core/env/same-host';

// ---------------------------------------------------------------------------
// The `with/fuzd` layer: the reveal sent by fuzd, so it happens without this
// tab. Composed here and nowhere else, absent when not configured.
// ---------------------------------------------------------------------------
import {
	createFuzdScheduler,
	createScheduledReveal,
	fuzdSettings,
	revealModeFor,
	revealOnScheduleFailure,
	scheduledTurn,
	type FuzdExtensions,
	type ScheduledReveal,
} from '$lib/fuzd';

// ---------------------------------------------------------------------------
// The game itself.
// ---------------------------------------------------------------------------
import {resolveChessConfig, type ChessConfig} from './config';
import {
	bondFor,
	buildMoveCommitment,
	createChessCommitReveal,
	gameContract,
	type Move,
} from './commit-reveal';
import {MOVE_STORAGE} from './storage';
import {
	createAccountDataSubmissionStorage,
	storedTurnsFor,
} from '$lib/game/core/commit-reveal/storage';
import {
	createPlanning,
	createWholeMoveGuard,
	spawnPointNear,
	type PlanningStore,
} from './planning';
import {readMaxPieceMoves, type WholeMoveCall} from './piece-moves';
import {createCycleReader} from '$lib/game/core/commit-reveal/cycle';
import {
	createAttendanceReader,
	createCycleAdvancer,
} from '$lib/game/core/commit-reveal/advance';
import {holdResolvingCycle, type HeldBoardState} from './hold';
import {holdPlanUntilBoardReleases} from './display-plan';
import {SignerOutOfFundsError} from '$lib/game/core/commit-reveal/errors';
import {createAccountReserve, type ReserveStore} from './reserve';
import {createStakeAcquisition} from './acquisition';
import {
	blocksCommitting,
	createMissedReveal,
	type MissedRevealStore,
} from './missed-reveal';
import {
	createBoardReader,
	emptyBoard,
	zonesForCamera,
	type BoardState,
	type Piece,
} from './board';
import {squareAt} from './squares';
import {mergeBoardView, type BoardView} from './view';
import {createDeploymentPreview, withPreview} from './preview';
import {createAttackedSquares, withAttacked} from './attacked';
import {createBytecodeSandbox} from '$lib/game/simulation';
import {createGameRenderer, type GameSurface} from './render';
import {createExitPayout, type ExitPayoutStore} from './exits';
import {
	ARMY_STATUS,
	createArmies,
	isLive,
	type ArmiesStore,
	type ArmyView,
} from './armies';
import {
	awaitedDeployersOn,
	countStillToDeploy,
	withAwaitedDeployments,
} from './awaited-deployments';
import type {TableStore} from '$lib/game/lobby/table';
import {
	createCameraFollow,
	followTarget,
	type CameraFollowStore,
} from './camera-follow';
import {createMinimap, type MinimapStore} from './minimap';
import {createTableClaim, type TableClaimStore} from './table-payout';

export type Game = {
	config: ChessConfig;
	/**
	 * WHO IS SIGNED IN: the account, which owns. Not who PLAYS: that is
	 * `activeIdentity`, an army.
	 */
	identity: Readable<`0x${string}` | undefined>;
	/**
	 * WHO IS PLAYING: the army the submission, the commitment and the storage
	 * key are keyed by. Before the account's first deployment it is the army that
	 * deployment will create. See `./armies.ts`.
	 */
	activeIdentity: ActiveIdentityStore;
	/** The account's armies, and the one this client plays, resolved. */
	armies: ArmiesStore;
	/** Chain-synced wall clock. NOT `clock`, which is only a UI ticker. */
	chainTime: ChainTimeStore;
	cycleInfo: CycleInfoStore;
	threePhase: Readable<ThreePhase>;
	phase: Readable<CyclePhase>;
	twoPhase: Readable<TwoPhase>;
	/** The commit-reveal submission: what is planned, committed, revealed. */
	submission: SubmissionStore<GameIdentity, Move, FuzdExtensions>;
	revealSchedule: Readable<ScheduledReveal | undefined>;
	cycleAdvance: CycleAdvanceStore;
	/** Clicks into a planned deployment or move. */
	planning: PlanningStore;
	/**
	 * The ACCOUNT's reserve: stake bought and not yet deployed, freely
	 * withdrawable. An army's stake is the registry's (`armies`).
	 */
	reserve: ReserveStore;
	acquisition: AcquisitionStore;
	missedReveal: MissedRevealStore;
	/**
	 * Paying an army that left through an exit (`exit(army)`), or at a table,
	 * paying its share of the table's outcome (`claim(army)`).
	 */
	exitPayout: ExitPayoutStore;
	/** At a table, what the played army may claim once it is over. */
	tableClaim: TableClaimStore | undefined;
	recovery: RecoveryStore<Move>;
	/** What the planned submission will cost the account's reserve. */
	cost: Readable<bigint>;
	/**
	 * Whether the army this client plays still has to be deployed: it does not
	 * exist yet, or its deployment failed or was never revealed.
	 */
	needsDeployment: Readable<boolean>;
	readyToPlay: Readable<boolean>;
	setup: Readable<SetupNeeded | undefined>;
	savedTurn: Readable<SavedTurn>;
	table: TableStore | undefined;
};

/**
 * What stands between the player and their first move: the framework's gate
 * with this game's stake step in it.
 */
export type SetupNeeded = FrameworkSetupNeeded<{step: 'stake'}>;

export type Render = {
	camera: CameraWatcher;
	cameraControl: CameraControl;
	gameRenderer: GameRenderer<GameSurface>;
	eventEmitter: CanvasEventEmitter;
	/**
	 * The camera on the played army's king until the player looks elsewhere
	 * (`./camera-follow.ts`). Started by the page that shows the board.
	 */
	follow: CameraFollowStore;
	/** The spawn spiral and the armies, and a way to send the camera there. */
	minimap: MinimapStore;
};

export type GameContext = {
	onchainState: OnchainStateStore<BoardState & {cycleNumber: number}>;
	viewState: ViewStateStore<BoardView>;
	game: Game;
	render: Render;
	/** Begin the game's own IO. Returns the teardown. */
	start(): () => void;
};

/**
 * What this game needs at stake before a first move: an army, or the stake to
 * deploy one.
 *
 * An army that is deploying or deployed needs nothing more. Without one, the
 * ACCOUNT's reserve has to hold a stake for the deployment to move into the new
 * army. `Unloaded` is not "no stake": treating an unfinished read as an empty
 * one would put the gate over a playable board on every load until it lands.
 *
 * A FAILED DEPLOYMENT'S PENDING REFUND COUNTS (`refund`): the deployment commit
 * writes it before it takes the stake, so a player whose deployment failed can
 * deploy again without buying anything.
 */
export function stakeNeeded(params: {
	reserve: {step: string; amount?: bigint};
	army: Pick<ArmyView, 'status'> | undefined;
	armiesLoaded: boolean;
	stake: bigint;
	refund?: bigint;
	/**
	 * At a table the seat is the army: one held, whatever became of it, needs
	 * no stake, and the account's reserve never pays for one (a purchase seats
	 * a new army directly).
	 */
	atTable?: boolean;
}): {step: 'stake'} | undefined {
	if (!params.armiesLoaded || params.reserve.step !== 'Loaded')
		return undefined;
	if (params.atTable) {
		return params.army && params.army.status !== ARMY_STATUS.Cancelled
			? undefined
			: {step: 'stake'};
	}
	if (params.army && isLive(params.army)) return undefined;
	return (params.reserve.amount ?? 0n) + (params.refund ?? 0n) < params.stake
		? {step: 'stake'}
		: undefined;
}

/**
 * WHAT THIS APP'S BROWSER KEY IS FOR, in this app's own words: shown where the
 * player authorises it and in the account panel.
 */
export const SIGNER_GRANT: SignerGrant = {action: 'play your armies'};

/** This game's types, as the commit-reveal skeleton is told them. */
type ChessGame = {
	identity: GameIdentity;
	action: Move;
	board: HeldBoardState;
	view: BoardView;
	planning: PlanningStore;
	missedReveal: MissedRevealStore;
	stake: {step: 'stake'};
	surface: GameSurface;
	extensions: FuzdExtensions;
};

export function createGameContext(core: CoreServices): GameContext {
	/** WHO IS SIGNED IN: the account owns, and the local signer acts for it. */
	const account = core.account;

	// `.get()`: deployments are fixed for the life of the app.
	const deployments = core.deployments.get();
	const config = resolveChessConfig(deployments);
	const contract = gameContract(deployments);

	/**
	 * WHO IS PLAYING: one of the account's armies, read off the registry, or the
	 * army its next deployment creates. A SELECTION, not a derivation from the
	 * account.
	 */
	// AT A TABLE THE SEAT IS THE ARMY: bought in, never deployed, and a pass
	// is an empty commitment (`chess-tables`).
	const atTable = core.table !== undefined;
	const armies = createArmies({
		publicClient: core.publicClient,
		contract: {address: contract.address, abi: contract.abi},
		account,
		atTable,
	});
	const activeIdentity = armies.active;

	const reserve = createAccountReserve({deps: core, config, account});

	const needsDeployment = derived(
		[armies, armies.activeArmy],
		([$armies, $army]) =>
			!atTable &&
			$armies.step === 'Loaded' &&
			($army === undefined || !isLive($army)),
	);

	// An army acts from the cycle after it lands, and only while it stands.
	const canMove = derived(
		armies.activeArmy,
		($army) => $army?.status === ARMY_STATUS.Deployed,
	);

	const refreshStake = () =>
		Promise.all([reserve.update(), armies.update()]).then(() =>
			tableClaim?.update(),
		);
	// The exit's payout: an army that left through an exit is paid by a call
	// anyone may make, and this client makes it for its own account's.
	// At a table there are no exits: the table's outcome pays, by `claim`.
	const exitPayout = createExitPayout({
		deps: core,
		contract,
		functionName: atTable ? 'claim' : 'exit',
		onPaid: () => void refreshStake(),
	});
	const tableClaim = atTable
		? createTableClaim({
				publicClient: core.publicClient,
				contract,
				army: armies.activeArmy,
			})
		: undefined;

	// Keyed by WHO PLAYS (an army), in the account data. Typed with the layers'
	// extensions (`with/fuzd`'s schedule); the format is this game's.
	const storageFor = (player: GameIdentity) =>
		createAccountDataSubmissionStorage<Move, FuzdExtensions, GameIdentity>({
			accountData: core.accountData,
			format: MOVE_STORAGE,
			chainId: deployments.chain.id,
			contract: deployments.contracts.Game.address,
			identity: player,
		});

	// WHO REVEALS. With fuzd configured, fuzd sends the reveal as the phase
	// opens and this browser falls back at half of it; without it, it reveals
	// at once.
	const fuzd = fuzdSettings({
		uri: env.PUBLIC_FUZD_URI,
		chain: deployments.chain,
		embedded: isEmbeddedChainId(deployments.chain.id),
	});
	const fuzdEndpoint = () =>
		fuzd ? resolveURLForThisPage(fuzd.uri) : undefined;
	const scheduler = fuzd
		? createFuzdScheduler<GameIdentity>({
				schedulerEndPoint: fuzdEndpoint,
				chainId: fuzd.chainId,
				maxFeePerGasAuthorized: fuzd.maxFeePerGasAuthorized,
				expiryDelta: config.cycle.revealPhaseDuration,
				signerKey: () => {
					const connection = get(core.connection);
					return connection.step === 'SignedIn'
						? connection.account.signer.privateKey
						: undefined;
				},
				balanceOf: (address) => core.publicClient.getBalance({address}),
			})
		: undefined;

	// THE GAME'S RULES, RUN FROM THEIR OWN BYTECODE: the Simulation route's code
	// is read once and run in a sandbox, so the army drawn for a planned spawn
	// point is the layout the board will resolve, and the squares highlighted
	// for a selected piece are the moves the reveal will accept. Nothing is
	// fetched until a spawn point is planned or a piece selected.
	const sandbox = createBytecodeSandbox({
		provider: core.publicClient,
		contracts: {
			rules: {
				address:
					deployments.contracts.Game_Implementation_Router_Simulation_Route
						.address,
			},
		},
	});
	const simulate = async (spawnPoint: bigint, army: bigint) =>
		(await sandbox.call({
			contract: 'rules',
			abi: deployments.contracts.Game.abi,
			functionName: 'previewDeployment',
			args: [spawnPoint, army],
		})) as unknown as readonly {
			position: bigint;
			army: bigint;
			kind: number;
		}[];
	const legalMoves = async (pieces: readonly Piece[], from: bigint) => [
		...((await sandbox.call({
			contract: 'rules',
			abi: deployments.contracts.Game.abi,
			functionName: 'legalMoves',
			args: [pieces, from],
		})) as unknown as readonly bigint[]),
	];

	// THE WHOLE-MOVE ROUTE, from the same bytecode: where a piece may go
	// alongside the piece-moves already planned, and whether a whole move is
	// legal, each judged at the cap the game reports (3, or 1 at a table that
	// turns three off, `docs/adr/0016`). The route reads no storage, so the cap
	// is read from the game once and passed in.
	// The board the commit guard judges against: the one planning reads, bound
	// when the game hands it over (the guard is built before that).
	let boardNow = (): OnchainStateValue<BoardState> => ({step: 'Unloaded'});
	const wholeMove: WholeMoveCall = (functionName, args) =>
		sandbox.call({
			contract: 'rules',
			abi: deployments.contracts.Game.abi,
			functionName,
			args: args as never,
		}) as Promise<unknown>;
	const maxPieceMoves = writable<number | undefined>(undefined);
	let readingCap: Promise<number> | undefined;
	const readCap = (): Promise<number> => {
		const known = get(maxPieceMoves);
		if (known !== undefined) return Promise.resolve(known);
		readingCap ??= readMaxPieceMoves(
			(functionName) =>
				core.publicClient.readContract({
					address: contract.address,
					abi: contract.abi,
					functionName,
				}) as Promise<bigint>,
		).then(
			(cap) => {
				maxPieceMoves.set(cap);
				return cap;
			},
			(error: unknown) => {
				// Asked again by the next caller: a failed read is not the answer.
				readingCap = undefined;
				throw error;
			},
		);
		return readingCap;
	};

	// Under a manual cycle (the offline world) nothing moves until every army
	// has acted, so a deployed army's pass has to be SENT: the player presses
	// Pass, which commits an empty submission. Under a clock committing nothing
	// is already a pass, and committing one would spend gas to say nothing.
	// AT A TABLE TOO, under its clock: committing nothing never counts as
	// having acted, so only an empty commitment lets the table advance early.
	const manual = config.cycle.policy === 'manual';
	const commitWhenIdle = () =>
		(manual || atTable) &&
		get(armies.activeArmy) !== undefined &&
		!get(needsDeployment);

	// THE CYCLE WAITS FOR EVERY SEAT A WORLD NAMES, deployed or not: see
	// `./awaited-deployments.ts`. Nothing is read where no world named any.
	const readContractAttendance = createAttendanceReader({
		publicClient: core.publicClient,
		contract,
	});
	const readAttendance = async () => {
		const attendance = await readContractAttendance();
		const accounts = awaitedDeployersOn(deployments.chain.id);
		if (accounts.length === 0) return attendance;
		const stillToDeploy = await countStillToDeploy({
			accounts,
			nextArmyOf: (owner) =>
				core.publicClient.readContract({
					address: contract.address,
					abi: contract.abi,
					functionName: 'getNextArmy',
					args: [owner],
				}) as Promise<bigint>,
		});
		return withAwaitedDeployments(attendance, stillToDeploy);
	};

	const crg = createCommitRevealGame<ChessGame>(core, {
		identity: activeIdentity,
		contract: deployments.contracts.Game.address,
		cycle: {
			config: config.cycle,
			readCycle: createCycleReader({publicClient: core.publicClient, contract}),
			readAttendance,
			advance: createCycleAdvancer({deps: core, contract}),
			// The base re-checks every advance and names what it is waiting for.
			contractIsTheJudge: true,
			auto: 'eagerly',
		},
		actionsPerReveal: config.actionsPerReveal,
		camera: config.camera,
		// THE BOARD IS THE CONTRACT'S RESOLVING VIEWS, polled for the area in view:
		// no indexer (`docs/adr/0007-rules-live-only-in-the-contract.md`).
		board: ({poll}) =>
			poll<BoardState>({
				zonesForCamera,
				read: createBoardReader({
					publicClient: core.publicClient,
					deployments,
				}),
				emptyState: emptyBoard,
			}),
		missedReveal: () =>
			createMissedReveal({
				deps: core,
				config,
				identity: activeIdentity,
				committedTurn: (player, cycleNumber) =>
					storedTurnsFor(storageFor(player), cycleNumber),
				onSettled: ({player, cycleNumber}) => {
					storageFor(player).settled(cycleNumber);
					void refreshStake();
				},
			}),
		blocksCommitting,
		// A move the contract would refuse is never committed, whoever asks for
		// the commit (the button or the submission itself): its reveal would
		// revert, and the army freeze.
		adapter: ({beforeCommit}) =>
			createChessCommitReveal({
				deps: core,
				config,
				beforeCommit,
				refuse: createWholeMoveGuard({
					board: () => boardNow(),
					army: () => get(activeIdentity),
					maxPieceMoves: readCap,
					call: wholeMove,
				}),
			}),
		buildCommitment: ({actions, secret}) =>
			buildMoveCommitment({
				actions,
				secret,
				actionsPerReveal: config.actionsPerReveal,
			}),
		storageFor,
		...(scheduler ? {scheduler} : {}),
		submission: {
			...revealModeFor(scheduler !== undefined),
			commitWhenIdle,
		},
		isOutOfGas: (error) => error instanceof SignerOutOfFundsError,
		stake: {
			refresh: refreshStake,
			needed: derived(
				[reserve, armies, armies.activeArmy, armies.pendingRefund],
				([$reserve, $armies, $army, $refund]) =>
					stakeNeeded({
						reserve: $reserve,
						army: $army,
						armiesLoaded: $armies.step === 'Loaded',
						stake: config.stake,
						refund: $refund,
						atTable,
					}),
			),
			acquisition: createStakeAcquisition({
				config,
				deployments,
				table: core.table,
			}),
			grant: SIGNER_GRANT,
		},
		planning: ({submission, onchainState}) => {
			boardNow = () => get(onchainState);
			const planning = createPlanning({
				submission,
				needsDeployment,
				canMove,
				army: activeIdentity,
				board: onchainState,
				maxPieceMoves,
				wholeMove,
			});
			const preview = createDeploymentPreview({plan: planning.plan, simulate});
			// Where the enemy may move this cycle, by the same rule (story 21).
			const attacked = createAttackedSquares({
				board: onchainState,
				you: activeIdentity,
				legalMoves,
			});
			return {
				...planning,
				plan: withAttacked(withPreview(planning.plan, preview), attacked),
			};
		},
		hold: holdResolvingCycle,
		holdPlan: holdPlanUntilBoardReleases,
		merge: mergeBoardView,
		renderer: ({viewState}) =>
			createGameRenderer({
				viewState,
				// A table has no exits (`chess-tables`).
				spawnSpacing: core.table ? undefined : config.spawnSpacing,
				cellSize: config.cellSize,
			}),
		// The canvas reports WHERE, in squares and unsnapped; which spawn point or
		// square that picks is this game's. Rounded because squares are centred
		// on their integer coordinate.
		click: (position, {planning}) => {
			const board = get(crg.onchainState);
			if (board.step !== 'Loaded') return;
			const square = {x: Math.round(position.x), y: Math.round(position.y)};
			if (!get(needsDeployment)) {
				planning.click(squareAt(square.x, square.y));
				return;
			}
			const picked = spawnPointNear(square, board.spawnPoints);
			if (picked !== undefined) planning.choose(picked);
		},
		start: () => {
			// The reserve follows the account, the armies follow the account, and
			// an army's status changes when a cycle turns over (a deployment lands
			// or fails then), so the registry is read again on each.
			void refreshStake();
			const stopAccount = account.subscribe(() => void refreshStake());
			// The cap is fixed for the game's life; read once, and again on the next
			// cycle if it failed, until it is known. Nothing is offered before.
			const readCapQuietly = () => void readCap().catch(() => {});
			const stopCycle = crg.game.currentCycleNumber.subscribe(() => {
				readCapQuietly();
				void armies.update().then(() => tableClaim?.update());
			});
			return () => {
				stopAccount();
				stopCycle();
				sandbox.dispose();
			};
		},
	});

	// A deployment moves the stake out of the account's reserve; a move or a
	// pass costs it nothing.
	const cost = derived(crg.game.planning.actions, ($actions) =>
		bondFor(config, $actions),
	);

	const revealSchedule = createScheduledReveal({
		turn: scheduledTurn({
			identity: activeIdentity,
			submission: crg.game.submission,
			storageFor,
		}),
		cycleInfo: crg.game.cycleInfo,
		endpoint: fuzdEndpoint,
		intervalMs: deployments.chain.id === 31337 ? 1_000 : 5_000,
	});

	// THE CAMERA FOLLOWS THE ARMY, and the minimap sends it elsewhere: both read
	// the registry the board reader already reads whole, never more pieces.
	const follow = createCameraFollow({
		cameraControl: crg.render.cameraControl,
		target: followTarget({board: crg.onchainState, you: activeIdentity}),
	});
	const minimap = createMinimap({
		board: crg.onchainState,
		you: activeIdentity,
		camera: crg.render.camera,
		lookAt: follow.lookAt,
		// A table has no exits (`chess-tables`).
		spawnSpacing: core.table ? undefined : config.spawnSpacing,
	});

	return {
		onchainState: crg.onchainState,
		viewState: crg.viewState,
		game: {
			...crg.game,
			config,
			activeIdentity,
			armies,
			reserve,
			exitPayout,
			tableClaim,
			cost,
			needsDeployment,
			revealSchedule,
		},
		render: {...crg.render, follow, minimap},
		start: () => {
			const stop = crg.start();
			const stopFallback = scheduler
				? revealOnScheduleFailure({
						reveal: revealSchedule,
						submission: crg.game.submission,
					})
				: () => {};
			return () => {
				stopFallback();
				stop();
			};
		},
	};
}
