/**
 * Everything the HUD renders, as one derived store.
 *
 * The components that show this are deliberately logic-less: they take a
 * finished model and lay it out. All the deciding - which phase label to show,
 * whether committing is still possible, what the submission costs - happens
 * here, in plain TypeScript that can be read and tested without a browser.
 */
import {derived, readable, type Readable} from 'svelte/store';
import {chainValueLabel} from './chain-value';
import {STAKE} from '../stake';
import type {Context} from '$lib/context/types';
import type {SubmissionState} from '$lib/game/core/submission';

import {
	acquisitionTotal,
	opensAWallet,
	type AcquisitionState,
} from '$lib/game/acquire';
import {spawnPointOf, type Move} from '../commit-reveal';
import type {ReserveState} from '../reserve';
import {blocksCommitting, type MissedRevealState} from '../missed-reveal';
import type {RecoveryState} from '$lib/game/core/recovery';
import {SignerOutOfFundsError} from '$lib/game/core/commit-reveal/errors';
import type {SetupNeeded} from '../context';
import {ARMY_STATUS, type ArmyView} from '../armies';
import type {ExitPayoutState} from '../exits';
import type {TableClaim} from '../table-payout';
import {nearestLabel, type SpawnPointView} from '../spawn-points';
import {positionOf} from '../squares';
import {pieceMoveLabel} from '../planning';
import {plannedMoveColour} from '../render/style';
import type {BoardView} from '../view';
import {describeOutcomes, type OutcomeLine} from '../outcomes';
import type {ViewStateValue} from '$lib/game/core/seams';
import type {CycleInfo} from '$lib/game/core/cycle';
import type {CyclePhase} from '$lib/game/core/cycle-phase';
import type {SavedTurn} from '$lib/game/core/commit-reveal-game';
import type {ScheduledReveal} from '$lib/fuzd';

