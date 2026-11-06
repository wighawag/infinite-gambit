<!--
	The HUD, drawn over the canvas.

	Logic-less on purpose (see AGENTS.md): everything it shows comes from the
	`HudModel` store, and every button calls straight into the game's stores. If
	a decision has to be made about what to show, it belongs in `hud.ts`.
-->
<script lang="ts">
	import {getAppContext} from '$lib';
	import {createHud} from './hud';
	import Button from '$lib/shadcn/ui/button/button.svelte';
	import GameClock from '$lib/game/ui/GameClock.svelte';
	import TablePanel from '$lib/game/lobby/ui/TablePanel.svelte';
	import TableLobby from '$lib/game/lobby/ui/TableLobby.svelte';
	import {tableSettingsOf} from '$lib/game/lobby/table';
	import Minimap from './Minimap.svelte';

	const context = getAppContext();
	const {game, render} = context;
	const hud = createHud(context);

	const submission = game.submission;
	const planning = game.planning;
	const missedReveal = game.missedReveal;
	// An army that left through an exit is paid by a call anyone may make.
	const exitPayout = game.exitPayout;
	// A commitment the chain holds that this browser has no submission for. The
	// planned deployment is offered as the candidate and the hash decides;
	// nothing is sent either way. See $lib/game/core/recovery.
	const recovery = game.recovery;
	const plannedActions = game.planning.actions;
	// Getting a stake is ONE transaction that also funds the play key; the rail
	// refuses to run twice at once, including across a reload, which is why the
	// button calls it rather than guarding itself. See $lib/game/acquire.
	const acquisition = game.acquisition;
	// One shared flow, built in the context, so the account panel and a blocked
	// move cannot open two top-ups at once.
	const topUp = context.topUp;

	// At a table: its lobby until it starts, then its seats over the board.
	const tableScreen = game.table?.screen;
	const tableSettings = tableSettingsOf(game.config.cycle);
	const inTableLobby = $derived(
		game.table !== undefined && $tableScreen?.screen !== 'playing',
	);

	const toneClass: Record<string, string> = {
		idle: 'text-muted-foreground',
		busy: 'text-blue-400',
		good: 'text-emerald-400',
		bad: 'text-red-400',
	};
</script>

