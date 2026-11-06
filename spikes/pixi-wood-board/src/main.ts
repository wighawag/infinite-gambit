/**
 * The spike's harness: a pixi application, a camera, a hand-made scene and
 * click-to-plan. Everything worth keeping is in board.ts, wood.ts, exits.ts,
 * overlays.ts and pieces.ts; this file stands in for what the game's host and
 * view state already do for real.
 *
 * THE MOVES HERE ARE FAKE. The destinations and attacked squares come from a
 * naive move generator written for the demo, because the spike has no chain.
 * In the game they come from the contract (ADR 0007), and no rule may live in
 * the client.
 *
 * URL parameters, for screenshots: ?x=&y=&scale= set the camera, ?exit=1|4 the
 * exit size, ?select=x,y preselects a square.
 */
import {Application, CanvasSource, Container, Sprite, Texture} from 'pixi.js';
import {WoodBoard} from './board';
import {ExitLayer, isExitSquare, type ExitSize} from './exits';
import {Overlays, type OverlayState, type Square} from './overlays';
import {PieceLayer, PieceTextures, type Kind, type PieceView} from './pieces';
import {applyTransform, attachControls, visibleCells, type ViewTransform} from './camera';

const CELL = 64;
const SPACING = 16;
const YOU = '#ffd166';
const BLUE = '#6ea8ff';
const PINK = '#ef6f8f';

// ---- the scene ---------------------------------------------------------------

/** An army as the contract lays it out (ChessRules, "THE ARMY'S LAYOUT"). */
function army(sx: number, sy: number, colour: string, mine: boolean, extra: Partial<PieceView> = {}): PieceView[] {
	const rows: Array<[number, string]> = [
		[sy - 1, '.PPPP.'],
		[sy, 'PKBNRP'],
		[sy + 1, 'PRNBQP'],
		[sy + 2, '.PPPP.'],
	];
	const kinds: Record<string, Kind> = {P: 'pawn', K: 'king', B: 'bishop', N: 'knight', R: 'rook', Q: 'queen'};
	const out: PieceView[] = [];
	for (const [y, row] of rows) {
		[...row].forEach((ch, i) => {
			if (ch !== '.') out.push({kind: kinds[ch], x: sx - 3 + i, y, army: colour, mine, ...extra});
		});
	}
	return out;
}

function move(list: PieceView[], from: Square, to: Square) {
	const p = list.find((q) => q.x === from.x && q.y === from.y);
	if (p) Object.assign(p, to);
}

function scene(size: ExitSize): PieceView[] {
	const you = army(0, 0, YOU, true);
	// your king has marched out towards the exit, with a knight beside it
	move(you, {x: -2, y: 0}, size === 4 ? {x: 6, y: 6} : {x: 7, y: 7});
	move(you, {x: 0, y: 0}, {x: 4, y: 5});
	move(you, {x: 0, y: -1}, {x: 0, y: -3});

	const blue = army(SPACING, 0, BLUE, false);
	blue.find((p) => p.kind === 'king')!.committed = true;
	// a blue bishop eyes the exit (the layout puts it at (sx - 1, sy))
	move(blue, {x: 15, y: 0}, size === 4 ? {x: 10, y: 4} : {x: 11, y: 5});
	move(blue, {x: 14, y: -1}, {x: 14, y: -3});

	const pink = army(0, SPACING, PINK, false, {state: 'frozen'});
	const rocks: PieceView[] = [
		{kind: 'pawn', x: 12, y: 11, army: '#888', mine: false, state: 'rock'},
		{kind: 'rook', x: 13, y: 12, army: '#888', mine: false, state: 'rock'},
		{kind: 'knight', x: 11, y: 13, army: '#888', mine: false, state: 'rock'},
	];
	const far = [
		...army(2 * SPACING, -SPACING, '#7ed6a5', false),
		...army(-2 * SPACING, SPACING, '#c792ea', false),
		...army(3 * SPACING, 2 * SPACING, '#f6b26b', false),
		...army(-SPACING, -2 * SPACING, '#4dd0e1', false),
	];
	return [...you, ...blue, ...pink, ...rocks, ...far];
}

