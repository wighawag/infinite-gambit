/**
 * A value in the chain's own currency, in a unit that shows it.
 *
 * `formatBalance` fits a value into 7 characters, so a stake's price (10 gwei
 * at the deployed sale) reads as `>0 ETH`. Below 0.001 of the currency this
 * switches to gwei, and below one gwei to wei, so a non-zero value never reads
 * as nothing. `formatBalance` is upstream's (`$lib/core`), so the unit choice
 * lives here rather than in it.
 */
import {formatBalance} from '$lib/core/utils/format/balance';

const GWEI = 10n ** 9n;
/** 0.001 of an 18-decimal currency: from here the currency itself reads. */
const CURRENCY_THRESHOLD = 10n ** 15n;

export function chainValueLabel(value: bigint, symbol: string): string {
	const size = value < 0n ? -value : value;
	if (size === 0n || size >= CURRENCY_THRESHOLD) {
		return `${formatBalance(value)} ${symbol}`;
	}
	if (size >= GWEI) return `${formatBalance(value, 9)} gwei`;
	return `${value} wei`;
}