export type HudModel = {
	phaseLabel: string;
	/**
	 * Four parts, not two, and the fourth is the reason.
	 *
	 * This used to collapse to play / wait, on the grounds that the only decision
	 * a player has is whether the submission is still theirs to change. That is
	 * true and it left nowhere to put the CATCH-UP: the moment after the cycle
	 * turns over when the board is still showing the last one, which the clock
	 * cannot see. Reported as "wait" it tells the player the cycle is resolving
	 * when nothing is being waited for except a poll, and it is the one state
	 * where a plan would be built from a position that has already changed. See
	 * `game/core/cycle-phase.ts`.
	 */
	phase: CyclePhase;
	/** Seconds left in the phase, already rounded for display. */
	secondsLeft: number;
	/** How far through the phase, 0..1, for a progress bar. */
	progress: number;
	cycleNumber: number;
	/**
	 * The countdown to the end of the CONTRACT's current phase (story 47):
	 * when commitments close, then when reveals must have landed. Read from
	 * the cycle tracker, which reads the chain's clock and, under an early
	 * advance, the chain's own phase boundaries. Absent without a clock.
	 */
	countdown?: {
		label: string;
		/** Whole seconds to the end of the phase. */
		secondsLeft: number;
	};
	/**
	 * Clicking now plans for the NEXT cycle, because this one has closed. Worth
	 * saying: the moves still appear on the board, and without this the player
	 * would reasonably think they were part of the cycle being resolved.
	 */
	planningForNextCycle: boolean;
	/**
	 * Set when this build has NO LOCAL SIGNER, so every move has to be signed in
	 * the wallet. Said once, up front, rather than discovered one prompt at a
	 * time.
	 *
	 * Nothing to do with hosted sign-in, which is a separate axis entirely: see
	 * core/connection/mode.ts, where TARGET_STEP decides whether a signer exists
	 * and PUBLIC_WALLET_HOST decides only whether email and social are offered.
	 */
	walletSigningNotice?: string;
	/**
	 * Set while the player cannot take a turn yet. The HUD shows THIS instead of
	 * the planning controls: offering "plan your moves" to someone with nothing
	 * staked invites them to lay out a whole turn that cannot be committed, and
	 * the failure only arrives when the cycle is already closing.
	 */
	setup?: {
		headline: string;
		detail: string;
		action?: 'stake' | 'authorise';
		/** The words on the button, which for a purchase carry the price. */
		actionLabel?: string;
		/** The purchase is in flight, so the button says so and does nothing. */
		busy?: boolean;
		busyLabel?: string;
		error?: string;
	};

	/**
	 * Set while a stake is being acquired, for the top-up button on a board the
	 * player can already play.
	 *
	 * The same sentence the setup gate uses, and deliberately not folded into it:
	 * that one is shown INSTEAD of the board, this one beside it, and a player
	 * with a reserve that is merely running low is not blocked on it.
	 */
	acquiring?: string;

	plannedCount: number;
	costLabel: string;
	reserveLabel: string;
	/**
	 * The army this client plays, once it exists: where its deployment is and
	 * what it holds.
	 */
	army?: {
		label: string;
		stakeLabel: string;
		tone: 'idle' | 'busy' | 'good' | 'bad';
	};
	/**
	 * What became of the account's last deployment, while the player is back at
	 * deployment because of it: failed (refunded, or the refund pending), cancelled
	 * (refunded), or never revealed (burned).
	 */
	lastDeployment?: {
		label: string;
		/** What happened to its stake. */
		stakeLabel: string;
		tone: 'idle' | 'busy' | 'good' | 'bad';
	};
	/**
	 * Set while the army this client plays still has to be deployed: the open
	 * spawn points, how close the nearest armies are to each, and which one is
	 * picked. `undefined` once the army is deploying or deployed.
	 */
	deployment?: {
		spawnPoints: readonly {
			spawnPoint: bigint;
			label: string;
			nearest: string;
			picked: boolean;
		}[];
		picked?: string;
	};
	/**
	 * Set while the army this client plays stands on the board and may move:
	 * the piece-moves planned this cycle, each with a way to take it back.
	 */
	moving?: {
		/** In the order picked, each named and in the colour it is drawn in. */
		pieceMoves: readonly {from: bigint; label: string; colour: string}[];
		/** How many are planned of how many the game allows, once it is read. */
		countLabel?: string;
		/** Why the contract would refuse the move as planned: it is not committed. */
		refusal?: string;
		/** One line on what to tap next, given how many are planned. */
		hint: string;
	};
	/**
	 * What the last closed cycle did in view, once the board has read it: its
	 * captures and collisions, as the contract resolved them. Absent when it
	 * did neither.
	 */
	lastCycle?: {cycleNumber: number; lines: readonly OutcomeLine[]};
	/**
	 * Set when the plan cannot be submitted as it stands.
	 *
	 * TWO DIFFERENT WAYS TO BE UNSUBMITTABLE, and they are not the same hazard.
	 * Costing more than the reserve is refused by the CONTRACT, so it costs a
	 * failed commit. Being longer than the reveal window can open is refused by
	 * nothing: it commits happily and then cannot be revealed in time, which
	 * forfeits the stake. The second is the one with the player's money in it, so
	 * it is the one reported when both are true.
	 */
	warning?: string;

	submissionLabel: string;
	submissionTone: 'idle' | 'busy' | 'good' | 'bad';
	canCommit: boolean;
	/**
	 * Whether a PASS can be committed now: a deployed army under a cycle that
	 * waits for everyone (the offline world), which has to send its pass for
	 * the cycle to move on. Under a clock, committing nothing is a pass.
	 */
	canPass: boolean;
	canReveal: boolean;
	canClear: boolean;
	/**
	 * Set when the move failed because the key that signs moves has no gas.
	 * The one failure the player can fix, so it is named and given a button
	 * rather than left as a transaction error.
	 */
	outOfGas?: {detail: string};

	/**
	 * Set when an unrevealed commitment is blocking play. Holds what was lost and
	 * what the player has to do about it: acknowledging forfeits the bond, so it
	 * is offered rather than done for them.
	 */
	missedReveal?: {
		headline: string;
		detail: string;
		busy: boolean;
		canAcknowledge: boolean;
	};

	/**
	 * Set while one of the account's armies has left through an exit and its
	 * payout has not been claimed: what it is owed, and the button that pays
	 * it (`exit(army)`, which anyone may send and always pays the owner).
	 */
	exitPayout?: {
		army: bigint;
		headline: string;
		detail: string;
		actionLabel: string;
		busy: boolean;
		error?: string;
	};

	/**
	 * Set while the player's saved turn is not readable yet: loading, or failed
	 * to load. Play is blocked meanwhile, and on a failure it STAYS blocked: an
	 * empty board in its place would invite a turn planned over one this browser
	 * could not read.
	 */
	savedTurn?: {headline: string; detail: string; tone: 'busy' | 'bad'};

	/**
	 * Who reveals this turn, when fuzd (`with/fuzd`) is configured: that it will
	 * be revealed for the player once scheduled, fuzd's status in the reveal
	 * phase, or that it is NOT scheduled and this browser has to be here.
	 * `step` is for a test to read; the label is for the player.
	 */
	revealSchedule?: {
		step:
			| 'scheduled'
			| 'broadcast'
			| 'confirmed'
			| 'failed'
			| 'unreachable'
			| 'not-scheduled';
		label: string;
		tone: 'idle' | 'busy' | 'good' | 'bad';
	};

	/**
	 * Set when the reveal phase is running out and this cycle's reveal has not
	 * landed: the loudest thing the HUD says during play, because a reveal that
	 * misses the deadline FREEZES the army for good (a deployment's stake is
	 * burned instead): `docs/adr/0005-missed-reveal-freezes-the-army.md`.
	 * Whoever is sending it, this browser, a reveal service or a play key with
	 * no gas left, what is warned about is that it has not LANDED.
	 */
	revealDeadline?: {
		headline: string;
		detail: string;
		/** Whole seconds to the end of the reveal phase. */
		secondsLeft: number;
	};

	/**
	 * Set when the chain holds a commitment for the cycle in progress that this
	 * browser has no memory of. The stake is still recoverable, and only for as
	 * long as the cycle lasts, so this is the most time-critical thing the HUD
	 * ever has to say.
	 */
	recovery?: {
		headline: string;
		detail: string;
		busy: boolean;
		/** Whether there is a plan on the board to offer. */
		canRecover: boolean;
	};
};

