/**
 * The infinite wooden board: a pool of square sprites reused as the camera
 * moves, the joins between squares, and a flat fallback for low zoom.
 *
 * Coordinates follow the game: a square is centred on its integer coordinate
 * (it spans x - 0.5 to x + 0.5), and (x + y) even is a light square. Pixi
 * content is in PIXELS at `cellSize` per square, as in the game's pixi host
 * (`web/src/lib/game/render/pixi/world.ts`), so square (x, y) is centred at
 * (x * cellSize, y * cellSize).
 */
import {CanvasSource, Container, Graphics, Rectangle, Sprite, Texture, TilingSprite} from 'pixi.js';
import {MAPLE, ROSEWOOD, woodCanvas} from './wood';

/** Windows cut from each wood texture: enough that neighbours rarely repeat. */
const FRAMES = 24;

/**
 * Below this many screen pixels per square the grain is invisible anyway, and
 * the square pool would be tens of thousands of sprites: draw flat squares
 * with one tiling sprite instead.
 */
export const FLAT_BELOW = 18;

export const MAPLE_FLAT = 0xe2cba0;
export const ROSEWOOD_FLAT = 0x7a4a2c;

export type VisibleCells = {left: number; top: number; right: number; bottom: number};

export function cellHash(x: number, y: number, salt: number): number {
	let h = Math.imul(x | 0, 73856093) ^ Math.imul(y | 0, 19349663) ^ Math.imul(salt, 83492791);
	h = Math.imul(h ^ (h >>> 15), 2246822519);
	return (h ^ (h >>> 13)) >>> 0;
}

export function isLight(x: number, y: number): boolean {
	return (((x + y) % 2) + 2) % 2 === 0;
}

function framesOf(canvas: HTMLCanvasElement, seed: number): Texture[] {
	const source = new CanvasSource({resource: canvas, autoGenerateMipmaps: true, scaleMode: 'linear'});
	const size = canvas.width;
	const window = size / 4;
	const frames: Texture[] = [];
	for (let i = 0; i < FRAMES; i++) {
		const x = (cellHash(i, 1, seed) % (size - window)) | 0;
		const y = (cellHash(i, 2, seed) % (size - window)) | 0;
		frames.push(new Texture({source, frame: new Rectangle(x, y, window, window)}));
	}
	return frames;
}

/** A 2 x 2 checker, one texture pixel per square, for the flat fallback. */
function checkerTexture(): Texture {
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = 2;
	const c = canvas.getContext('2d')!;
	// lower contrast than the wood: at a few pixels per square a full-contrast
	// checker shimmers, and what matters out here is the armies and the exits
	c.fillStyle = '#a88660';
	c.fillRect(0, 0, 2, 2);
	c.fillStyle = '#8c6442';
	c.fillRect(1, 0, 1, 1);
	c.fillRect(0, 1, 1, 1);
	return new Texture({source: new CanvasSource({resource: canvas, scaleMode: 'nearest'})});
}

export class WoodBoard {
	readonly container = new Container();
	private readonly squares = new Container();
	private readonly joins = new Graphics();
	private readonly flat: TilingSprite;
	private readonly pool: Sprite[] = [];
	private readonly maple: Texture[];
	private readonly rosewood: Texture[];

	constructor(private readonly cellSize: number) {
		this.maple = framesOf(woodCanvas(MAPLE, 512, 7), 1);
		this.rosewood = framesOf(woodCanvas(ROSEWOOD, 512, 11), 2);
		this.flat = new TilingSprite({texture: checkerTexture(), width: 1, height: 1});
		this.flat.tileScale.set(cellSize);
		this.container.addChild(this.flat, this.squares, this.joins);
	}

	/** A window of wood for square (x, y), or of the given wood when `light` is set. */
	frameFor(x: number, y: number, light = isLight(x, y)): Texture {
		const frames = light ? this.maple : this.rosewood;
		return frames[cellHash(x, y, 3) % frames.length];
	}

	/**
	 * Lay out the squares the camera can see. Called on every view change; it
	 * allocates only when the visible area grows.
	 */
	update(view: VisibleCells, scale: number): void {
		const {cellSize} = this;
		const flat = scale < FLAT_BELOW;
		this.flat.visible = flat;
		this.squares.visible = !flat;
		this.joins.visible = !flat;
		if (flat) {
			// The checker's pixel (0,0) is a light square; square (x, y) is centred
			// on x * cellSize, so the tile starts half a square up and left of an
			// even square.
			const x0 = view.left - (((view.left + view.top) % 2) + 2) % 2;
			this.flat.position.set((x0 - 0.5) * cellSize, (view.top - 0.5) * cellSize);
			this.flat.width = (view.right - x0 + 2) * cellSize;
			this.flat.height = (view.bottom - view.top + 2) * cellSize;
			return;
		}

		let used = 0;
		for (let y = view.top; y <= view.bottom; y++) {
			for (let x = view.left; x <= view.right; x++) {
				let sprite = this.pool[used];
				if (!sprite) {
					sprite = new Sprite();
					sprite.anchor.set(0.5);
					this.pool.push(sprite);
					this.squares.addChild(sprite);
				}
				used++;
				sprite.texture = this.frameFor(x, y);
				sprite.visible = true;
				// a mirrored cut on some squares, and a slightly different tone per
				// square, as between two pieces of veneer
				sprite.width = cellSize;
				sprite.height = cellSize;
				if (cellHash(x, y, 5) & 1) sprite.scale.x *= -1;
				sprite.position.set(x * cellSize, y * cellSize);
				const shade = 236 + (cellHash(x, y, 9) % 20);
				sprite.tint = (shade << 16) | (shade << 8) | shade;
			}
		}
		for (let i = used; i < this.pool.length; i++) this.pool[i].visible = false;

		// the joins: a thin dark line where the veneer meets
		const j = this.joins.clear();
		const x0 = (view.left - 0.5) * cellSize;
		const x1 = (view.right + 0.5) * cellSize;
		const y0 = (view.top - 0.5) * cellSize;
		const y1 = (view.bottom + 0.5) * cellSize;
		for (let x = view.left; x <= view.right + 1; x++) j.moveTo((x - 0.5) * cellSize, y0).lineTo((x - 0.5) * cellSize, y1);
		for (let y = view.top; y <= view.bottom + 1; y++) j.moveTo(x0, (y - 0.5) * cellSize).lineTo(x1, (y - 0.5) * cellSize);
		j.stroke({color: 0x1a0c06, alpha: 0.35, width: Math.max(1, cellSize / 64)});
	}
}