// ---- the fake move generator (demo only, see the header) ---------------------

const key = (s: Square) => `${s.x},${s.y}`;

function pseudoMoves(p: PieceView, at: Map<string, PieceView>): Array<Square & {capture: boolean}> {
	const out: Array<Square & {capture: boolean}> = [];
	const friend = (q?: PieceView) => q && q.army === p.army;
	const add = (x: number, y: number) => {
		const q = at.get(key({x, y}));
		if (friend(q) || q?.state === 'rock') return false;
		out.push({x, y, capture: !!q});
		return !q;
	};
	const slide = (dirs: number[][]) => {
		for (const [dx, dy] of dirs) for (let i = 1; i <= 7 && add(p.x + dx * i, p.y + dy * i); i++);
	};
	const straight = [[1, 0], [-1, 0], [0, 1], [0, -1]];
	const diagonal = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
	switch (p.kind) {
		case 'rook': slide(straight); break;
		case 'bishop': slide(diagonal); break;
		case 'queen': slide([...straight, ...diagonal]); break;
		case 'king': for (const [dx, dy] of [...straight, ...diagonal]) add(p.x + dx, p.y + dy); break;
		case 'knight':
			for (const [dx, dy] of [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]]) add(p.x + dx, p.y + dy);
			break;
		case 'pawn': {
			const dy = p.mine ? -1 : 0;
			const dx = p.mine ? 0 : 1;
			if (!at.has(key({x: p.x + dx, y: p.y + dy}))) out.push({x: p.x + dx, y: p.y + dy, capture: false});
			break;
		}
	}
	return out;
}

// ---- the app --------------------------------------------------------------------

function vignette(): Texture {
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = 256;
	const c = canvas.getContext('2d')!;
	const g = c.createRadialGradient(128, 128, 60, 128, 128, 182);
	g.addColorStop(0, 'rgba(22,17,13,0)');
	g.addColorStop(1, 'rgba(22,17,13,0.75)');
	c.fillStyle = g;
	c.fillRect(0, 0, 256, 256);
	return new Texture({source: new CanvasSource({resource: canvas, scaleMode: 'linear'})});
}