export function describeSubmission(state: SubmissionState<Move>): {
	label: string;
	tone: HudModel['submissionTone'];
} {
	switch (state.step) {
		case 'Idle':
			return {label: 'No move yet', tone: 'idle'};
		case 'Planning':
			return {label: 'Picked, not sent', tone: 'idle'};
		case 'Committing':
			return {label: 'Sending...', tone: 'busy'};
		case 'Committed':
			return {label: 'Committed, reveal pending', tone: 'busy'};
		case 'Revealing':
			// A TURN MAY BE BIGGER THAN A TRANSACTION, so a reveal may be several
			// of them, and the player watches their submission arrive a part at a time
			// over a noticeable stretch of the reveal phase. Without the count that
			// reads as a board filling in at random; with it, it reads as progress.
			// Said only when there IS more than one, so an ordinary one-transaction
			// turn is not dressed up as a procedure.
			return {
				label:
					state.progress && state.progress.total > 1
						? `Revealing... (${state.progress.done} of ${state.progress.total})`
						: 'Revealing...',
				tone: 'busy',
			};
		case 'Revealed':
			return {
				label: 'Revealed: lands at cycle end',
				tone: 'good',
			};
		case 'Missed':
			return {
				// The one message that costs the player money, so it says what
				// happened rather than just that something went wrong.
				label: `Missed reveal (cycle ${state.cycleNumber})`,
				tone: 'bad',
			};
		case 'Error':
			// The type, not upstream's classifier: by the time an error reaches the
			// submission it has been through `send()` in ../commit-reveal, which is
			// where the node's wording is read. Asking again here would re-derive an
			// answer the app already committed to, and could disagree with it.
			if (state.error instanceof SignerOutOfFundsError) {
				return {
					// NOT `INSUFFICIENT_FUNDS_SUMMARY`, though the barrel now exports it
					// and it says the same thing about the same failure. Upstream's
					// sentence is "this account does not have enough funds", which is
					// exactly right for a transaction the player initiated from their
					// wallet and wrong here: the account is a signer they were never
					// told about, so "this account" reads as their wallet, which is
					// probably funded. They would go looking at a balance that is fine.
					// The remedy is to top up the SIGNER, so the message has to point at
					// it ("gas left to play with", spelled out in `outOfGas` below).
					// Upstream names the failure; the game names whose it is.
					label:
						state.during === 'commit'
							? 'Move not sent: play key out of gas'
							: 'Reveal not sent: play key out of gas',
					tone: 'bad',
				};
			}
			return {
				label:
					state.during === 'commit'
						? `Commit failed: ${state.message}`
						: `Reveal failed: ${state.message}. Retry now.`,
				tone: 'bad',
			};
	}
}

/**
 * What to tell the player about a commitment they never revealed.
 *
 * Phrased as a statement of what happened and what it cost, not as an error:
 * the stake is already gone by the time this is shown, and the only remaining
 * choice is whether to settle it on chain and carry on playing.
 */
export function describeMissedReveal(
	state: MissedRevealState,
): HudModel['missedReveal'] {
	if (state.step === 'Clear' || state.step === 'Unknown') return undefined;

	const headline = `You missed the reveal for cycle ${state.cycleNumber}.`;

	if (state.step === 'Acknowledging') {
		return {
			headline,
			detail: 'Acknowledging...',
			busy: true,
			canAcknowledge: false,
		};
	}
	if (state.step === 'Failed') {
		return {
			headline,
			detail: `Could not acknowledge: ${state.message}`,
			busy: false,
			canAcknowledge: true,
		};
	}
	return {
		headline,
		detail: STAKE.forfeited(state.forfeit),
		busy: false,
		canAcknowledge: true,
	};
}

/**
 * What acquiring the stake is doing right now, in the player's terms.
 *
 * Four waits that feel different: one the player must answer, one they have
 * paid for, one sent on their behalf without a prompt, and one this browser is
 * not running at all.
 *
 * The WORDS are the game's, which is why this is here rather than in the rail:
 * the rail exports the state, and "your stake" is one game's name for what
 * another calls an avatar or a pass. Parameterising the nouns would produce a
 * sentence that fits nobody well.
 */
export function acquisitionBusyLabel(
	state: AcquisitionState,
): string | undefined {
	switch (state.step) {
		case 'Authorising':
			// ONLY THE ROUTE THAT ACTUALLY OPENS A WALLET is told to look at one. An
			// account whose credential was minted at sign-in gets here too, and its
			// credential is simply handed back without a prompt, so sending it to a
			// window that never opens is worse than saying nothing.
			return opensAWallet(state.authorisation)
				? 'Confirm in your wallet...'
				: 'Authorising...';
		case 'Acquiring':
			return 'Staking...';
		case 'ChoosingPayer':
			return 'Choose how to pay...';
		case 'Consent':
			return 'Confirm to continue...';
		case 'Registering':
			// No prompt for this one: the signer sends it itself, out of the stipend
			// the purchase just gave it. Unexplained it looks like a hang after the
			// money has already gone.
			return 'Setting up play key...';
		case 'Pending':
			// A FOURTH kind of wait, and the one that needs saying most: this browser
			// is not doing anything, and the player has no memory of starting it in
			// this tab, because they reloaded. What they must not be told is "stake
			// to play", which is what they would be told without this - and they
			// would, for a second time, with their own money.
			return state.landed
				? 'Stake in. Placing your army...'
				: 'Finishing your purchase...';
		default:
			return undefined;
	}
}

/**
 * What the dial says beside itself.
 *
 * The catch-up gets its own words rather than being folded into "resolving":
 * nothing is resolving, the board is simply behind, and telling a player the
 * cycle is still running is what makes a stale board look like a stuck one.
 */
export function phaseLabelOf(phase: CyclePhase): string {
	switch (phase) {
		case 'play':
			return 'Your move';
		case 'commit':
			return 'Committing';
		case 'reveal':
			return 'Revealing';
		case 'catching-up':
			return 'Catching up';
	}
}

/** What the player has to do before they can take a turn. */
export function describeSetup(
	setup: SetupNeeded | undefined,
	options?: {priceLabel?: string; busyLabel?: string},
): HudModel['setup'] {
	if (!setup) return undefined;
	switch (setup.step) {
		case 'sign-in':
			return {
				headline: 'Sign in to play',
				detail: 'Get a play key so moves need no wallet prompt.',
			};
		case 'authorise':
			return {
				headline: 'Authorise this browser',
				// Says what it does AND what it does not do, because "authorise" is
				// the word every drainer uses. What is being granted is narrow and
				// the contract enforces it: the key can commit and reveal, and it
				// cannot withdraw the reserve, which only this account can do.
				detail:
					'A key in this browser signs your moves, so no wallet prompts. It can never withdraw your stake, and you can revoke it anytime.',
				action: 'authorise',
			};
		case 'stake':
			// The WORDS are in `../stake.ts`, with what is at stake, because a game
			// that gates differently rewrites every one of them and nothing else in
			// this file. See the note there.
			return {
				headline: STAKE.setup.headline,
				detail: STAKE.setup.detail,
				action: 'stake',
				actionLabel: STAKE.setup.action(options?.priceLabel),
				busyLabel: options?.busyLabel,
			};
	}
}

