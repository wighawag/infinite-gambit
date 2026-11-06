/**
 * WHAT THIS GAME PUTS AT STAKE, in the words a player reads.
 *
 * `./reserve.ts` is what the stake IS; this is what it is CALLED. Kept apart so
 * the HUD model and the play route can describe the stake without the store
 * carrying UI copy.
 */
import {formatBalance} from '$lib/core/utils/format/balance';

export const STAKE = {
	/** An amount of the stake, as a player reads it. */
	amount(value: bigint): string {
		return `${formatBalance(value)} TOK`;
	},

	/** The account's reserve cannot pay for a deployment. */
	notEnough: 'Not enough in reserve to deploy.',

	/**
	 * The setup gate's stake step: one transaction buys one army's stake and
	 * funds the key this browser plays with.
	 */
	setup: {
		headline: 'Buy a stake to play',
		detail:
			'One transaction buys an army\u2019s stake and gas for your play key. Your king leaves through an exit with it.',
		/** The button, with the total the wallet is about to ask for. */
		action(priceLabel?: string): string {
			return priceLabel ? `Buy a stake for ${priceLabel}` : 'Buy a stake';
		},
	},

	/**
	 * What a missed reveal cost, and what to do next. The amount is what
	 * settling will take: a missed deployment's whole stake, a missed pass
	 * nothing.
	 */
	forfeited(forfeit: bigint): string {
		return forfeit > 0n
			? `${this.amount(forfeit)} is forfeit. Acknowledge to play on.`
			: 'Acknowledge to play on.';
	},

	/** What the acquisition dialog says is being bought. */
	acquireExplanation:
		'One transaction: an army\u2019s stake into your reserve, plus gas for your play key. Only your account can withdraw the reserve.',
};
