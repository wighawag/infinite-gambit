/**
 * How pieces look: a glyph per kind and a colour per army. Presentation only.
 */
import {PIECE_KIND, type PieceKind} from '../board';
import {ARMY_STATUS, type ArmyView} from '../armies';
import {positionOf} from '../squares';

const GLYPHS: Record<PieceKind, string> = {
	[PIECE_KIND.None]: '',
	[PIECE_KIND.Pawn]: '\u265F',
	[PIECE_KIND.Knight]: '\u265E',
	[PIECE_KIND.Bishop]: '\u265D',
	[PIECE_KIND.Rook]: '\u265C',
	[PIECE_KIND.Queen]: '\u265B',
	[PIECE_KIND.King]: '\u265A',
	// A stone is drawn on a square tile (`STONE_COLOUR`), never a disc.
	[PIECE_KIND.Stone]: '\u25C6',
};

/** The chess glyph a piece is drawn with. */
export function glyphOf(kind: PieceKind): string {
	return GLYPHS[kind] ?? '?';
}

/**
 * A STONE's tile: a taken king that never moves again and holds its army's
 * stake (`docs/adr/0014`). Drawn as a square rather than a disc, so it is never
 * read as a piece anyone plays, and edged in the colour of the army it was.
 */
export const STONE_COLOUR = '#8d8579';

/** Whether a piece is drawn as a stone. */
export const isStone = (kind: PieceKind): boolean => kind === PIECE_KIND.Stone;

/**
 * A FROZEN army's pieces: its own hue, drained of colour, so it stays told
 * apart from the other frozen armies and from a stone's tile.
 */
export function frozenColour(army: bigint): string {
	const hue = Number((army ^ (army >> 160n)) % 300n) + 60;
	return `hsl(${hue % 360}, 12%, 58%)`;
}

/** The ring a frozen army's pieces are drawn with. */
export const FROZEN_RING = '#cfe8ff';

/** The colour of the army this client plays. */
export const YOUR_COLOUR = '#ffd166';

/**
 * The colours other armies are drawn in: few enough that each is told apart
 * at a glance, differing in lightness as well as hue (so they survive colour
 * blindness), and none close to the player's gold, the frozen grey or the
 * planned-move marks.
 */
export const ARMY_PALETTE = [
	'#e6194b', // red
	'#3cb44b', // green
	'#4363d8', // blue
	'#f58231', // orange
	'#911eb4', // purple
	'#f032e6', // magenta
	'#9a6324', // brown
	'#469990', // teal
	'#fabed4', // pink
] as const;

/** An army's own palette slot, from its id alone. */
const slotOf = (army: bigint): number =>
	Number((army ^ (army >> 160n)) % BigInt(ARMY_PALETTE.length));

/**
 * Two armies whose spawn points are at most this many squares apart (on
 * either axis) are near enough to meet, so they are given different colours
 * whenever the palette allows.
 */
export const NEAR_SPAWN = 48;

/**
 * WHICH COLOUR EACH ARMY IS DRAWN IN, so armies that may meet do not share one.
 *
 * Armies are taken in registry order (`getArmies`, the order they were
 * created, the same for every client). Each starts from its own slot
 * ({@link slotOf}) and takes the first colour, from there on, that the fewest
 * EARLIER armies with a spawn point near its own already hold. An army's
 * colour therefore depends only on itself and the armies before it, and only
 * on what never changes once revealed (id, order, spawn point): it is stable
 * across reloads and devices and never changes while the army plays, even as
 * others are captured, exit or deploy after it. The one exception: while an
 * earlier army deploying in the same cycle has not revealed yet, a later one
 * may change colour once when it does, before either has moved.
 *
 * Not a rule of the game: presentation only.
 */
export function armyColoursOf(
	armies: readonly Pick<ArmyView, 'id' | 'spawnPoint' | 'status'>[],
): Map<bigint, string> {
	const cached = CACHE.get(armies);
	if (cached) return cached;
	const colours = new Map<bigint, string>();
	const placed: {x: number; y: number; slot: number}[] = [];
	for (const army of armies) {
		// Not landed: nothing of it drawn. Its status, not a zero spawn point,
		// says so: the origin square packs to zero and may be a spawn point.
		if (!LANDED.has(army.status)) continue;
		const {x, y} = positionOf(army.spawnPoint);
		const taken = new Array<number>(ARMY_PALETTE.length).fill(0);
		for (const other of placed) {
			if (
				Math.abs(other.x - x) <= NEAR_SPAWN &&
				Math.abs(other.y - y) <= NEAR_SPAWN
			) {
				taken[other.slot]++;
			}
		}
		const own = slotOf(army.id);
		let slot = own;
		for (let i = 1; i < ARMY_PALETTE.length; i++) {
			const candidate = (own + i) % ARMY_PALETTE.length;
			if (taken[candidate] < taken[slot]) slot = candidate;
		}
		placed.push({x, y, slot});
		colours.set(army.id, ARMY_PALETTE[slot]);
	}
	CACHE.set(armies, colours);
	return colours;
}

/** Statuses of an army that stood on its spawn point. */
const LANDED: ReadonlySet<number> = new Set([
	ARMY_STATUS.Deployed,
	ARMY_STATUS.Captured,
	ARMY_STATUS.Exited,
	ARMY_STATUS.Frozen,
]);

/** One assignment per registry read: views are re-derived far more often. */
const CACHE = new WeakMap<object, Map<bigint, string>>();

/**
 * The colour an army is drawn in: its entry in `colours`
 * ({@link armyColoursOf}) when there is one, else its own palette slot.
 */
export function armyColour(
	army: bigint,
	colours?: ReadonlyMap<bigint, string>,
): string {
	return colours?.get(army) ?? ARMY_PALETTE[slotOf(army)];
}

/**
 * A colour per planned piece-move, by its place in the move: the first gold,
 * the second cyan, the third magenta, so up to three marks on the board stay
 * apart, and the HUD names each in the colour it is drawn in.
 */
export const PLANNED_MOVE_COLOURS = ['#ffd166', '#5ad1e6', '#e07ad6'] as const;

/** The colour the `index`-th planned piece-move of a move is drawn in. */
export function plannedMoveColour(index: number): string {
	return PLANNED_MOVE_COLOURS[index % PLANNED_MOVE_COLOURS.length];
}