/**
 * What to tell a player whose browser has lost a submission the chain still
 * holds.
 *
 * Says the three things that decide what they do next, in the order they need
 * them: that a commitment exists, that it can still be opened, and that only
 * re-entering the same turn will open it. It deliberately does NOT say "your
 * stake is lost" - it is not, yet, and that is the entire point of showing
 * this at all.
 *
 * A REFUSAL IS NOT AN ERROR, and is worded as a fact about the plan rather
 * than as a failure. The player cannot break anything by guessing: the hash
 * refuses a turn that was not committed, which is also why offering this route
 * gives an attacker nothing.
 */
export function describeRecovery(
	state: RecoveryState,
	plannedCount: number,
): HudModel['recovery'] {
	if (state.step === 'Idle') return undefined;

	// NOT "has lost the turn", which is what this said while the copy still
	// called a submission a round. In a game "lose a turn" is an idiom for
	// forfeiting your go, so the shorter wording announced exactly the thing the
	// note above says this must not announce. MISLAID, not forfeited.
	const headline = `This browser no longer has the turn for cycle ${state.cycleNumber}.`;
	if (state.step === 'Checking') {
		return {headline, detail: 'Checking...', busy: true, canRecover: false};
	}

	const detail =
		state.step === 'Refused'
			? 'Not the committed deployment. Try again: nothing is spent, and it can still be revealed this cycle.'
			: state.step === 'Failed'
				? // NOT phrased as a wrong plan. The app could not ask, which is a
					// different thing, and the remedy is to press again rather than to
					// go looking for a misremembered turn.
					`Could not check: ${state.message}. Nothing lost, try again.`
				: 'It can still be revealed this cycle: pick the same spawn point and recover.';

	return {headline, detail, busy: false, canRecover: plannedCount > 0};
}

/** What to say about the saved turn, or nothing once it is loaded. */
export function describeSavedTurn(state: SavedTurn): HudModel['savedTurn'] {
	switch (state.status) {
		case 'loading':
			return {
				headline: 'Loading your turn...',
				detail: 'Planning opens when it loads.',
				tone: 'busy',
			};
		case 'error':
			return {
				headline: 'Could not load your turn.',
				detail: `${state.error.message}. Play is paused: reload to retry.`,
				tone: 'bad',
			};
		default:
			return undefined;
	}
}

/**
 * What to say about who reveals the turn in hand, or nothing without a
 * scheduler (R2) or a committed turn.
 *
 * Said only while the turn is still owed, or once fuzd has a word on it: a
 * turn this browser revealed itself is not dressed up as revealed "for you".
 */
export function describeRevealSchedule(
	reveal: ScheduledReveal | undefined,
	submission: SubmissionState<Move>,
): HudModel['revealSchedule'] {
	if (!reveal) return undefined;
	const owed =
		(submission.step === 'Committed' || submission.step === 'Revealing') &&
		submission.cycleNumber === reveal.cycleNumber;
	if (reveal.revealScheduled === false || !reveal.schedule) {
		return owed && reveal.revealScheduled === false
			? {
					step: 'not-scheduled',
					label: 'Not scheduled: keep this page open to reveal.',
					tone: 'bad',
				}
			: undefined;
	}
	const status = reveal.status;
	if (!owed && !status) return undefined;
	switch (status?.step) {
		case undefined:
		case 'scheduled':
			return {
				step: 'scheduled',
				label: 'Auto-reveal scheduled: safe to close.',
				tone: 'good',
			};
		case 'broadcast':
			return {
				step: 'broadcast',
				label:
					status.total > 1
						? `Revealing for you (${status.sent} of ${status.total})...`
						: 'Revealing for you...',
				tone: 'busy',
			};
		case 'confirmed':
			return {step: 'confirmed', label: 'Revealed for you.', tone: 'good'};
		case 'failed':
			return {
				step: 'failed',
				label: `Auto-reveal failed (${status.reason}): revealing here.`,
				tone: 'bad',
			};
		case 'unreachable':
			return {
				step: 'unreachable',
				label: 'Reveal service unreachable: this tab takes over at half-phase.',
				tone: 'busy',
			};
	}
}

/**
 * How much of the reveal phase may be left before an owed reveal that has not
 * landed is warned about: the last half. A reveal normally lands within
 * seconds of the phase opening (this browser sends it at once; a reveal
 * service that has not by half the phase is taken over by this browser), so
 * one still missing then is in trouble, and the player has the other half to
 * act.
 */
export const REVEAL_DEADLINE_WARNING_SHARE = 0.5;

/**
 * The warning that the reveal deadline is near and this cycle's reveal has not
 * landed (story 15), or nothing.
 *
 * "NOT LANDED" IS READ FROM WHAT THE CLIENT KNOWS OF THE CHAIN, not from who
 * was meant to send it: the submission still owes the reveal (committed, being
 * revealed, or a reveal that failed) and no reveal service reports it
 * confirmed. So a revealer that went quiet, a play key out of gas and a tab
 * that was asleep all warn alike. A failed reveal warns at once, since it will
 * not land by itself; otherwise the warning starts at
 * {@link REVEAL_DEADLINE_WARNING_SHARE} of the phase left. A cycle with no
 * clock (manual) has no deadline: it waits for every reveal.
 */
