import {describe, expect, it} from 'vitest';
import {parseEther, parseGwei} from 'viem';
import {chainValueLabel} from '$lib/chess/ui/chain-value';
import {describeExitPayout, describeTableClaim} from '$lib/chess/ui/hud';

/** The sale as `contracts/rocketh/config.ts` deploys it: 10 TOK for 10 gwei. */
const sale = {price: parseEther('0.00000001'), amount: parseEther('10')};

describe('a chain-currency value', () => {
	it('is shown in gwei below 0.001 of the currency', () => {
		expect(chainValueLabel(parseGwei('10'), 'ETH')).toBe('10 gwei');
		expect(chainValueLabel(parseEther('0.000999'), 'ETH')).toBe('999000 gwei');
	});

	it('is shown in the currency from 0.001 of it', () => {
		expect(chainValueLabel(parseEther('0.001'), 'ETH')).toBe('0.001 ETH');
		expect(chainValueLabel(parseEther('2.5'), 'ETH')).toBe('2.5 ETH');
	});

	it('never reads as nothing when it is something', () => {
		expect(chainValueLabel(1n, 'ETH')).toBe('1 wei');
		expect(chainValueLabel(0n, 'ETH')).toBe('0 ETH');
	});
});

describe('the payout labels at the current sale price', () => {
	it('offer an exit as its stake in TOK and its value in gwei', () => {
		const owed = describeExitPayout({
			army: {id: 7n, stake: parseEther('10')},
			payout: {busy: false},
			sale,
			symbol: 'ETH',
		});
		expect(owed?.actionLabel).toBe('Collect 10 TOK (10 gwei)');
		expect(owed?.headline).toBe('Your king exited!');
		expect(owed?.detail).toBe('10 TOK pays out as 10 gwei.');
	});

	it('offer a table claim as its share in TOK and its value in gwei', () => {
		const claim = describeTableClaim({
			claim: {army: 3n, winner: true, share: parseEther('30')},
			payout: {busy: false},
			sale,
			symbol: 'ETH',
		});
		expect(claim?.actionLabel).toBe('Collect 30 TOK (30 gwei)');
		expect(claim?.headline).toBe('Last king standing!');
	});

	it('still name the claim when its share is not known yet', () => {
		const label = (winner: boolean) =>
			describeTableClaim({
				claim: {army: 3n, winner, share: undefined},
				payout: {busy: false},
				sale,
				symbol: 'ETH',
			})?.actionLabel;
		expect(label(true)).toBe('Collect every stake');
		expect(label(false)).toBe('Collect your share');
	});
});
