<!--
	The minimap: the spawn spiral, every army on the board and what the camera
	sees, with a click sending the camera there, and the way back to the army.

	Logic-less (see AGENTS.md): the map is `$lib/chess/minimap`'s model, drawn in
	its own coordinates (squares) as the view box, so nothing is projected here.
	The one conversion is the click's, from the pointer to a fraction of the map.
-->
<script lang="ts">
	import Button from '$lib/shadcn/ui/button/button.svelte';
	import type {MinimapStore} from '../minimap';
	import type {CameraFollowStore} from '../camera-follow';

	let {minimap, follow}: {minimap: MinimapStore; follow: CameraFollowStore} =
		$props();

	function navigate(event: MouseEvent & {currentTarget: HTMLButtonElement}) {
		// A keyboard press has no pointer to say where.
		if (event.detail === 0) return;
		const rect = event.currentTarget.getBoundingClientRect();
		minimap.navigate({
			x: (event.clientX - rect.left) / rect.width,
			y: (event.clientY - rect.top) / rect.height,
		});
	}
</script>

{#if $minimap}
	{@const b = $minimap.bounds}
	{@const mark = b.width / 50}
	<div
		class="pointer-events-auto w-fit rounded-lg bg-background/85 p-2 shadow-lg backdrop-blur"
		data-testid="minimap"
	>
		<button
			type="button"
			class="block cursor-crosshair rounded bg-black/40"
			aria-label="Minimap: click to move the camera there"
			onclick={navigate}
		>
			<svg
				class="block h-40 w-40"
				viewBox="{b.x} {b.y} {b.width} {b.height}"
				aria-hidden="true"
			>
				{#each $minimap.spawnPoints as point (`${point.x},${point.y}`)}
					<rect
						x={point.x - 3.5}
						y={point.y - 3.5}
						width="7"
						height="7"
						fill={point.open ? 'rgba(255, 209, 102, 0.25)' : 'none'}
						stroke={point.open ? '#ffd166' : 'rgba(255, 255, 255, 0.35)'}
						stroke-width={mark / 3}
					/>
				{/each}
				{#each $minimap.exits as exit (`${exit.x},${exit.y}`)}
					<rect
						x={exit.x - mark / 2}
						y={exit.y - mark / 2}
						width={mark}
						height={mark}
						transform="rotate(45 {exit.x} {exit.y})"
						fill="rgba(6, 214, 160, 0.7)"
						data-testid="minimap-exit"
					/>
				{/each}
				<rect
					x={$minimap.view.x}
					y={$minimap.view.y}
					width={$minimap.view.width}
					height={$minimap.view.height}
					fill="rgba(255, 255, 255, 0.06)"
					stroke="white"
					stroke-width={mark / 3}
				/>
				{#each $minimap.armies as army (army.id)}
					<circle
						cx={army.x}
						cy={army.y}
						r={army.you ? mark * 1.4 : mark}
						fill={army.colour}
						stroke={army.you ? 'white' : 'none'}
						stroke-width={mark / 3}
					/>
				{/each}
			</svg>
		</button>
		<Button
			size="sm"
			variant="outline"
			class="mt-2 w-full"
			data-testid="follow-army"
			disabled={!$follow.hasTarget || $follow.following}
			onclick={() => follow.recentre()}
		>
			{$follow.following && $follow.hasTarget
				? 'Following your army'
				: 'Back to your army'}
		</Button>
	</div>
{/if}
