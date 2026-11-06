/**
 * The infinite wooden board: a pool of square sprites reused as the camera
 * moves, the joins between squares, and a flat fallback for low zoom. Ported
 * from `spikes/pixi-wood-board/src/board.ts`.
 *
 * Each square samples one of FRAMES windows of one shared texture per wood,
 * rather than having its own texture or the board being one tiled texture: all
 * squares batch into a few draw calls (two texture sources), yet neighbours
 * rarely look cut from the same piece, and nothing repeats visibly.
 *
 * Every texture made here says its filtering: the template's pixi `assets.ts`
 * makes `nearest` the global default (pixel art), and this art is smooth.
 */
import {
	CanvasSource,
	Container,
	Graphics,
	Rectangle,
	Sprite,
	Texture,
	TilingSprite,
} from 'pixi.js';
import {MAPLE, ROSEWOOD, woodCanvas} from './wood';
import {
	cellHash,
	flatChecker,
	isFlat,
	isLight,
	type VisibleCells,
} from './squares';

/** Windows cut from each wood texture: enough that neighbours rarely repeat. */
const FRAMES = 24;

/**
 * The whole board, dimmed: the pieces are what a player reads, so they should
 * be the brightest thing on screen, and wooden pieces on full-brightness wood
 * did not stand out. A tint on the board's container only: the exit inlays
 * (cut from the same wood) stay bright, since they are meant to be found.
 */
const BOARD_DIM = 0xa8998a;

function framesOf(canvas: HTMLCanvasElement, seed: number): Texture[] {
	const source = new CanvasSource({
		resource: canvas,
		autoGenerateMipmaps: true,
		scaleMode: 'linear',
	});
	const size = canvas.width;
	const window = size / 4;
	const frames: Texture[] = [];
	for (let i = 0; i < FRAMES; i++) {
		const x = (cellHash(i, 1, seed) % (size - window)) | 0;
		const y = (cellHash(i, 2, seed) % (size - window)) | 0;
		frames.push(
			new Texture({source, frame: new Rectangle(x, y, window, window)}),
		);
	}
	return frames;
}

/**
 * A 2 x 2 checker, one texture pixel per square, for the flat fallback. Lower
 * contrast than the wood: at a few pixels per square a full-contrast checker
 * shimmers. `nearest` on purpose: each texel IS a square.
 */
function checkerTexture(): Texture {
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = 2;
	const c = canvas.getContext('2d')!;
	c.fillStyle = '#a88660';
	c.fillRect(0, 0, 2, 2);
	c.fillStyle = '#8c6442';
	c.fillRect(1, 0, 1, 1);
	c.fillRect(0, 1, 1, 1);
	return new Texture({
		source: new CanvasSource({resource: canvas, scaleMode: 'nearest'}),
	});
}

export class WoodBoard {
	readonly container = new Container();
	private readonly squares = new Container();
	private readonly joins = new Graphics();
	private readonly flat: TilingSprite;
	private readonly pool: Sprite[] = [];
	private readonly maple: Texture[];
	private readonly rosewood: Texture[];
	/** The two woods, for art that cuts its own veneer (the exit inlay). */
	readonly mapleCanvas: HTMLCanvasElement;
	readonly rosewoodCanvas: HTMLCanvasElement;

	constructor(private readonly cellSize: number) {
		this.mapleCanvas = woodCanvas(MAPLE, 512, 7);
		this.rosewoodCanvas = woodCanvas(ROSEWOOD, 512, 11);
		this.maple = framesOf(this.mapleCanvas, 1);
		this.rosewood = framesOf(this.rosewoodCanvas, 2);
		this.flat = new TilingSprite({
			texture: checkerTexture(),
			width: 1,
			height: 1,
		});
		this.flat.tileScale.set(cellSize);
		this.container.addChild(this.flat, this.squares, this.joins);
		this.container.tint = BOARD_DIM;
	}

	/** A window of wood for square (x, y), or of the given wood when `light` is set. */
	frameFor(x: number, y: number, light = isLight(x, y)): Texture {
		const frames = light ? this.maple : this.rosewood;
		return frames[cellHash(x, y, 3) % frames.length];
	}

	/**
	 * Lay out the squares the camera can see, `scale` being screen pixels per
	 * square. Call it on every view change; it allocates only when the visible
	 * area grows.
	 */
	update(view: VisibleCells, scale: number): void {
		const {cellSize} = this;
		const flat = isFlat(scale);
		this.flat.visible = flat;
		this.squares.visible = !flat;
		this.joins.visible = !flat;
		if (flat) {
			const tile = flatChecker(view);
			this.flat.position.set(tile.x * cellSize, tile.y * cellSize);
			this.flat.width = tile.width * cellSize;
			this.flat.height = tile.height * cellSize;
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
				// a mirrored cut on some squares and a slightly different tone per
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
		for (let x = view.left; x <= view.right + 1; x++) {
			j.moveTo((x - 0.5) * cellSize, y0).lineTo((x - 0.5) * cellSize, y1);
		}
		for (let y = view.top; y <= view.bottom + 1; y++) {
			j.moveTo(x0, (y - 0.5) * cellSize).lineTo(x1, (y - 0.5) * cellSize);
		}
		j.stroke({color: 0x1a0c06, alpha: 0.35, width: Math.max(1, cellSize / 64)});
	}
}
