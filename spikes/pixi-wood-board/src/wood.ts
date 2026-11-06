/**
 * Procedural wood, after the Devcon board: maple for the light squares,
 * rosewood for the dark ones.
 *
 * One texture per species is generated once, on a canvas, and every square
 * samples a different window of it (see board.ts), the way each square of a
 * real board is its own cut of veneer. Nothing is downloaded, the result is
 * deterministic for a seed, and there is no shader to maintain: it's a few
 * hundred thousand noise evaluations at start-up, well under 100 ms.
 *
 * The grain runs along x. Three layers make it read as wood rather than noise:
 *   - growth rings: a sine across the grain, bent by low-frequency noise so the
 *     lines wander, and sharpened so they are thin dark lines on a lighter field;
 *   - streaks: long, soft, darker bands along the grain (rosewood has strong
 *     ones, maple barely any);
 *   - pores: short, thin, high-frequency dashes along the grain, the texture you
 *     see up close.
 */

export type Rgb = [number, number, number];

export type Species = {
	/** The field colour, the lightest the wood gets apart from the sheen. */
	base: Rgb;
	/** The colour of a ring line or a streak at full strength. */
	dark: Rgb;
	/** Rings across the texture's height. */
	rings: number;
	/** How far the rings wander, in ring periods. */
	warp: number;
	/** Darkness of a ring line, 0 to 1. */
	ringContrast: number;
	/** Higher is thinner ring lines. */
	ringSharpness: number;
	/** Darkness of the long streaks, 0 to 1. */
	streaks: number;
	/** Darkness of the pores, 0 to 1. */
	pores: number;
};

/** Pale and quiet, with fine grain: the light squares and the white army. */
export const MAPLE: Species = {
	base: [234, 216, 176],
	dark: [204, 172, 122],
	rings: 46,
	warp: 2.2,
	ringContrast: 0.32,
	ringSharpness: 6,
	streaks: 0.18,
	pores: 0.16,
};

/** Reddish brown with strong dark streaks: the dark squares. */
export const ROSEWOOD: Species = {
	base: [146, 86, 50],
	dark: [52, 26, 12],
	rings: 64,
	warp: 3,
	ringContrast: 0.5,
	ringSharpness: 4,
	streaks: 0.75,
	pores: 0.22,
};

// ---- noise ---------------------------------------------------------------

function hash(x: number, y: number, seed: number): number {
	let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	h ^= h >>> 16;
	return (h >>> 0) / 4294967296;
}

function valueNoise(x: number, y: number, seed: number): number {
	const ix = Math.floor(x);
	const iy = Math.floor(y);
	const fx = x - ix;
	const fy = y - iy;
	const sx = fx * fx * (3 - 2 * fx);
	const sy = fy * fy * (3 - 2 * fy);
	const a = hash(ix, iy, seed);
	const b = hash(ix + 1, iy, seed);
	const c = hash(ix, iy + 1, seed);
	const d = hash(ix + 1, iy + 1, seed);
	return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function fbm(x: number, y: number, seed: number, octaves = 4): number {
	let sum = 0;
	let amp = 0.5;
	let norm = 0;
	for (let i = 0; i < octaves; i++) {
		sum += valueNoise(x, y, seed + i * 17) * amp;
		norm += amp;
		amp *= 0.5;
		x *= 2.03;
		y *= 2.03;
	}
	return sum / norm;
}

// ---- the texture -----------------------------------------------------------

/**
 * A square canvas of the given wood. `size` is in texture pixels; 512 gives
 * each square of the board a 128-pixel window, enough to stay sharp up to about
 * 2x zoom on a 64-pixel cell.
 */
export function woodCanvas(species: Species, size = 512, seed = 1): HTMLCanvasElement {
	const canvas = document.createElement('canvas');
	canvas.width = size;
	canvas.height = size;
	const context = canvas.getContext('2d');
	if (!context) throw new Error('no 2d context');
	const image = context.createImageData(size, size);
	const data = image.data;
	const {base, dark} = species;

	for (let y = 0; y < size; y++) {
		const v = y / size;
		for (let x = 0; x < size; x++) {
			const u = x / size;
			// rings: across the grain (v), wandering with low-frequency noise
			const bend = fbm(u * 1.2, v * 2.5, seed) * species.warp;
			const ringPhase = v * species.rings + bend;
			const ring = Math.pow(0.5 + 0.5 * Math.cos(ringPhase * Math.PI * 2), species.ringSharpness);
			// streaks: long along the grain, narrow across it
			const streak = Math.max(0, fbm(u * 0.6, v * 18 + bend * 0.15, seed + 101) - 0.5) * 2.4;
			// pores: short dashes along the grain
			const pore = Math.max(0, valueNoise(u * 60, v * size * 0.9, seed + 202) - 0.7) * 3.3;

			let k = ring * species.ringContrast + streak * species.streaks + pore * species.pores;
			if (k > 1) k = 1;
			// a faint large-scale variation in tone, as between two boards
			const tone = 0.94 + 0.12 * fbm(u * 1.5, v * 1.5, seed + 303, 2);

			const i = (y * size + x) * 4;
			data[i] = (base[0] + (dark[0] - base[0]) * k) * tone;
			data[i + 1] = (base[1] + (dark[1] - base[1]) * k) * tone;
			data[i + 2] = (base[2] + (dark[2] - base[2]) * k) * tone;
			data[i + 3] = 255;
		}
	}
	context.putImageData(image, 0, 0);
	return canvas;
}
