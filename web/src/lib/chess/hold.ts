/**
 * What this game holds back while a cycle resolves.
 *
 * The framework owns the WHEN (`game/core/handover.ts`); this is the one thing
 * it cannot own: which parts of THIS game's board the resolving cycle changed.
 *
 * In chess the resolving cycle's reveals change nothing a player can see until
 * the cycle is over: a deployment revealed now is placed at the END of the
 * cycle, and the contract's views already leave it out until then. So nothing
 * on the board needs hiding, and pieces PERSIST (an army has stood there since
 * before the cycle began), so a square merely panned onto is shown rather than
 * withheld. The open spawn points and the registry are the start-of-cycle
 * answers for the same reason. The latest board is shown as it is.
 */
import type {HoldResolvingCycle} from '$lib/game/core/handover';
import type {BoardState} from './board';

export type HeldBoardState = BoardState & {cycleNumber: number};

export const holdResolvingCycle: HoldResolvingCycle<HeldBoardState> = ({
	latest,
}) => latest;
