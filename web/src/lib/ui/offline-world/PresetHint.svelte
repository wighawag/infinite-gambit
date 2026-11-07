<script lang="ts">
	/**
	 * THE DEMO HINT: which piece to move where, for the person recording a demo
	 * preset (`$lib/offline-presets`). Rendered only in a preset world, never in
	 * normal play. It floats over the board, and it hides with one key (H) or its
	 * own button, so it can be out of the shot while recording; the same key
	 * brings it back. "Restart preset" is the button pressed after a failed take.
	 *
	 * Only presentation and its own open/closed state live here: the preset, the
	 * restart and where "leave" goes are handed in.
	 */
	import {Button} from '$lib/shadcn/ui/button';
	import type {OfflinePreset} from '$lib/offline-presets';

	let {
		preset,
		onRestart,
		leave,
	}: {
		preset: OfflinePreset;
		onRestart: () => void;
		/** Where the normal offline world is. */
		leave: string;
	} = $props();

	let open = $state(true);

	function onkeydown(event: KeyboardEvent) {
		if (event.key !== 'h' && event.key !== 'H') return;
		if (event.ctrlKey || event.metaKey || event.altKey) return;
		const target = event.target as HTMLElement | null;
		if (target?.closest('input, textarea, [contenteditable="true"]')) return;
		open = !open;
	}
</script>

<svelte:window {onkeydown} />

{#if open}
	<div
		class="pointer-events-auto fixed top-20 left-4 z-40 max-w-sm rounded-lg border bg-background/95 p-3 text-xs shadow-lg"
		data-testid="preset-hint"
	>
		<div class="flex items-center justify-between gap-2">
			<p class="font-semibold">Demo: {preset.name}</p>
			<button
				class="text-muted-foreground hover:text-foreground"
				data-testid="preset-hint-hide"
				onclick={() => (open = false)}>Hide (H)</button
			>
		</div>
		<ol class="mt-2 list-decimal space-y-1 pl-4">
			{#each preset.hint as line, index (index)}
				<li>{line}</li>
			{/each}
		</ol>
		<div class="mt-3 flex gap-2">
			<Button size="sm" data-testid="preset-restart" onclick={onRestart}
				>Restart preset</Button
			>
			<Button
				size="sm"
				variant="outline"
				href={leave}
				data-sveltekit-reload
				data-testid="preset-leave">Leave</Button
			>
		</div>
	</div>
{/if}