export function describeRevealDeadline(params: {
	cycle: {
		currentCycleNumber: number;
		isCommitPhase: boolean;
		/** Seconds; zero without a clock. */
		revealPhaseDuration: number;
		/** Seconds to the end of the reveal phase; undefined without a clock. */
		secondsToRevealEnd: number | undefined;
	};
	submission: SubmissionState<Move>;
	/** What a reveal service says of this turn, if one holds it. */
	revealSchedule?: NonNullable<HudModel['revealSchedule']>['step'];
}): HudModel['revealDeadline'] {
	const {cycle, submission} = params;
	const left = cycle.secondsToRevealEnd;
	if (left === undefined || cycle.revealPhaseDuration <= 0) return undefined;
	if (cycle.isCommitPhase) return undefined;
	const owed =
		submission.step === 'Committed' ||
		submission.step === 'Revealing' ||
		(submission.step === 'Error' && submission.during === 'reveal');
	if (!owed || submission.cycleNumber !== cycle.currentCycleNumber) {
		return undefined;
	}
	if (params.revealSchedule === 'confirmed') return undefined;
	const failed = submission.step === 'Error';
	if (
		!failed &&
		left > cycle.revealPhaseDuration * REVEAL_DEADLINE_WARNING_SHARE
	) {
		return undefined;
	}
	const secondsLeft = Math.max(0, Math.ceil(left));
	const consequence =
		spawnPointOf(submission.actions) !== undefined
			? 'Miss it and the stake is burned.'
			: 'Miss it and your army freezes for good.';
	const remedy =
		failed && submission.error instanceof SignerOutOfFundsError
			? 'Play key out of gas: top up now.'
			: failed
				? 'Sending failed: press Retry reveal.'
				: 'Keep this page open.';
	return {
		headline: `Reveal not landed: ${secondsLeft}s left`,
		detail: `${remedy} ${consequence}`,
		secondsLeft,
	};
}

