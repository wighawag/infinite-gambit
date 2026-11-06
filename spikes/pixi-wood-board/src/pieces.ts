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
export type Wood = keyof typeof data.woods;

/** Texture pixels per piece. 256 keeps a piece sharp up to ~4x a 64 px cell. */
const RASTER = 256;

function svgFor(kind: Kind, wood: Wood, band: string): string {
	const {light, dark, edge} = data.woods[wood];
	const paths = data.parts[kind]
		.map(([role, d]) => {
			if (role === 'prism') {
				return `<path d="${d}" transform="${data.finialTransform}" fill="url(#prism)" stroke="${edge}" stroke-width="7" stroke-linejoin="round" paint-order="stroke"/>`;
			}
			const fill = role === 'band' ? band : 'url(#wood)';
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

export class PieceTextures {
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

export type PieceView = {kind: Kind; x: number; y: number; army: string; mine: boolean};

/**
 * The pieces in view. A spike-sized version of what the game's renderer would
 * reconcile from its view state: here the whole list is laid out once.
 */
export class PieceLayer {
	readonly container = new Container();

	constructor(
		private readonly cellSize: number,
		private readonly textures: PieceTextures,
	) {
		this.container.sortableChildren = true;
	}

	async set(pieces: PieceView[]): Promise<void> {
		this.container.removeChildren();
		const {cellSize} = this;
		await Promise.all(
			pieces.map(async (piece) => {
				const texture = await this.textures.get(piece.kind, piece.mine ? 'boxwood' : 'sheesham', piece.army);
				const glow = new Sprite(this.textures.glow);
				glow.anchor.set(0.5);
				glow.tint = piece.army;
				glow.width = cellSize * 0.95;
				glow.height = cellSize * 0.42;
				glow.position.set(piece.x * cellSize, (piece.y + 0.34) * cellSize);
				glow.zIndex = piece.y * 2;
				const sprite = new Sprite(texture);
				// the piece stands on the lower part of its square and may rise
				// into the one above, as a real piece seen from the side
				sprite.anchor.set(0.5, 248 / 256);
				sprite.width = cellSize * 0.94;
				sprite.height = cellSize * 0.94;
				sprite.position.set(piece.x * cellSize, (piece.y + 0.44) * cellSize);
				sprite.zIndex = piece.y * 2 + 1;
				this.container.addChild(glow, sprite);
			}),
		);
	}
}
