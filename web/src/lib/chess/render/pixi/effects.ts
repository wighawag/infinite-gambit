/**
 * The one-off animations of the wooden board: pieces burning or ascending as
 * they leave, the ETH diamond flying to the king that took a stake, and the
 * diamond rising out of an exit. WHAT to play is `./transitions.ts`'s; this
 * only plays it, from the frame clock, and destroys each sprite when its
 * animation ends.
 *
 * Kept simple on purpose: tinted copies of textures the board already has
 * (the piece, the glow, the badge), no particle system and no filters.
 */
import {Container, Sprite, Texture} from 'pixi.js';
import type {Position} from '../../squares';
import {FOOT} from './piece-art';
import type {PieceTextures} from './pieces';
import type {PieceMode} from './squares';
import {BURN_MS, MOVE_MS, type Departure, type Transition} from './transitions';
import {cssColourToHex} from './view-model';

const ASCEND_MS = 1100;
const BURST_MS = 1400;
/** How long an arriving piece takes to settle into place. */
export const ARRIVE_MS = 380;
const EMBERS = 6;

/** The ETH diamond's own green, for the glow it travels in. */
const ETH_GLOW = 0x5cf0c4;
const GOLD = 0xffd166;

/** What a finish turns into as it goes. */
const SCORCH: Record<string, {hot: number; ember: number}> = {
	boxwood: {hot: 0xff8a2a, ember: 0xffa040},
	sheesham: {hot: 0xff8a2a, ember: 0xffa040},
	ice: {hot: 0xbfe6ff, ember: 0xdff3ff},
	stone: {hot: 0x9a948a, ember: 0xbdb6aa},
};

const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
const easeInOut = (t: number) =>
	t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
const mix = (a: number, b: number, t: number) => {
	const ch = (s: number) =>
		Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t) << s;
	return ch(16) | ch(8) | ch(0);
};

type Effect = {
	/** Frame time it starts at; set on the first tick after it is queued. */
	start?: number;
	delayMs: number;
	durationMs: number;
	sprites: Sprite[];
	/** Drawn as at t = 0 while it waits: a departing piece stays put. */
	hold?: boolean;
	/** Draw at progress t in [0, 1]. */
	draw(t: number, scale: number): void;
};

export class EffectLayer {
	/** Over the pieces: flights and bursts. */
	readonly over = new Container();
	private effects: Effect[] = [];

	constructor(
		/** Where departing pieces are drawn, so they sort among the others. */
		private readonly pieces: Container,
		private readonly textures: PieceTextures,
		private readonly cellSize: number,
	) {}

	/** Queue what a transition plays outside the pieces' own objects. */
	play(transition: Transition, mode: PieceMode): void {
		for (const d of transition.departures) this.depart(d, mode);
		for (const f of transition.flights) this.flight(f.from, f.to, f.delayMs);
		for (const b of transition.exitBursts) this.burst(b.at, b.delayMs);
	}

	private sprite(texture: Texture, parent: Container): Sprite {
		const s = new Sprite(texture);
		s.anchor.set(0.5);
		s.visible = false;
		parent.addChild(s);
		return s;
	}

	private depart(d: Departure, mode: PieceMode): void {
		const c = this.cellSize;
		const {look} = d;
		const turned = mode === 'pieces';
		const texture = turned
			? (this.textures.peek(look.kind, look.finish, look.band) ?? Texture.EMPTY)
			: this.textures.dot;
		const piece = this.sprite(texture, this.pieces);
		if (turned) piece.anchor.set(0.5, FOOT);
		else piece.tint = cssColourToHex(look.tone);
		const scorch = SCORCH[look.finish] ?? SCORCH.boxwood;
		const ascend = d.style === 'ascend';
		const embers = Array.from({length: EMBERS}, () => {
			const e = this.sprite(this.textures.glow, this.pieces);
			e.blendMode = 'add';
			e.tint = ascend ? GOLD : scorch.ember;
			return e;
		});
		const seeds = embers.map(() => ({
			dx: (Math.random() - 0.5) * 0.7,
			rise: 0.5 + Math.random() * 0.7,
			lag: Math.random() * 0.35,
		}));
		const from = {x: look.x, y: look.y};
		const to = d.to ?? from;
		const travel = d.to ? MOVE_MS : 0;
		const total = travel + (ascend ? ASCEND_MS : BURN_MS);
		const baseTint = turned ? 0xffffff : piece.tint;

		this.effects.push({
			delayMs: d.delayMs - (d.to ? MOVE_MS : 0),
			durationMs: total,
			hold: true,
			sprites: [piece, ...embers],
			draw: (t) => {
				const ms = t * total;
				const m = easeInOut(clamp01(ms / Math.max(1, travel)));
				const x = from.x + (to.x - from.x) * m;
				const y = from.y + (to.y - from.y) * m;
				const p = clamp01((ms - travel) / (total - travel));
				const size = turned ? c * 0.94 : c * 0.86;
				piece.visible = true;
				piece.width = piece.height = size;
				piece.zIndex = y * 3 + 1;
				if (ascend) {
					piece.blendMode = p > 0 ? 'add' : 'normal';
					piece.tint = mix(baseTint, GOLD, clamp01(p * 2));
					piece.alpha = look.alpha * (1 - p);
					piece.position.set(
						x * c,
						(y + (turned ? 0.44 : 0)) * c - p * p * c * 0.9,
					);
				} else {
					// scorch, then char, then crumble into the board
					piece.tint =
						p < 0.4
							? mix(baseTint, scorch.hot, p / 0.4)
							: mix(scorch.hot, 0x1a0d06, (p - 0.4) / 0.6);
					piece.alpha = look.alpha * (1 - clamp01((p - 0.35) / 0.65));
					piece.height = size * (1 - 0.35 * p * p);
					piece.position.set(x * c, (y + (turned ? 0.44 : 0)) * c);
				}
				embers.forEach((e, i) => {
					const s = seeds[i];
					const q = clamp01((p - s.lag) / (1 - s.lag));
					e.visible = p > 0 && q > 0 && q < 1;
					e.zIndex = y * 3 + 2;
					e.alpha = Math.sin(q * Math.PI) * 0.9;
					e.width = e.height = c * (0.35 - 0.2 * q);
					e.position.set(
						(x + s.dx * (0.4 + q)) * c,
						(y + 0.2 - s.rise * q) * c,
					);
				});
			},
		});
	}