/** Seconds as a countdown reads them: `42s`, `3:07`, `1:02:09`. */
export function formatCountdown(seconds: number): string {
	const whole = Math.max(0, Math.ceil(seconds));
	if (whole < 60) return `${whole}s`;
	const h = Math.floor(whole / 3600);
	const m = Math.floor((whole % 3600) / 60);
	const s = String(whole % 60).padStart(2, '0');
	return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/**
 * The countdown to the end of the contract's current phase (story 47), or
 * nothing for a cycle without a clock, which waits for every army.
 *
 * THE CONTRACT'S PHASES, not the dial's. The dial counts the whole wait
 * (this browser's commit margin and the reveal phase) as one span; this says
 * the two deadlines a player acts on: when the commit phase closes, and when
 * a reveal must have landed. Under early advance a phase can end SOONER, once
 * every army has acted, and the label says so rather than promise a time.
 */
export function describeCountdown(cycle: CycleInfo): HudModel['countdown'] {
	if (cycle.type !== 'timed' && cycle.type !== 'hybrid') return undefined;
	const left = cycle.isCommitPhase
		? cycle.timeLeftForCommitEnd
		: cycle.timeLeftForRevealEnd;
	const secondsLeft = Math.max(0, Math.ceil(left));
	const sooner = cycle.type === 'hybrid' ? ' (or sooner)' : '';
	return {
		label: cycle.isCommitPhase
			? `Commits close in ${formatCountdown(secondsLeft)}${sooner}`
			: `Reveals close in ${formatCountdown(secondsLeft)}${sooner}`,
		secondsLeft,
	};
}

/** For a game that is not a table, which has no claim to read. */
const NO_TABLE_CLAIM: Readable<TableClaim | undefined> = readable(undefined);

/** No scheduled reveal: what a context without the layer's member reads. */
const NO_REVEAL_SCHEDULE: Readable<ScheduledReveal | undefined> =
	readable(undefined);

/**
 * What the HUD says while the account's data loads (after any account switch, a
 * hotseat handover's included): the submission takes no plan until it has, so a
 * click on the board then is not planned (`SubmissionStore.ready`).
 */
export const LOADING_ACCOUNT = 'Loading your account...';

/**
 * The registry entry the HUD words an army from. `capturedBy` tells a taken
 * king that is a stone nobody has captured (zero, its stake still its own)
 * from one whose stake went to its captor; without it a captured army is
 * worded as the latter.
 */
type ArmyWords = Pick<ArmyView, 'status' | 'stake'> &
	Partial<Pick<ArmyView, 'capturedBy'>>;

/** Whether a captured army's king is a stone that still holds its stake. */
const isStoneArmy = (army: ArmyWords) =>
	army.status === ARMY_STATUS.Captured &&
	army.capturedBy === 0n &&
	army.stake > 0n;

/** Where an army is, in the player's words. */
export function describeArmy(army: ArmyWords | undefined): HudModel['army'] {
	if (!army) return undefined;
	const stakeLabel = STAKE.amount(army.stake);
	switch (army.status) {
		case ARMY_STATUS.Deploying:
			return {
				label: 'Deploying: on the board next cycle.',
				stakeLabel,
				tone: 'busy',
			};
		case ARMY_STATUS.Deployed:
			return {
				label: 'On the board.',
				// The registry's stake is already the total: its own and every
				// stake it captured, which is what its king would exit with.
				stakeLabel: `${stakeLabel} (incl. captures)`,
				tone: 'good',
			};
		case ARMY_STATUS.Failed:
			return {
				label: 'Deployment failed (spawn point taken or blocked). Stake refunded.',
				stakeLabel,
				tone: 'bad',
			};
		case ARMY_STATUS.Cancelled:
			return {
				label: 'Deployment cancelled. Stake refunded.',
				stakeLabel,
				tone: 'idle',
			};
		case ARMY_STATUS.Unrevealed:
			return {
				label: 'Deployment never revealed.',
				stakeLabel,
				tone: 'bad',
			};
		case ARMY_STATUS.Captured:
			return {
				label: isStoneArmy(army)
					? 'King taken, but its captor fell too: now a stone holding its stake.'
					: 'King taken: its stake went to the captor.',
				stakeLabel,
				tone: 'bad',
			};
		case ARMY_STATUS.Exited:
			return {
				label: 'King exited with its stake.',
				stakeLabel,
				tone: 'good',
			};
		case ARMY_STATUS.Frozen:
			return {
				label: 'Army frozen (missed reveal). It can still be captured.',
				stakeLabel,
				tone: 'bad',
			};
		default:
			return undefined;
	}
}

/**
 * What became of the account's last deployment, in the player's words, while it
 * is the reason they are deploying again. The contract does not say WHICH of the
 * two collisions failed it, so both are named.
 */
export function describeLastDeployment(params: {
	needsDeployment: boolean;
	last: ArmyWords | undefined;
}): HudModel['lastDeployment'] {
	const {last} = params;
	if (!params.needsDeployment || !last) return undefined;
	switch (last.status) {
		case ARMY_STATUS.Failed:
			return {
				label:
					'Last deployment failed (spawn point taken or blocked). Pick a spawn point to deploy again.',
				stakeLabel:
					last.stake > 0n
						? `${STAKE.amount(last.stake)} refund pending, collected on your next deployment or withdrawal.`
						: 'Stake refunded to your reserve.',
				tone: 'bad',
			};
		case ARMY_STATUS.Cancelled:
			return {
				label: 'Last deployment cancelled. Pick a spawn point to deploy again.',
				stakeLabel: 'Stake refunded to your reserve.',
				tone: 'idle',
			};
		case ARMY_STATUS.Unrevealed:
			return {
				label: 'Last deployment never revealed. Pick a spawn point to deploy again.',
				stakeLabel:
					last.stake > 0n
						? `${STAKE.amount(last.stake)} lost: burned when settled.`
						: 'Stake burned.',
				tone: 'bad',
			};
		case ARMY_STATUS.Captured:
			return isStoneArmy(last)
				? {
						label:
							'Your king is a stone now (its captor fell too). Pick a spawn point to deploy again.',
						stakeLabel: `${STAKE.amount(last.stake)} stays in the stone for whoever captures it.`,
						tone: 'bad',
					}
				: {
						label: 'Your king was taken. Pick a spawn point to deploy again.',
						stakeLabel: 'Your stake went to your captor.',
						tone: 'bad',
					};
		case ARMY_STATUS.Exited:
			return {
				label: 'Your king exited. Pick a spawn point to deploy again.',
				stakeLabel:
					last.stake > 0n
						? `${STAKE.amount(last.stake)} waiting to be paid out.`
						: 'Stake paid out.',
				tone: 'good',
			};
		case ARMY_STATUS.Frozen:
			return {
				label:
					'Your army is frozen (missed reveal). Pick a spawn point to deploy again.',
				stakeLabel: `${STAKE.amount(last.stake)} stays on the board with it.`,
				tone: 'bad',
			};
		default:
			return undefined;
	}
}

/**
 * The payout an exited army is still owed, in the chain's currency: its stake
 * redeemed at the sale's fixed price (`StakeSale.redeem`, rounded down).
 */
export function describeExitPayout(params: {
	army: Pick<ArmyView, 'id' | 'stake'> | undefined;
	payout: ExitPayoutState;
	sale: {price: bigint; amount: bigint};
	symbol: string;
}): HudModel['exitPayout'] {
	const {army, payout, sale} = params;
	if (!army) return undefined;
	const value =
		sale.amount === 0n ? 0n : (army.stake * sale.price) / sale.amount;
	const valueLabel = chainValueLabel(value, params.symbol);
	return {
		army: army.id,
		headline: 'Your king exited!',
		detail: `${STAKE.amount(army.stake)} pays out as ${valueLabel}.`,
		actionLabel: payout.busy
			? 'Paying out...'
			: `Collect ${STAKE.amount(army.stake)} (${valueLabel})`,
		busy: payout.busy,
		error: payout.error,
	};
}

/**
 * What the played army may claim of a table that is over, in the same shape
 * as an exit's payout, whose button sends the table's `claim` at a table.
 */
export function describeTableClaim(params: {
	claim: TableClaim | undefined;
	payout: ExitPayoutState;
	sale: {price: bigint; amount: bigint};
	symbol: string;
}): HudModel['exitPayout'] {
	const {claim, payout, sale} = params;
	if (!claim) return undefined;
	const valueLabel =
		claim.share === undefined || sale.amount === 0n
			? undefined
			: `${STAKE.amount(claim.share)} (${chainValueLabel(
					(claim.share * sale.price) / sale.amount,
					params.symbol,
				)})`;
	return {
		army: claim.army,
		headline: claim.winner ? 'Last king standing!' : 'Table over.',
		detail: claim.winner
			? 'Every stake at the table is yours.'
			: 'Stakes split by material left: pawn 1, knight/bishop 3, rook 5, queen 9.',
		actionLabel: payout.busy
			? 'Paying out...'
			: valueLabel
				? `Collect ${valueLabel}`
				: claim.winner
					? 'Collect every stake'
					: 'Collect your share',
		busy: payout.busy,
		error: payout.error,
	};
}

/** A spawn point's coordinates, as a player reads them. */
export function spawnPointLabel(
	point: Pick<SpawnPointView, 'position'>,
): string {
	return `(${point.position.x}, ${point.position.y})`;
}

/** The open spawn points, while the army still has to be deployed. */
export function describeDeployment(params: {
	needsDeployment: boolean;
	view: ViewStateValue<BoardView>;
}): HudModel['deployment'] {
	if (!params.needsDeployment || params.view.step !== 'Loaded') {
		return undefined;
	}
	const {view} = params;
	return {
		spawnPoints: view.spawnPoints.map((point) => ({
			spawnPoint: point.spawnPoint,
			label: spawnPointLabel(point),
			nearest: nearestLabel(point.nearest),
			picked: view.planned?.spawnPoint === point.spawnPoint,
		})),
		...(view.planned ? {picked: spawnPointLabel(view.planned)} : {}),
	};
}

/** The planned piece-moves, while the army stands on the board and may move. */
export function describeMoving(params: {
	army: Pick<ArmyView, 'status'> | undefined;
	moves: readonly Move[];
	maxPieceMoves?: number;
	refusal?: string;
}): HudModel['moving'] {
	if (params.army?.status !== ARMY_STATUS.Deployed) return undefined;
	const {moves, maxPieceMoves, refusal} = params;
	return {
		pieceMoves: moves.map((move, index) => ({
			from: move.from,
			label: pieceMoveLabel(move),
			colour: plannedMoveColour(index),
		})),
		...(maxPieceMoves !== undefined
			? {
					countLabel:
						maxPieceMoves === 1
							? `${moves.length} of 1 piece-move`
							: `${moves.length} of ${maxPieceMoves} piece-moves`,
				}
			: {}),
		...(refusal !== undefined ? {refusal} : {}),
		hint: movingHint(moves.length, maxPieceMoves),
	};
}

/** What to tap next while moving: a first piece, another, or just commit. */
function movingHint(planned: number, maxPieceMoves?: number): string {
	if (planned === 0)
		return 'Tap a piece, then a square. Red squares may be attacked.';
	if (maxPieceMoves !== undefined && planned >= maxPieceMoves)
		return 'Commit when ready. Red squares may be attacked.';
	return 'Commit when ready, or plan another. Red squares may be attacked.';
}

/** The last cycle's captures and collisions, when it had any. */
export function describeLastCycle(
	view: ViewStateValue<BoardView>,
): HudModel['lastCycle'] {
	if (view.step !== 'Loaded' || view.outcomes.length === 0) return undefined;
	return {
		cycleNumber: view.outcomesCycle,
		lines: describeOutcomes(view.outcomes, positionOf, view.you),
	};
}

/** The clock {@link describeRevealDeadline} reads, from the cycle tracker. */
function deadlineClockOf(
	cycle: CycleInfo,
): Parameters<typeof describeRevealDeadline>[0]['cycle'] {
	if (cycle.type !== 'timed' && cycle.type !== 'hybrid') {
		// No clock, so no deadline: a manual cycle waits for every reveal.
		return {
			currentCycleNumber: cycle.currentCycleNumber,
			isCommitPhase: cycle.isCommitPhase,
			revealPhaseDuration: 0,
			secondsToRevealEnd: undefined,
		};
	}
	return {
		currentCycleNumber: cycle.currentCycleNumber,
		isCommitPhase: cycle.isCommitPhase,
		revealPhaseDuration: cycle.config.revealPhaseDuration,
		secondsToRevealEnd: cycle.timeLeftForRevealEnd,
	};
}

export function createHud(context: Context): Readable<HudModel> {
	const {game} = context;

	return derived(
		[
			game.twoPhase,
			game.phase,
			game.submission,
			game.planning.count,
			game.cost,
			game.reserve,
			game.cycleInfo,
			game.missedReveal,
			game.setup,
			game.acquisition,
			game.recovery,
			game.savedTurn,
			game.revealSchedule ?? NO_REVEAL_SCHEDULE,
			game.submission.ready,
			game.needsDeployment,
			game.armies.activeArmy,
			context.viewState,
			game.planning.pieceMoves,
			game.planning.maxPieceMoves,
			game.planning.refusal,
			game.armies.lastOutcome,
			game.armies.pendingRefund,
			game.armies.unpaidExit,
			game.exitPayout,
			game.tableClaim ?? NO_TABLE_CLAIM,
		],
		([
			$twoPhase,
			$phase,
			$submission,
			$count,
			$cost,
			$reserve,
			$cycle,
			$missedReveal,
			$setup,
			$acquisition,
			$recovery,
			$savedTurn,
			$revealSchedule,
			$ready,
			$needsDeployment,
			$army,
			$view,
			$pieceMoves,
			$maxPieceMoves,
			$refusal,
			$lastOutcome,
			$refund,
			$unpaidExit,
			$exitPayout,
			$tableClaim,
		]): HudModel => {
			const savedTurn = describeSavedTurn($savedTurn as SavedTurn);
			const revealSchedule = describeRevealSchedule(
				$revealSchedule as ScheduledReveal | undefined,
				$submission,
			);
			const submission = describeSubmission($submission);
			const reserve = $reserve as ReserveState;
			const reserveAmount =
				reserve.step === 'Loaded' ? reserve.amount : undefined;
			// A failed deployment's pending refund is written before a deployment
			// takes its stake, so it pays for one.
			const spendable =
				reserveAmount === undefined
					? undefined
					: reserveAmount + ($refund as bigint);
			const blocked = blocksCommitting($missedReveal as MissedRevealState);

			// `twoPhase` on a manually advanced chain has no clock, only a phase, so
			// the countdown comes from it while the LABEL comes from the four-part
			// model. They are asked separately because the catch-up has no
			// countdown at all: it lasts until a fetch lands, however long that is.
			const timeLeft = 'timeLeft' in $twoPhase ? $twoPhase.timeLeft : 0;
			const duration = 'duration' in $twoPhase ? $twoPhase.duration : 0;
			const phase = $phase as CyclePhase;
			const playable = phase === 'play';

			const acquisition = $acquisition as AcquisitionState;
			const needsSetup = describeSetup($setup as SetupNeeded | undefined, {
				busyLabel: acquisitionBusyLabel(acquisition),
				// THE TOTAL, not the price. The wallet is about to ask for
				// `price + stipend`, and the two can differ by orders of magnitude: a
				// button that understates what is about to be charged is worse than
				// one with no number on it.
				priceLabel: chainValueLabel(
					acquisitionTotal(game.config.sale),
					context.deployments.get().chain.nativeCurrency.symbol,
				),
			});
			if (needsSetup?.action === 'stake') {
				needsSetup.busy = needsSetup.busyLabel !== undefined;
				needsSetup.error =
					acquisition.step === 'Error' ? acquisition.message : undefined;
			}

			return {
				// Never invite a move the player cannot make: while they are still
				// being set up the clock is just a clock.
				phaseLabel: needsSetup ? 'Cycle in progress' : phaseLabelOf(phase),
				phase,
				secondsLeft: Math.max(0, Math.ceil(timeLeft)),
				progress:
					duration > 0 ? Math.min(1, Math.max(0, 1 - timeLeft / duration)) : 0,
				cycleNumber: $cycle.currentCycleNumber,
				countdown: describeCountdown($cycle as CycleInfo),
				// Outside the play window the current cycle is closed, so a click now
				// is a plan for the next one. The submission stamps it that way. Not worth
				// saying to someone who cannot play at all yet.
				planningForNextCycle: !playable && !needsSetup,
				setup: needsSetup,
				acquiring: acquisitionBusyLabel(acquisition),
				// `hasLocalSigner` is `TARGET_STEP === 'SignedIn'`, and NOTHING ELSE.
				// It is not about hosted sign-in, and core says so where it is
				// defined: "Deliberately NOT 'is PUBLIC_WALLET_HOST set': a
				// wallet-only sign-in has no host and still derives a signer, so
				// testing the host would get it wrong."
				//
				// This notice used to say the opposite - that no hosted sign-in was
				// configured, and that setting PUBLIC_WALLET_HOST would give the
				// player a local signing key. Both halves were wrong, and together
				// they sent anyone who read it to configure a wallet host and still
				// have no signer: a signer is derived from a wallet signature with no
				// service involved, so `SignedIn` + wallet-only is complete and
				// backend-free. The knob is TARGET_STEP, which is code, not env.
				walletSigningNotice: context.hasLocalSigner
					? undefined
					: "No local signing key: every move needs a wallet signature. Set TARGET_STEP to 'SignedIn' in core/connection/mode.ts.",

				plannedCount: $count,
				costLabel: STAKE.amount($cost),
				reserveLabel:
					reserveAmount === undefined ? '-' : STAKE.amount(reserveAmount),
				warning:
					// First: until it is loaded a click plans nothing at all.
					(!$ready ? LOADING_ACCOUNT : undefined) ??
					(spendable !== undefined && $cost > spendable
						? STAKE.notEnough
						: undefined),

				army: describeArmy($army as ArmyView | undefined),
				lastDeployment: describeLastDeployment({
					needsDeployment: $needsDeployment as boolean,
					last: $lastOutcome as ArmyView | undefined,
				}),
				deployment: describeDeployment({
					needsDeployment: $needsDeployment as boolean,
					view: $view as ViewStateValue<BoardView>,
				}),
				moving: describeMoving({
					army: $army as ArmyView | undefined,
					moves: $pieceMoves as readonly Move[],
					maxPieceMoves: $maxPieceMoves as number | undefined,
					refusal: $refusal as string | undefined,
				}),
				lastCycle: describeLastCycle($view as ViewStateValue<BoardView>),

				submissionLabel: submission.label,
				submissionTone: submission.tone,
				missedReveal: describeMissedReveal($missedReveal as MissedRevealState),
				exitPayout:
					describeExitPayout({
						army: $unpaidExit as ArmyView | undefined,
						payout: $exitPayout as ExitPayoutState,
						sale: game.config.sale,
						symbol: context.deployments.get().chain.nativeCurrency.symbol,
					}) ??
					describeTableClaim({
						claim: $tableClaim as TableClaim | undefined,
						payout: $exitPayout as ExitPayoutState,
						sale: game.config.sale,
						symbol: context.deployments.get().chain.nativeCurrency.symbol,
					}),
				recovery: describeRecovery($recovery as RecoveryState, $count),
				savedTurn,
				revealSchedule,
				revealDeadline: describeRevealDeadline({
					cycle: deadlineClockOf($cycle as CycleInfo),
					submission: $submission,
					revealSchedule: revealSchedule?.step,
				}),
				// Committing early is allowed the whole time the phase is open; the
				// submission commits by itself if the player leaves it too late. An
				// unrevealed commitment blocks it entirely: the contract would reject
				// it, so offering the button would only spend gas to be told no.
				// A failed commit can be tried again while the phase is open: the
				// plan is still here and nothing was spent.
				canCommit:
					!blocked &&
					!savedTurn &&
					($submission.step === 'Planning' ||
						($submission.step === 'Error' &&
							$submission.during === 'commit')) &&
					$count > 0 &&
					// The contract would refuse it: committed, its reveal would revert.
					$refusal === undefined &&
					playable,
				// A pass: an empty submission, for a deployed army whose cycle waits
				// for everyone. Nothing pending this cycle, so it is not a re-commit.
				canPass:
					!blocked &&
					!savedTurn &&
					playable &&
					!($needsDeployment as boolean) &&
					game.config.cycle.policy === 'manual' &&
					($army as ArmyView | undefined)?.status === ARMY_STATUS.Deployed &&
					!(
						'cycleNumber' in $submission &&
						$submission.cycleNumber === $cycle.currentCycleNumber &&
						$submission.step !== 'Planning'
					),
				// Offered as a fallback only. The submission reveals on its own, because a
				// missed reveal forfeits the bond and the window can be seconds long.
				canReveal:
					$submission.step === 'Error' && $submission.during === 'reveal',
				canClear: $submission.step === 'Planning' && $count > 0,
				outOfGas:
					$submission.step === 'Error' &&
					$submission.error instanceof SignerOutOfFundsError
						? {
								detail:
									'Your play key is out of gas. Top up and this turn carries on.',
							}
						: undefined,
			};
		},
	);
}
