/**
 * Squares, packed the way the contract packs them, and the camera's fetch
 * unit.
 *
 * NOT A RULE OF THE GAME. How a coordinate pair is spelled as the `uint64` the
 * contract keys squares by (`contracts/src/utils/PositionUtils.sol`: y in the
 * high 32 bits, x in the low 32, both two's complement) is an ENCODING, and the
 * client has to speak it to name a square at all. Everything about what may
 * stand where is the contract's (`docs/adr/0007-rules-live-only-in-the-contract.md`).
 *
 * Zones are the client's own unit and the contract never sees one: the poller
 * caches by them, and the board reader turns the zones in view into ONE
 * rectangle for the contract's viewport read (`getPieces`).
 */

export type Position = {x: number; y: number};

const u32 = (v: number): bigint => BigInt.asUintN(32, BigInt(v));

/** Pack a coordinate pair into the contract's `uint64` square. */
export function squareAt(x: number, y: number): bigint {
	return (u32(y) << 32n) + u32(x);
}

/** The inverse of {@link squareAt}. */
export function positionOf(square: bigint): Position {
	return {
		x: Number(BigInt.asIntN(32, square & 0xffffffffn)),
		y: Number(BigInt.asIntN(32, BigInt.asUintN(32, square >> 32n))),
	};
}

/** Squares per zone side: how coarse the camera's fetch scope is. */
export const ZONE_SIZE = 16;

/** The zone a coordinate falls in, on one axis. Zone 0 is 0..15. */
export function zoneCoord(a: number): number {
	const zone = Math.floor(a / ZONE_SIZE);
	// `-0` would be a different key from `0` in anything comparing identities.
	return zone === 0 ? 0 : zone;
}

/** A zone, packed like a square so the poller can key by it. */
export function zoneAt(zx: number, zy: number): bigint {
	return squareAt(zx, zy);
}

/**
 * Every zone touching a rectangle of squares, inclusive. Ordered, so the same
 * rectangle always yields the same list (the poller's cache key).
 */
export function zonesInRect(rect: {
	left: number;
	top: number;
	right: number;
	bottom: number;
}): bigint[] {
	const zoneLeft = zoneCoord(Math.floor(rect.left));
	const zoneRight = zoneCoord(Math.ceil(rect.right));
	const zoneTop = zoneCoord(Math.floor(rect.top));
	const zoneBottom = zoneCoord(Math.ceil(rect.bottom));
	const zones: bigint[] = [];
	for (let zy = zoneTop; zy <= zoneBottom; zy++) {
		for (let zx = zoneLeft; zx <= zoneRight; zx++) {
			zones.push(zoneAt(zx, zy));
		}
	}
	return zones;
}

/** The squares a set of zones covers, as one inclusive rectangle. */
export function rectOfZones(zones: readonly bigint[]):
	| {
			minX: number;
			minY: number;
			maxX: number;
			maxY: number;
	  }
	| undefined {
	if (zones.length === 0) return undefined;
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const zone of zones) {
		const {x, y} = positionOf(zone);
		minX = Math.min(minX, x * ZONE_SIZE);
		minY = Math.min(minY, y * ZONE_SIZE);
		maxX = Math.max(maxX, x * ZONE_SIZE + ZONE_SIZE - 1);
		maxY = Math.max(maxY, y * ZONE_SIZE + ZONE_SIZE - 1);
	}
	return {minX, minY, maxX, maxY};
}

/** Chebyshev distance: how many king steps apart two squares are. */
export function kingDistance(a: Position, b: Position): number {
	return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}