<!-- What stands between this person and a turn (signing in, the stake,
     authorising this browser): in the HUD, and in a table's lobby, where the
     stake is what takes a seat. -->
{#snippet setupControls()}
	{#if $hud.setup}
		<!--
			Not yet playable: ask for the one thing that is missing, rather than
			showing planning controls that cannot lead anywhere.
		-->
		<p class="text-sm font-semibold">{$hud.setup.headline}</p>
		<p class="mt-1 max-w-sm text-xs text-muted-foreground">
			{$hud.setup.detail}
		</p>
		{#if $hud.setup.action === 'stake'}
			<!-- The testid is what an e2e presses. Its LABEL says what this game
			     sells, so a suite matching on the words breaks the moment the
			     stake changes - which is exactly what happened when a branch
			     started selling avatars instead of tokens. -->
			<Button
				size="sm"
				class="mt-3"
				data-testid="acquire-stake"
				disabled={$hud.setup.busy}
				onclick={() => acquisition.buy()}
			>
				{$hud.setup.busyLabel ?? $hud.setup.actionLabel}
			</Button>
			{#if $hud.setup.error}
				<p class="mt-2 max-w-sm text-xs text-red-400">{$hud.setup.error}</p>
			{/if}
		{:else if $hud.setup.action === 'authorise'}
			<!--
				The same flow the out-of-gas remedy uses: it registers the delegate
				AND funds it in one transaction, which is the right shape here too.
				A key that is authorised but has no gas is authorised in name only,
				and that is a second dead end one step further on.
			-->
			<Button
				size="sm"
				class="mt-3"
				onclick={() => topUp.start(topUp.purposes.authorise)}
			>
				Authorise and carry on
			</Button>
		{/if}
	{/if}
{/snippet}

<div
	class="pointer-events-none absolute inset-0 z-10 flex flex-col justify-between p-3"
>
	<!-- At a table: its lobby (what it plays by, who is seated, the creator's
	     start) until it has started and this person holds a seat; then who is
	     playing, and the creator's forfeit. -->
	{#if game.table && inTableLobby}
		<TableLobby
			table={game.table}
			inviteLink={typeof location === 'undefined' ? '' : location.href}
			settings={tableSettings}
		>
			{#snippet takeSeat()}
				{@render setupControls()}
			{/snippet}
		</TableLobby>
	{:else if game.table}
		<div class="absolute top-3 right-3">
			<TablePanel table={game.table} />
		</div>
	{/if}
	<!-- Where the fighting is, and the way back to your army. -->
	<div class="absolute right-3 bottom-3">
		<Minimap minimap={render.minimap} follow={render.follow} />
	</div>
	<!-- Phase and cycle -->
	<div
		class="pointer-events-auto w-fit rounded-lg bg-background/85 p-3 shadow-lg backdrop-blur"
	>
		<!--
			THE DIAL, not a dot and a bar. It is the one thing a player checks
			constantly, and a pie reads faster than a bar because the answer is a
			shape rather than a length. It is offered by the framework
			(`game/ui/GameClock.svelte`) against the four-part model; a game that
			wants a different picture writes one against the same type.
		-->
		<div class="flex items-center gap-3">
			<GameClock
				phase={$hud.phase}
				progress={$hud.progress}
				secondsLeft={$hud.secondsLeft}
				size={72}
			/>
			<div>
				<p class="text-sm font-semibold">{$hud.phaseLabel}</p>
				<p class="text-xs text-muted-foreground">cycle {$hud.cycleNumber}</p>
			</div>
		</div>
		{#if $hud.walletSigningNotice}
			<p class="mt-1 max-w-xs text-xs text-amber-400">
				{$hud.walletSigningNotice}
			</p>
		{/if}
		{#if $hud.planningForNextCycle}
			<p class="mt-1 text-xs text-amber-400">
				This cycle is closed. New picks count for the next one.
			</p>
		{/if}
	</div>

	<!-- The submission -->
	<div
		class="pointer-events-auto w-fit max-w-md rounded-lg bg-background/85 p-3 shadow-lg backdrop-blur"
	>
		<!--
			A missed reveal has already cost the player their bond, so it is stated
			plainly and settled only on a deliberate press: acknowledging is what
			makes the forfeit final on chain, and it is not ours to do for them.
		-->
		<!--
			The saved turn is not readable yet (loading) or could not be read: play
			waits, and a failure is said rather than shown as an empty turn.
		-->
		{#if $hud.savedTurn}
			<div
				class="mb-3 rounded-md border p-2 {$hud.savedTurn.tone === 'bad'
					? 'border-red-500/40 bg-red-500/10'
					: 'border-border bg-muted/40'}"
				data-testid="saved-turn"
			>
				<p
					class="text-sm font-semibold {$hud.savedTurn.tone === 'bad'
						? 'text-red-400'
						: ''}"
				>
					{$hud.savedTurn.headline}
				</p>
				<p class="mt-1 text-xs text-muted-foreground">
					{$hud.savedTurn.detail}
				</p>
			</div>
		{/if}

		{#if $hud.exitPayout}
			<div
				class="mb-3 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-2"
			>
				<p class="text-sm font-semibold text-emerald-400">
					{$hud.exitPayout.headline}
				</p>
				<p class="mt-1 text-xs text-muted-foreground">
					{$hud.exitPayout.detail}
				</p>
				<Button
					size="sm"
					class="mt-2"
					disabled={$hud.exitPayout.busy}
					onclick={() => exitPayout.claim($hud.exitPayout!.army)}
				>
					{$hud.exitPayout.actionLabel}
				</Button>
				{#if $hud.exitPayout.error}
					<p class="mt-1 text-xs text-red-400">{$hud.exitPayout.error}</p>
				{/if}
			</div>
		{/if}

		{#if $hud.missedReveal}
			<div class="mb-3 rounded-md border border-red-500/40 bg-red-500/10 p-2">
				<p class="text-sm font-semibold text-red-400">
					{$hud.missedReveal.headline}
				</p>
				<p class="mt-1 text-xs text-muted-foreground">
					{$hud.missedReveal.detail}
				</p>
				<Button
					size="sm"
					variant="destructive"
					class="mt-2"
					disabled={!$hud.missedReveal.canAcknowledge}
					onclick={() => missedReveal.acknowledge()}
				>
					{$hud.missedReveal.busy
						? 'Acknowledging...'
						: 'Acknowledge missed reveal'}
				</Button>
			</div>
		{/if}

		<!--
			The chain holds a commitment this browser cannot open. Unlike a missed
			reveal, nothing has been lost yet and the whole point is that it still
			can be: the player re-enters the same turn and the hash decides.
		-->
		{#if $hud.recovery}
			<div
				class="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-2"
			>
				<p class="text-sm font-semibold text-amber-400">
					{$hud.recovery.headline}
				</p>
				<p class="mt-1 max-w-sm text-xs text-muted-foreground">
					{$hud.recovery.detail}
				</p>
				<Button
					size="sm"
					class="mt-2"
					disabled={!$hud.recovery.canRecover}
					onclick={() => recovery.offer($plannedActions)}
				>
					{$hud.recovery.busy ? 'Checking...' : 'Recover turn'}
				</Button>
			</div>
		{/if}

		{#if $hud.setup}
			<!-- In a table's lobby the setup is asked for there, once. -->
			{#if !inTableLobby}{@render setupControls()}{/if}
		{:else}
			<p class="text-sm {toneClass[$hud.submissionTone]}">
				{$hud.submissionLabel}
			</p>

			{#if $hud.revealSchedule}
				<!-- Who reveals this turn (`with/fuzd`): decided in hud.ts. -->
				<p
					class="mt-1 text-xs {toneClass[$hud.revealSchedule.tone]}"
					data-testid="reveal-schedule"
					data-step={$hud.revealSchedule.step}
				>
					{$hud.revealSchedule.label}
				</p>
			{/if}

			{#if $hud.outOfGas}
				<!--
					The one failure with a remedy. The submission retries itself once the
					gas arrives, so this offers the top-up and says so, rather than
					asking the player to also remember to press something after.
				-->
				<div
					class="mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2"
				>
					<p class="text-xs text-muted-foreground">{$hud.outOfGas.detail}</p>
					<!-- The gas remedy, so the payment is a top-up even though the
					     submission is what is blocked; the sentence above has already
					     said why. -->
					<Button
						size="sm"
						class="mt-2"
						onclick={() => topUp.start(topUp.purposes.topUp)}
					>
						Top up and carry on
					</Button>
				</div>
			{/if}

			<dl class="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
				{#if $hud.army}
					<dt class="text-muted-foreground">Army</dt>
					<dd class={toneClass[$hud.army.tone]} data-testid="army-status">
						{$hud.army.label}
					</dd>
					<dt class="text-muted-foreground">Army stake</dt>
					<dd>{$hud.army.stakeLabel}</dd>
				{/if}
				{#if $hud.lastDeployment}
					<dt class="text-muted-foreground">Last deployment</dt>
					<dd
						class={toneClass[$hud.lastDeployment.tone]}
						data-testid="last-deployment"
					>
						{$hud.lastDeployment.label}
					</dd>
					<dt class="text-muted-foreground">Its stake</dt>
					<dd data-testid="last-deployment-stake">
						{$hud.lastDeployment.stakeLabel}
					</dd>
				{/if}
				{#if $hud.deployment}
					<dt class="text-muted-foreground">Deploy at</dt>
					<dd>{$hud.deployment.picked ?? 'pick a spawn point'}</dd>
					<dt class="text-muted-foreground">Cost</dt>
					<dd>{$hud.costLabel}</dd>
				{/if}
				{#if $hud.moving}
					<dt class="text-muted-foreground">Move</dt>
					<dd data-testid="planned-move">
						{$hud.moving.planned ?? 'select a piece'}
					</dd>
				{/if}
				<dt class="text-muted-foreground">Reserve</dt>
				<dd>{$hud.reserveLabel}</dd>
			</dl>

			{#if $hud.lastCycle}
				<!-- What the last cycle did, as the contract resolved it. -->
				<div class="mt-2 text-xs" data-testid="last-cycle">
					<p class="text-muted-foreground">
						Cycle {$hud.lastCycle.cycleNumber}
					</p>
					<ul>
						{#each $hud.lastCycle.lines as line, i (i)}
							<li class={toneClass[line.tone]}>{line.label}</li>
						{/each}
					</ul>
				</div>
			{/if}

			{#if $hud.deployment}
				<!-- The open spawn points, nearest the origin first. Picking one here
				     or on the board is the same plan; it stays hidden until the
				     reveal. -->
				<ul
					class="mt-2 max-h-40 overflow-y-auto text-xs"
					data-testid="spawn-points"
				>
					{#each $hud.deployment.spawnPoints as point (point.spawnPoint)}
						<li>
							<button
								class="w-full rounded px-1 py-0.5 text-left hover:bg-muted {point.picked
									? 'bg-amber-500/20 text-amber-300'
									: ''}"
								data-testid="spawn-point"
								onclick={() => planning.choose(point.spawnPoint)}
							>
								{point.label}
								<span class="text-muted-foreground">{point.nearest}</span>
							</button>
						</li>
					{/each}
				</ul>
			{/if}

			{#if $hud.warning}
				<p class="mt-2 text-xs text-amber-400">{$hud.warning}</p>
			{/if}

			<div class="mt-3 flex flex-wrap gap-2">
				{#if $hud.deployment}
					<Button
						size="sm"
						disabled={!$hud.canCommit}
						data-testid="commit-deployment"
						onclick={() => submission.commit()}
					>
						Deploy
					</Button>
				{/if}
				{#if $hud.moving}
					<Button
						size="sm"
						disabled={!$hud.canCommit}
						data-testid="commit-move"
						onclick={() => submission.commit()}
					>
						Commit move
					</Button>
				{/if}
				{#if $hud.canPass}
					<Button
						size="sm"
						data-testid="pass"
						onclick={() => submission.commit()}
					>
						Pass
					</Button>
				{/if}
				{#if $hud.canReveal}
					<Button
						size="sm"
						variant="destructive"
						onclick={() => submission.reveal()}
					>
						Retry reveal
					</Button>
				{/if}
				<Button
					size="sm"
					variant="outline"
					disabled={!$hud.canClear}
					onclick={() => planning.clear()}
				>
					Clear
				</Button>
				<!-- The same rail as the setup gate, so a top-up is one transaction
				     too and cannot be started twice. It refuses while a previous one is
				     still settling, which is why the label follows the flow. -->
				<Button
					size="sm"
					variant="secondary"
					data-testid="acquire-more-stake"
					disabled={$hud.acquiring !== undefined}
					onclick={() => acquisition.buy()}
				>
					{$hud.acquiring ?? 'Add stake'}
				</Button>
			</div>

			<p class="mt-2 text-xs text-muted-foreground">
				{#if $hud.deployment}
					Pick an open spawn point (on the board or in the list) and deploy.
					Nobody sees where until the reveal; two armies revealing the same
					spawn point both fail.
				{:else if $hud.moving}
					Select one of your pieces, then one of the highlighted squares. One
					move per cycle, hidden until the reveal; it lands when the cycle ends.
				{:else}
					Your army acts from the cycle after it lands.
				{/if}
			</p>
		{/if}
	</div>
</div>
