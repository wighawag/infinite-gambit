/**
 * Pieces: the turned set from `assets/brand/game/pieces.py`, rasterised once
 * per (kind, wood, army colour) and drawn as sprites.
 *
 * Each piece is a list of parts with a role. `wood` parts get the wood's
 * side-lit gradient (what makes a flat silhouette read as turned), `band` parts
 * (the collar and the felt pad) get the army colour, and `prism` parts are the
 * king's crystal. The SVG is rasterised by the browser into a canvas, which
 * becomes a mipmapped texture, so a piece costs one sprite at any zoom.
 *
 * Under each piece a soft glow of the army colour sits on the square: at low
 * zoom, where the band and the felt are a few pixels tall, it is what keeps
 * armies apart.
 */
import {CanvasSource, Container, Sprite, Texture} from 'pixi.js';
import data from './pieces.json';

export type Kind = keyof typeof data.parts;

/**
 * The two woods of the set, plus two states that are not woods: STONE for a
 * rock (a piece no army can play again, ADR 0011) and ICE for a frozen army
 * (a missed reveal, rule 36). Both keep the silhouette, so you still see what
 * the piece was.
 */
const FINISHES = {
	...data.woods,
	stone: {light: '#d4d0c8', dark: '#7c7870', edge: '#34322e'},
	ice: {light: '#eef6fb', dark: '#9fb8cb', edge: '#3a5466'},
};
export type Wood = keyof typeof FINISHES;

/** Texture pixels per piece. 256 keeps a piece sharp up to ~4x a 64 px cell. */
const RASTER = 256;

