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
	notEnough: 'Not enough in your reserve to deploy an army.',

	/**
	 * The setup gate's stake step: one transaction buys one army's stake and
	 * funds the key this browser plays with.
	 */
	setup: {
		headline: 'Buy a stake to deploy an army',
		detail:
			'An army holds a fixed stake. One transaction buys it into your reserve, which only you can withdraw, and funds the key this browser plays with. Deploying moves the stake into the army, which keeps it until its king leaves through an exit or is captured.',
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
			? `${this.amount(forfeit)} is forfeit, and this army cannot commit again until you acknowledge it.`
			: 'This army cannot commit again until you acknowledge it.';
	},

	/** What the acquisition dialog says is being bought. */
	acquireExplanation:
		'One transaction puts one army\u2019s stake in your reserve and funds the key this browser plays with. Whoever pays, the reserve belongs to your account, and only your account can withdraw it.',
};
