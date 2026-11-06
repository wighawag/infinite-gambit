/**
 * The turned piece set as SVG, from the shared piece data. Pure (no DOM, no
 * pixi), so what a piece looks like is tested in node; `pieces.ts` rasterises
 * it. Ported from `spikes/pixi-wood-board/src/pieces.ts`.
 *
 * `pieces.json` is a COPY of `assets/brand/game/pieces.json`, which
 * `assets/brand/game/pieces.py` writes. Edit `pieces.py`, regenerate, and copy
 * it here; never edit either JSON by hand. A test fails if the copy drifts.
 *
 * Each piece is a list of parts with a role:
 *   - `wood`: the finish's side-lit gradient, what makes a flat silhouette read
 *     as turned;
 *   - `band`: the collar and the felt pad, painted in the army colour;
 *   - `prism`: the king's crystal.
 */
import data from './pieces.json';

export type Kind = keyof typeof data.parts;
export type PartRole = 'wood' | 'band' | 'prism';

export const KINDS = Object.keys(data.parts) as Kind[];

/**
 * The two woods of the set (boxwood for the player's army, sheesham for every
 * other army) and two finishes that are not woods: `stone` and `ice` (a frozen
 * army). Both keep the silhouette, so you still see what the piece was. Which
 * piece gets which finish is the renderer's mapping from the view state, not
 * this module's.
 */
export const FINISHES = {
	...data.woods,
	stone: {light: '#d4d0c8', dark: '#7c7870', edge: '#34322e'},
	ice: {light: '#eef6fb', dark: '#9fb8cb', edge: '#3a5466'},
} as const;
export type Finish = keyof typeof FINISHES;

/** Texture pixels per piece. 256 keeps a piece sharp up to ~4x a 64 px cell. */
export const RASTER = 256;

/**
 * Where a piece's foot is in its texture, as a fraction of its height: the
 * sprite's anchor, so a piece stands on the lower part of its square and may
 * rise into the one above, as a real piece seen slightly from the side.
 */
export const FOOT = 248 / 256;

/** The roles of a kind's parts, in drawing order. */
export function partRoles(kind: Kind): PartRole[] {
	return data.parts[kind].map(([role]) => role as PartRole);
}

/** The cache key of a rasterised piece: one texture per kind, finish and band. */
export function pieceKey(kind: Kind, finish: Finish, band?: string): string {
	return `${kind}|${finish}|${band ?? ''}`;
}

/**
 * The SVG of one piece. `band` is the army colour (any CSS colour, `hsl(...)`
 * included, since it is only ever used inside the SVG); without one the band
 * parts take the finish like the rest of the piece.
 */
export function svgFor(kind: Kind, finish: Finish, band?: string): string {
	const {light, dark, edge} = FINISHES[finish];
	const stroke = `stroke="${edge}" stroke-width="7" stroke-linejoin="round" paint-order="stroke"`;
	const paths = data.parts[kind]
		.map(([role, d]) => {
			if (role === 'prism') {
				return `<path d="${d}" transform="${data.finialTransform}" fill="url(#prism)" ${stroke}/>`;
			}
			const fill = role === 'band' && band ? band : 'url(#wood)';
			return `<path d="${d}" fill="${fill}" fill-rule="evenodd" ${stroke}/>`;
		})
		.join('');
	return (
		`<svg xmlns="http://www.w3.org/2000/svg" width="${RASTER}" height="${RASTER}" viewBox="0 0 ${data.viewBox} ${data.viewBox}">` +
		`<defs><linearGradient id="wood" x1="0" x2="1"><stop offset="0" stop-color="${light}"/><stop offset="0.45" stop-color="${light}"/><stop offset="1" stop-color="${dark}"/></linearGradient>` +
		`<linearGradient id="prism" x1="0" x2="1"><stop offset="0.5" stop-color="#ffffff"/><stop offset="0.5" stop-color="#cfd8ee"/></linearGradient></defs>` +
		paths +
		`</svg>`
	);
}

/**
 * The wax seal on the king of an army that has committed this cycle: it shows
 * that a move exists without showing what it is.
 */
export const SEAL_SVG =
	`<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">` +
	`<path d="M64 6 C 80 10 86 4 98 14 C 110 24 104 32 116 46 C 126 60 116 70 120 84 C 122 100 106 104 98 116 C 86 126 76 118 64 122 C 50 126 42 118 30 116 C 16 110 16 96 10 84 C 4 70 14 60 10 46 C 8 30 22 26 30 14 C 42 4 50 10 64 6 Z" fill="#a3262a" stroke="#4a0d10" stroke-width="5"/>` +
	`<circle cx="64" cy="64" r="38" fill="none" stroke="#7a1a1e" stroke-width="5"/>` +
	`<path d="M52 40 L46 88 M76 40 L70 88 M40 56 L90 56 M38 74 L88 74" stroke="#f1d3a8" stroke-width="9" stroke-linecap="round"/>` +
	`</svg>`;

/** The inlay's four triangles, in units of a square, about the block's centre. */
export const INLAY = data.inlay;
export type Quadrant = keyof typeof data.inlay;