async function main() {
	const canvas = document.getElementById('board') as HTMLCanvasElement;
	const hud = document.getElementById('hud')!;
	const app = new Application();
	await app.init({
		canvas,
		resizeTo: window,
		background: '#16110d',
		antialias: true,
		resolution: window.devicePixelRatio || 1,
		autoDensity: true,
	});

	const params = new URLSearchParams(location.search);
	const world = new Container();
	const board = new WoodBoard(CELL);
	const exits = new ExitLayer(app.renderer, board, CELL, SPACING);
	exits.size = params.get('exit') === '1' ? 1 : 4;
	const overlays = new Overlays(CELL);
	const pieces = new PieceLayer(CELL, new PieceTextures());
	world.addChild(board.container, exits.under, exits.container, overlays.under, pieces.container, overlays.over);
	const shade = new Sprite(vignette());
	app.stage.addChild(world, shade);

	const t: ViewTransform = {
		centerX: Number(params.get('x') ?? 6),
		centerY: Number(params.get('y') ?? 6),
		scale: Number(params.get('scale') ?? 46),
	};

	let list: PieceView[] = [];
	let at = new Map<string, PieceView>();
	const ui: {selected?: Square; planned?: {from: Square; to: Square}} = {};

	function overlayState(): OverlayState {
		const enemyReach = new Set<string>();
		for (const p of list) {
			if (p.mine || p.state) continue;
			for (const m of pseudoMoves(p, at)) enemyReach.add(key(m));
		}
		const selectedPiece = ui.selected && at.get(key(ui.selected));
		const destinations = selectedPiece ? pseudoMoves(selectedPiece, at) : [];
		// Show attacked squares where they matter: the selection's destinations,
		// around your king, and the planned target.
		const watch = new Map<string, Square>();
		for (const d of destinations) watch.set(key(d), d);
		const king = list.find((p) => p.mine && p.kind === 'king');
		if (king) for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) watch.set(key({x: king.x + dx, y: king.y + dy}), {x: king.x + dx, y: king.y + dy});
		if (ui.planned) watch.set(key(ui.planned.to), ui.planned.to);
		return {
			spawns: [{x: SPACING, y: SPACING}],
			selected: ui.selected,
			destinations,
			attacked: [...watch.entries()].filter(([k]) => enemyReach.has(k)).map(([, s]) => s),
			outcomes: [
				{x: 3, y: 9, kind: 'collision'},
				{x: 12, y: 6, kind: 'capture'},
			],
			planned: ui.planned,
		};
	}

	async function load() {
		list = scene(exits.size);
		at = new Map(list.map((p) => [key(p), p]));
		const king = list.find((p) => p.mine && p.kind === 'king')!;
		const target = exits.size === 4 ? {x: 7, y: 7} : {x: 8, y: 8};
		ui.planned = {from: {x: king.x, y: king.y}, to: target};
		ui.selected = undefined;
		const pre = params.get('select');
		if (pre) {
			const [x, y] = pre.split(',').map(Number);
			ui.selected = {x, y};
		}
		await pieces.set(list);
		overlays.set(overlayState());
		pieces.setZoom(t.scale);
		hud.innerHTML =
			`exits: <b>${exits.size} square${exits.size === 4 ? 's' : ''}</b> (press <b>E</b> to switch) · ` +
			`click your piece, then a square, to plan · drag to pan, wheel to zoom · <b>0</b> home`;
	}

	const redraw = () => {
		const screen = {width: app.screen.width, height: app.screen.height};
		applyTransform(world, t, screen, CELL);
		board.update(visibleCells(t, screen), t.scale);
		pieces.setZoom(t.scale);
		shade.width = screen.width;
		shade.height = screen.height;
	};

	attachControls(canvas, t, redraw);
	app.renderer.on('resize', redraw);
	app.ticker.add((ticker) => {
		const screen = {width: app.screen.width, height: app.screen.height};
		exits.update(visibleCells(t, screen), t.scale, ticker.lastTime / 1000);
	});

	// click (not drag) to select a piece of yours and plan its move
	let down: {x: number; y: number} | undefined;
	canvas.addEventListener('pointerdown', (e) => (down = {x: e.clientX, y: e.clientY}));
	canvas.addEventListener('pointerup', (e) => {
		if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
		const rect = canvas.getBoundingClientRect();
		const square = {
			x: Math.round(t.centerX + (e.clientX - rect.left - rect.width / 2) / t.scale),
			y: Math.round(t.centerY + (e.clientY - rect.top - rect.height / 2) / t.scale),
		};
		const piece = at.get(key(square));
		const selectedPiece = ui.selected && at.get(key(ui.selected));
		if (selectedPiece && pseudoMoves(selectedPiece, at).some((d) => d.x === square.x && d.y === square.y)) {
			ui.planned = {from: {...ui.selected!}, to: square};
			ui.selected = undefined;
		} else if (piece?.mine) {
			ui.selected = square;
		} else {
			ui.selected = undefined;
		}
		overlays.set(overlayState());
	});

	window.addEventListener('keydown', async (e) => {
		if (e.key === '0') {
			t.centerX = 6;
			t.centerY = 6;
			redraw();
		} else if (e.key === 'e' || e.key === 'E') {
			exits.size = exits.size === 4 ? 1 : 4;
			await load();
		}
	});

	await load();
	redraw();
	// log whether the planned king move lands on an exit, as the rule would see it
	if (ui.planned) console.log('planned move onto an exit:', isExitSquare(ui.planned.to.x, ui.planned.to.y, SPACING, exits.size));
	document.title = 'ready';
}

main();
