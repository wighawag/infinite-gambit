/**
 * Piece textures: each piece rasterised once per (kind, finish, band) from
 * `piece-art.ts`'s SVG into a mipmapped texture, so a piece costs one sprite at
 * any zoom. Ported from the texture half of `spikes/pixi-wood-board/src/pieces.ts`;
 * the spike's `PieceLayer` is not ported, since in the game pieces are entities
 * of the stateful renderer's reconciler.
 *
 * RASTERISING IS ASYNC (`image.decode()`) while the reconciler's `add` is
 * synchronous. `get` returns a promise and caches it; `peek` returns the
 * texture if it is already decoded, so a renderer can create a sprite with a
 * placeholder and set the texture when `get` resolves, or `preload` an army's
 * whole set the first time its colour appears.
 */
import {CanvasSource, Texture} from 'pixi.js';
import {
	KINDS,
	RASTER,
	SEAL_SVG,
	pieceKey,
	svgFor,
	type Finish,
	type Kind,
} from './piece-art';

async function rasterise(svg: string, size: number): Promise<Texture> {
	const url = URL.createObjectURL(new Blob([svg], {type: 'image/svg+xml'}));
	try {
		const image = new Image();
		image.src = url;
		await image.decode();
		const canvas = document.createElement('canvas');
		canvas.width = canvas.height = size;
		canvas.getContext('2d')!.drawImage(image, 0, 0, size, size);
		return new Texture({
			source: new CanvasSource({
				resource: canvas,
				autoGenerateMipmaps: true,
				scaleMode: 'linear',
			}),
		});
	} finally {
		URL.revokeObjectURL(url);
	}
}

/** A soft white radial glow, tinted per army, that sits under a piece. */
function glowTexture(): Texture {
	const size = 128;
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = size;
	const c = canvas.getContext('2d')!;
	const g = c.createRadialGradient(
		size / 2,
		size / 2,
		0,
		size / 2,
		size / 2,
		size / 2,
	);
	g.addColorStop(0, 'rgba(255,255,255,0.95)');
	g.addColorStop(1, 'rgba(255,255,255,0)');
	c.fillStyle = g;
	c.fillRect(0, 0, size, size);
	return new Texture({
		source: new CanvasSource({resource: canvas, scaleMode: 'linear'}),
	});
}

/** A white disc with a dark rim, tinted per army: a piece at low zoom. */
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
	return new Texture({
		source: new CanvasSource({
			resource: canvas,
			autoGenerateMipmaps: true,
			scaleMode: 'linear',
		}),
	});
}

export class PieceTextures {
	readonly dot = dotTexture();
	readonly glow = glowTexture();
	readonly seal: Promise<Texture> = rasterise(SEAL_SVG, 128);
	private readonly pending = new Map<string, Promise<Texture>>();
	private readonly ready = new Map<string, Texture>();

	get(kind: Kind, finish: Finish, band?: string): Promise<Texture> {
		const key = pieceKey(kind, finish, band);
		let texture = this.pending.get(key);
		if (!texture) {
			texture = rasterise(svgFor(kind, finish, band), RASTER).then((t) => {
				this.ready.set(key, t);
				return t;
			});
			this.pending.set(key, texture);
		}
		return texture;
	}

	/** The texture if it is already decoded, else undefined. */
	peek(kind: Kind, finish: Finish, band?: string): Texture | undefined {
		return this.ready.get(pieceKey(kind, finish, band));
	}

	/** Start rasterising every kind in one finish and band. */
	preload(finish: Finish, band?: string): Promise<Texture[]> {
		return Promise.all(KINDS.map((kind) => this.get(kind, finish, band)));
	}
}
