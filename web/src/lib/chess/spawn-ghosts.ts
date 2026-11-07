/**
 * THE OPEN SPAWN POINTS, AS GHOST ARMIES: where an army deployed at each would
 * stand, so a spawn point reads as "an army could be here" rather than as a
 * frame laid over the wood.
 *
 * THE LAYOUT IS THE CONTRACT'S. Each spawn point is asked `previewDeployment`
 * in the sandbox, as the planned one is (`./preview.ts`), never laid out from a
 * TypeScript copy of `ChessRules.layout`
 * (`docs/adr/0007-rules-live-only-in-the-contract.md`). Not asked once and
 * translated either: that would assume the layout never depends on where it
 * lands, which is the rule's to say. The answer for a spawn point never
 * changes (the rule is `pure`), so it is asked once per spawn point and kept.
 *
 * Which army it is for does not change where it stands, and a ghost belongs to
 * nobody, so it is asked for army 0.
 *
 * Also here: which spawn point the mouse is over (`hoveredSpawnPoint`), so the
 * one a click would pick lights up before the click.
 */
import {derived, readable, writable, type Readable} from 'svelte/store';
import type {OnchainStateValue} from '$lib/game/core/seams';
import {pieceOf, type BoardState, type Piece} from './board';
import type {LocalPlan} from './view';

/** `previewDeployment`, run in the sandbox. */
export type SimulateDeployment = (
	spawnPoint: bigint,
	army: bigint,
) => Promise<readonly Parameters<typeof pieceOf>[0][]>;

export type SpawnGhosts = ReadonlyMap<bigint, readonly Piece[]>;

/**
 * How many answers are gathered before they are published: each publication
 * re-merges the view and redraws the board, so a first screen of spawn points
 * arrives in a few steps rather than one per spawn point.
 */
const PUBLISH_EVERY = 8;

export function createSpawnGhosts(params: {
	board: Readable<OnchainStateValue<BoardState>>;
	simulate: SimulateDeployment;
}): Readable<SpawnGhosts> {
	const known = new Map<bigint, readonly Piece[]>();
	return readable<SpawnGhosts>(new Map(), (set) => {
		let stopped = false;
		let queue: bigint[] = [];
		const asked = new Set<bigint>();
		let draining = false;

		async function drain() {
			if (draining) return;
			draining = true;
			let fresh = 0;
			while (!stopped && queue.length > 0) {
				const spawnPoint = queue.shift()!;
				try {
					const pieces = await params.simulate(spawnPoint, 0n);
					known.set(spawnPoint, pieces.map(pieceOf));
					fresh++;
				} catch {
					// The sandbox itself is likely down (it retries its own start on
					// each call): stop here rather than fail once per spawn point,
					// and ask all of them again the next time the board is read.
					for (const point of [spawnPoint, ...queue]) asked.delete(point);
					queue = [];
					break;
				}
				if (fresh >= PUBLISH_EVERY) {
					fresh = 0;
					if (!stopped) set(new Map(known));
				}
			}
			draining = false;
			if (fresh > 0 && !stopped) set(new Map(known));
		}

		const unsubscribe = params.board.subscribe(($board) => {
			if ($board.step !== 'Loaded') return;
			// what the board lists now goes first: a spawn point scrolled past
			// is still asked, only later
			const wanted = $board.spawnPoints.filter(
				(point) => !known.has(point) && !asked.has(point),
			);
			for (const point of wanted) asked.add(point);
			queue = [...wanted, ...queue];
			void drain();
		});
		if (known.size > 0) set(new Map(known));
		return () => {
			stopped = true;
			unsubscribe();
		};
	});
}

/** The spawn point a hovering mouse would pick, if any. */
export function createHoveredSpawnPoint() {
	const store = writable<bigint | undefined>(undefined);
	return {
		subscribe: store.subscribe,
		// a store does not notify for the same primitive, so a mouse moving
		// within one footprint redraws nothing
		hover: (spawnPoint: bigint | undefined) => store.set(spawnPoint),
	};
}

/** The plan with the ghost armies and the hovered spawn point attached. */
export function withSpawnGhosts(
	plan: Readable<LocalPlan>,
	ghosts: Readable<SpawnGhosts>,
	hovered: Readable<bigint | undefined>,
): Readable<LocalPlan> {
	return derived(
		[plan, ghosts, hovered],
		([$plan, $ghosts, $hovered]): LocalPlan => ({
			...$plan,
			spawnGhosts: $ghosts,
			...($hovered !== undefined ? {hovered: $hovered} : {}),
		}),
	);
}