	private flight(from: Position, to: Position, delayMs: number): void {
		const c = this.cellSize;
		const glow = this.sprite(this.textures.glow, this.over);
		glow.blendMode = 'add';
		glow.tint = ETH_GLOW;
		const trail = Array.from({length: 4}, () => {
			const s = this.sprite(this.textures.badge, this.over);
			s.blendMode = 'add';
			return s;
		});
		const diamond = this.sprite(this.textures.badge, this.over);
		const ring = this.sprite(this.textures.glow, this.over);
		ring.blendMode = 'add';
		ring.tint = ETH_GLOW;
		const dist = Math.hypot(to.x - from.x, to.y - from.y);
		const flyMs = Math.min(1600, 650 + dist * 45);
		const landMs = 450;
		const total = flyMs + landMs;
		const lift = Math.min(4, 0.8 + dist * 0.25);
		const at = (u: number) => {
			const m = easeInOut(clamp01(u));
			return {
				x: from.x + (to.x - from.x) * m,
				y: from.y + (to.y - from.y) * m - Math.sin(Math.PI * m) * lift,
			};
		};
		this.effects.push({
			delayMs,
			durationMs: total,
			sprites: [glow, ...trail, diamond, ring],
			draw: (t, scale) => {
				const ms = t * total;
				const u = ms / flyMs;
				// never smaller than a few screen pixels when zoomed out
				const minSide = (22 / scale) * c;
				const grow = Math.sin(Math.PI * clamp01(u));
				const side = Math.max(minSide, c * (0.5 + 0.5 * grow));
				const p = at(u);
				diamond.visible = glow.visible = u <= 1;
				diamond.width = diamond.height = side;
				diamond.position.set(p.x * c, p.y * c);
				glow.width = glow.height = side * 2.6;
				glow.alpha = 0.7;
				glow.position.set(p.x * c, p.y * c);
				trail.forEach((s, i) => {
					const q = at(u - (i + 1) * 0.045);
					s.visible = u <= 1 && u - (i + 1) * 0.045 > 0;
					s.alpha = 0.35 * (1 - i / trail.length);
					s.width = s.height = side * (1 - (i + 1) * 0.15);
					s.position.set(q.x * c, q.y * c);
				});
				// the king that took it flashes as it lands
				const land = clamp01((ms - flyMs) / landMs);
				ring.visible = land > 0 && land < 1;
				ring.alpha = 1 - land;
				ring.width = ring.height = Math.max(minSide, c) * (0.6 + 1.8 * land);
				ring.position.set(to.x * c, to.y * c);
			},
		});
	}

	private burst(at: Position, delayMs: number): void {
		const c = this.cellSize;
		const glow = this.sprite(this.textures.glow, this.over);
		glow.blendMode = 'add';
		glow.tint = GOLD;
		const diamond = this.sprite(this.textures.badge, this.over);
		this.effects.push({
			delayMs,
			durationMs: BURST_MS,
			sprites: [glow, diamond],
			draw: (t, scale) => {
				const minSide = (26 / scale) * c;
				const side = Math.max(minSide, c * (0.6 + 0.8 * Math.sqrt(t)));
				const y = at.y - t * 2.5;
				diamond.visible = glow.visible = true;
				diamond.width = diamond.height = side;
				diamond.alpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
				diamond.position.set(at.x * c, y * c);
				glow.width = glow.height = side * 3;
				glow.alpha = 0.8 * (1 - t);
				glow.position.set(at.x * c, (at.y - t * 1.2) * c);
			},
		});
	}

	tick(nowMs: number, scale: number): void {
		this.effects = this.effects.filter((e) => {
			e.start ??= nowMs + e.delayMs;
			if (nowMs < e.start) {
				if (e.hold) e.draw(0, scale);
				return true;
			}
			const t = clamp01((nowMs - e.start) / e.durationMs);
			e.draw(t, scale);
			if (t < 1) return true;
			for (const s of e.sprites) s.destroy();
			return false;
		});
	}

	clear(): void {
		for (const e of this.effects) for (const s of e.sprites) s.destroy();
		this.effects = [];
	}
}
