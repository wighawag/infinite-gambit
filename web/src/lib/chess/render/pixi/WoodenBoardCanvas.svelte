<!--
	The template's pixi host, mounted the way the wooden board needs it: smooth
	art (device resolution, antialiasing) and no template grid (the wood draws its
	own joins). A wrapper rather than new props on the page, so the play page
	stays byte-identical whichever host `../index.ts` names
	(`web/test/render-host-boundary.test.ts`). It takes exactly the props the page
	passes, and forwards them.
-->
<script lang="ts">
	import type {Container} from 'pixi.js';
	import PixiCanvas from '$lib/game/render/pixi/PixiCanvas.svelte';
	import type {CameraControl} from '$lib/game/render/camera';
	import type {CanvasEventEmitter} from '$lib/game/render/events';
	import type {GameRenderer} from '$lib/game/core/seams';

	interface Props {
		cameraControl: CameraControl;
		renderer: GameRenderer<Container>;
		eventEmitter: CanvasEventEmitter;
		cellSize: number;
		gridCells: number;
	}
	let {cameraControl, renderer, eventEmitter, cellSize, gridCells}: Props =
		$props();
</script>

<PixiCanvas
	{cameraControl}
	{renderer}
	{eventEmitter}
	{cellSize}
	{gridCells}
	smooth={true}
	showGrid={false}
	backgroundColor="#2a1a10"
/>