function svgFor(kind: Kind, wood: Wood, band: string): string {
	const {light, dark, edge} = FINISHES[wood];
	const paths = data.parts[kind]
		.map(([role, d]) => {
			if (role === 'prism') {
				return `<path d="${d}" transform="${data.finialTransform}" fill="url(#prism)" stroke="${edge}" stroke-width="7" stroke-linejoin="round" paint-order="stroke"/>`;
			}
			// a rock has no army: its band is stone like the rest
			const fill = role === 'band' && wood !== 'stone' ? band : 'url(#wood)';
			return `<path d="${d}" fill="${fill}" fill-rule="evenodd" stroke="${edge}" stroke-width="7" stroke-linejoin="round" paint-order="stroke"/>`;
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

async function rasterise(svg: string): Promise<Texture> {
	const url = URL.createObjectURL(new Blob([svg], {type: 'image/svg+xml'}));
	try {
		const image = new Image();
		image.src = url;
		await image.decode();
		const canvas = document.createElement('canvas');
		canvas.width = RASTER;
		canvas.height = RASTER;
		canvas.getContext('2d')!.drawImage(image, 0, 0, RASTER, RASTER);
		return new Texture({source: new CanvasSource({resource: canvas, autoGenerateMipmaps: true, scaleMode: 'linear'})});
	} finally {
		URL.revokeObjectURL(url);
	}
}

function glowTexture(): Texture {
	const size = 128;
	const canvas = document.createElement('canvas');
	canvas.width = size;
	canvas.height = size;
	const context = canvas.getContext('2d')!;
	const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
	gradient.addColorStop(0, 'rgba(255,255,255,0.95)');
	gradient.addColorStop(1, 'rgba(255,255,255,0)');
	context.fillStyle = gradient;
	context.fillRect(0, 0, size, size);
	return new Texture({source: new CanvasSource({resource: canvas, scaleMode: 'linear'})});
}

function dotTexture(): Texture {
	const size = 64;
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = size;
	const c = canvas.getContext('2d')!;
	c.fillStyle = '#ffffff';
	c.beginPath();
	c.arc(size / 2, size / 2, size / 2 - 3, 0, Math.PI * 2);
	c.fill();
	c.lineWidth = 4;
	c.strokeStyle = 'rgba(26,12,6,0.9)';
	c.stroke();
	return new Texture({source: new CanvasSource({resource: canvas, autoGenerateMipmaps: true, scaleMode: 'linear'})});
}

/**
 * The wax seal on the king of an army that has COMMITTED this cycle: it shows
 * that a move exists without showing what it is, which is all commit-reveal
 * allows anyone to know.
 */
async function sealTexture(): Promise<Texture> {
	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">` +
		`<path d="M64 6 C 80 10 86 4 98 14 C 110 24 104 32 116 46 C 126 60 116 70 120 84 C 122 100 106 104 98 116 C 86 126 76 118 64 122 C 50 126 42 118 30 116 C 16 110 16 96 10 84 C 4 70 14 60 10 46 C 8 30 22 26 30 14 C 42 4 50 10 64 6 Z" fill="#a3262a" stroke="#4a0d10" stroke-width="5"/>` +
		`<circle cx="64" cy="64" r="38" fill="none" stroke="#7a1a1e" stroke-width="5"/>` +
		`<path d="M52 40 L46 88 M76 40 L70 88 M40 56 L90 56 M38 74 L88 74" stroke="#f1d3a8" stroke-width="9" stroke-linecap="round"/>` +
		`</svg>`;
	const url = URL.createObjectURL(new Blob([svg], {type: 'image/svg+xml'}));
	try {
		const image = new Image();
		image.src = url;
		await image.decode();
		const canvas = document.createElement('canvas');
		canvas.width = canvas.height = 128;
		canvas.getContext('2d')!.drawImage(image, 0, 0);
		return new Texture({source: new CanvasSource({resource: canvas, autoGenerateMipmaps: true, scaleMode: 'linear'})});
	} finally {
		URL.revokeObjectURL(url);
	}
}

export class PieceTextures {
	readonly dot = dotTexture();
	readonly seal = sealTexture();
	private readonly cache = new Map<string, Promise<Texture>>();
	readonly glow = glowTexture();

	get(kind: Kind, wood: Wood, band: string): Promise<Texture> {
		const key = `${kind}|${wood}|${band}`;
		let texture = this.cache.get(key);
		if (!texture) {
			texture = rasterise(svgFor(kind, wood, band));
			this.cache.set(key, texture);
		}
		return texture;
	}
}

export type PieceView = {
	kind: Kind;
	x: number;
	y: number;
	army: string;
	mine: boolean;
	/** A rock (no army can play it again) or a piece of a frozen army. */
	state?: 'rock' | 'frozen';
	/** On a king: its army has committed this cycle. */
	committed?: boolean;
};

const ICE = '#b9d7ea';
const STONE = '#8f8b84';

/** Screen pixels per square below which pieces become dots. */
export const DOTS_BELOW = 18;

type Drawn = {glow: Sprite; sprite: Sprite; dot: Sprite; seal?: Sprite};

/**
 * The pieces in view. A spike-sized version of what the game's renderer would
 * reconcile from its view state: here the whole list is laid out once.
 */
export class PieceLayer {
	readonly container = new Container();
	private drawn: Drawn[] = [];

	constructor(
		private readonly cellSize: number,
		private readonly textures: PieceTextures,
	) {
		this.container.sortableChildren = true;
	}

	async set(pieces: PieceView[]): Promise<void> {
		this.container.removeChildren();
		this.drawn = [];
		const {cellSize} = this;
		const seal = await this.textures.seal;
		await Promise.all(
			pieces.map(async (piece) => {
				const wood: Wood = piece.state === 'rock' ? 'stone' : piece.state === 'frozen' ? 'ice' : piece.mine ? 'boxwood' : 'sheesham';
				const texture = await this.textures.get(piece.kind, wood, piece.army);
				const tone = piece.state === 'rock' ? STONE : piece.state === 'frozen' ? ICE : piece.army;

				const glow = new Sprite(this.textures.glow);
				glow.anchor.set(0.5);
				glow.tint = tone;
				glow.alpha = piece.state === 'rock' ? 0 : piece.state === 'frozen' ? 0.6 : 1;
				glow.width = cellSize * 0.95;
				glow.height = cellSize * 0.42;
				glow.position.set(piece.x * cellSize, (piece.y + 0.34) * cellSize);
				glow.zIndex = piece.y * 3;

				const sprite = new Sprite(texture);
				// the piece stands on the lower part of its square and may rise
				// into the one above, as a real piece seen from the side
				sprite.anchor.set(0.5, 248 / 256);
				sprite.width = cellSize * 0.94;
				sprite.height = cellSize * 0.94;
				sprite.position.set(piece.x * cellSize, (piece.y + 0.44) * cellSize);
				sprite.zIndex = piece.y * 3 + 1;

				// low zoom: a dot in the army's colour, like the minimap
				const dot = new Sprite(this.textures.dot);
				dot.anchor.set(0.5);
				dot.tint = tone;
				dot.width = dot.height = cellSize * 0.78;
				dot.position.set(piece.x * cellSize, piece.y * cellSize);
				dot.zIndex = piece.y * 3;
				dot.visible = false;

				const drawn: Drawn = {glow, sprite, dot};
				this.container.addChild(glow, sprite, dot);
				if (piece.kind === 'king' && piece.committed) {
					const s = new Sprite(seal);
					s.anchor.set(0.5);
					s.width = s.height = cellSize * 0.36;
					s.position.set((piece.x + 0.3) * cellSize, (piece.y - 0.3) * cellSize);
					s.rotation = -0.25;
					s.zIndex = piece.y * 3 + 2;
					this.container.addChild(s);
					drawn.seal = s;
				}
				this.drawn.push(drawn);
			}),
		);
	}

	/** Switch between drawn pieces and dots with the zoom. */
	setZoom(scale: number): void {
		const dots = scale < DOTS_BELOW;
		for (const d of this.drawn) {
			d.sprite.visible = !dots;
			d.glow.visible = !dots;
			d.dot.visible = dots;
			if (d.seal) d.seal.visible = !dots;
		}
	}
}
