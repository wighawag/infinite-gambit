/**
 * The spike's harness: a pixi application, a camera, three armies around the
 * inlay and a few far away. Everything worth keeping is in board.ts, wood.ts
 * and pieces.ts; this file is what the game's host already does for real.
 *
 * URL parameters, for screenshots: ?x=&y=&scale= set the camera.
 */
import {Application, CanvasSource, Container, Sprite, Texture} from 'pixi.js';
import {WoodBoard} from './board';
import {PieceLayer, PieceTextures, type Kind, type PieceView} from './pieces';
import {applyTransform, attachControls, visibleCells, type ViewTransform} from './camera';

const CELL = 64;
const YOU = '#ffd166';

/**
 * An army as the game deploys it: a king and seven pieces in a 4 x 2 block,
 * with a row of six pawns on each long side (twelve pawns, twenty pieces).
 */
function army(cx: number, cy: number, colour: string, mine: boolean): PieceView[] {
	const back: Kind[] = ['rook', 'knight', 'bishop', 'king'];
	const front: Kind[] = ['queen', 'bishop', 'knight', 'rook'];
	const out: PieceView[] = [];
	back.forEach((kind, i) => out.push({kind, x: cx - 2 + i, y: cy, army: colour, mine}));
	front.forEach((kind, i) => out.push({kind, x: cx - 2 + i, y: cy + 1, army: colour, mine}));
	for (let i = -3; i <= 2; i++) {
		out.push({kind: 'pawn', x: cx + i, y: cy - 1, army: colour, mine});
		out.push({kind: 'pawn', x: cx + i, y: cy + 2, army: colour, mine});
	}
	return out;
}

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
	const app = new Application();
	await app.init({
		canvas,
		resizeTo: window,
		background: '#16110d',
		antialias: true,
		resolution: window.devicePixelRatio || 1,
		autoDensity: true,
	});

	const world = new Container();
	const board = new WoodBoard(CELL);
	const textures = new PieceTextures();
	const pieces = new PieceLayer(CELL, textures);
	world.addChild(board.container, pieces.container);
	const shade = new Sprite(vignette());
	app.stage.addChild(world, shade);

	await pieces.set([
		...army(-6, 3, YOU, true),
		...army(5, -6, '#6ea8ff', false),
		...army(7, 5, '#ef6f8f', false),
		...army(-30, -24, '#7ed6a5', false),
		...army(34, 20, '#c792ea', false),
	]);

	const params = new URLSearchParams(location.search);
	const t: ViewTransform = {
		centerX: Number(params.get('x') ?? -0.5),
		centerY: Number(params.get('y') ?? -0.5),
		scale: Number(params.get('scale') ?? 56),
	};

	const redraw = () => {
		const screen = {width: app.screen.width, height: app.screen.height};
		applyTransform(world, t, screen, CELL);
		board.update(visibleCells(t, screen));
		shade.width = screen.width;
		shade.height = screen.height;
	};
	attachControls(canvas, t, redraw);
	app.renderer.on('resize', redraw);
	window.addEventListener('keydown', (e) => {
		if (e.key === '0') {
			t.centerX = -0.5;
			t.centerY = -0.5;
			redraw();
		}
	});
	redraw();
	document.title = 'ready';
}

main();
