<script lang="ts">
	import {route} from '$lib';
	import {url} from '$lib/kit/paths';
	import DefaultHead from '../lib/metadata/DefaultHead.svelte';
	import {brand} from '$lib/metadata/brand';
	import {lobby} from '$lib/context/index';
	import config from '../web-config.json';
</script>

<!-- THE GAME'S HOME PAGE: Infinite Gambit's landing (ported from `landing/`,
     the static page in `assets/brand/`'s identity) with the game menu as its
     calls to action.

     THIS FILE DIVERGES FROM THE TEMPLATE ON PURPOSE. Upstream, this page is
     byte-identical in every game and is rebranded only through
     `src/web-config.json`; that gives a title and three buttons, and this game
     wants a landing. So when an update from `template-commit-reveal` touches
     the template's version, keep this one and port anything the template's
     menu gained (a new entry, a changed route) into the calls to action below.

     Words follow CONTEXT.md: a king LEAVES through an exit (never "cash out"),
     a captured army VANISHES (there are no merges), and a collision is decided
     by how many arrived, a king surviving a crowd. -->

<DefaultHead />

<div class="landing">
	<header class="hero">
		<div class="board" aria-hidden="true">
			<!-- The Devcon inlay: the Ethereum logo as four triangles, one in each
			     of the squares meeting at the board's centre, each in the opposite
			     wood to its square. -->
			<svg class="inlay" viewBox="-1 -1 2 2">
				<path class="maple" d="M0.0 -0.98 L-0.53 0.0 L0.0 0.0 Z" /><path
					class="rosewood"
					d="M0.0 -0.98 L0.53 0.0 L0.0 0.0 Z"
				/>
				<path class="rosewood" d="M0.0 0.94 L-0.53 0.0 L0.0 0.38 Z" /><path
					class="maple"
					d="M0.0 0.94 L0.53 0.0 L0.0 0.38 Z"
				/>
			</svg>
		</div>
		<div class="hero-copy">
			<h1 class="title">
				<img
					src={url(brand.logo ?? '/lockup-light.svg')}
					alt={brand.name}
					class="lockup"
				/>
			</h1>
			<p class="headline">
				Chess for everyone at once,<br />on a board with no edges.
			</p>
			<p class="lede">
				Stake an army, hide your move, reveal it with everyone else. Capture a
				king to take its stake. Walk your king out through an exit with
				everything it holds.
			</p>
			<!-- Labelled exactly as `e2e/tests/home.e2e.ts` finds them. -->
			<nav class="cta" aria-label="Game menu">
				<a class="btn primary" href={route('/play/')}>Online</a>
				<!-- TABLES, when the game has them (`$lib/game/lobby/table`). -->
				{#if lobby}
					<a class="btn" href={route('/lobby/')}>Tables</a>
				{/if}
				<!-- OFFLINE IS A WORLD, NOT A DEMO: a chain in this tab
				     (`routes/offline/`, `$lib/offline.ts`). -->
				<a class="btn" href={route('/offline/')}>Offline</a>
			</nav>
			<a class="more" href="#how">How it works</a>
		</div>
	</header>

	<section id="how" class="how">
		<h2>One cycle</h2>
		<ol class="steps">
			<li>
				<span class="num">1</span>
				<h3>Stake and deploy</h3>
				<p>
					Buy a stake and pick a spawn point in secret. Your army appears at the
					end of the cycle: a king holding your stake, ringed by pawns.
				</p>
			</li>
			<li>
				<span class="num">2</span>
				<h3>Commit</h3>
				<p>
					Every army makes one move per cycle. You commit it as a hash, so
					nobody can see it while they choose theirs.
				</p>
			</li>
			<li>
				<span class="num">3</span>
				<h3>Reveal together</h3>
				<p>
					Everyone opens their moves, and they all resolve against the board as
					it was at the start of the cycle.
				</p>
			</li>
			<li>
				<span class="num">4</span>
				<h3>Capture or exit</h3>
				<p>
					Take a king and its whole stake is yours. Bring your king alone onto
					an exit to leave the world with everything it holds. Miss a reveal and
					your army freezes.
				</p>
			</li>
		</ol>
	</section>

	<section class="rules">
		<h2>Simultaneous chess has new rules</h2>
		<div class="cards">
			<figure>
				<svg viewBox="0 0 120 120" class="mini" aria-hidden="true">
					<use href="#grid" />
					<text x="20" y="60" class="p them">♝</text>
					<text x="60" y="60" class="p you">♞</text>
					<path d="M28 52 Q44 38 54 48" class="arrow them" />
					<path d="M66 64 Q86 92 96 100" class="arrow you" />
				</svg>
				<figcaption>
					<strong>Dodge.</strong> Move away and the capture misses: the attacker lands
					on an empty square.
				</figcaption>
			</figure>
			<figure>
				<svg viewBox="0 0 120 120" class="mini" aria-hidden="true">
					<use href="#grid" />
					<text x="20" y="60" class="p you">♜</text>
					<text x="100" y="60" class="p them">♜</text>
					<path d="M30 46 L90 46" class="arrow you" />
					<path d="M90 74 L30 74" class="arrow them" />
				</svg>
				<figcaption>
					<strong>Swap.</strong> Two pieces that trade squares or cross paths both
					complete their moves.
				</figcaption>
			</figure>
			<figure>
				<svg viewBox="0 0 120 120" class="mini" aria-hidden="true">
					<use href="#grid" />
					<text x="20" y="100" class="p you">♝</text>
					<text x="100" y="100" class="p them">♝</text>
					<path d="M28 90 L54 66" class="arrow you" />
					<path d="M92 90 L66 66" class="arrow them" />
					<text x="60" y="60" class="boom">✕</text>
				</svg>
				<figcaption>
					<strong>Collision.</strong> Pieces landing on one square together die. A
					king survives a crowd, but not a duel.
				</figcaption>
			</figure>
			<figure>
				<svg viewBox="0 0 120 120" class="mini" aria-hidden="true">
					<use href="#grid" />
					<text x="60" y="60" class="p them">♚</text>
					<text x="20" y="100" class="p you">♝</text>
					<path d="M28 90 L52 68" class="arrow you" />
				</svg>
				<figcaption>
					<strong>Capture.</strong> One arriver takes a piece that stayed put. Take
					a king: its stake is yours, its army vanishes, and your piece becomes a
					queen.
				</figcaption>
			</figure>
		</div>
	</section>

	<section class="fair">
		<div>
			<h2>Reveal order never decides a fight</h2>
			<p>
				On most onchain games, whoever's transaction lands first wins. Here a
				reveal only records facts that do not depend on order: where each piece
				came from, where it went, and how many pieces arrived on each square.
				Every square resolves lazily from those facts, with no settlement
				transaction for anyone to pay.
			</p>
			<p>
				The rules live in one place only: the contract. The game runs the
				contract's own code in an EVM inside your browser, so what you see is
				exactly what the chain will do.
			</p>
		</div>
	</section>

	<section class="crops">
		<h2>It keeps working without us</h2>
		<ul>
			<li>
				<strong>Runs from anywhere.</strong> A static site that works from IPFS or
				any host, with no backend.
			</li>
			<li>
				<strong>Plays offline.</strong> The whole world can run on a chain inside
				your browser: hotseat on one device, or against the machine.
			</li>
			<li>
				<strong>Open source.</strong> AGPL-3.0. Build and run every part from the
				repository.
			</li>
			<li>
				<strong>Nothing tracks you.</strong> No analytics, keys stay on your device,
				moves stay hidden until reveal.
			</li>
		</ul>
	</section>

	<section class="play">
		<img src={url('/logo-light.svg')} alt="" class="play-mark" />
		<h2>Your move.</h2>
		<div class="cta">
			<a class="btn primary" href={route('/play/')}>Enter the world</a>
			<a class="btn" href={route('/offline/')}>Play offline</a>
		</div>
	</section>

	<footer>
		<p>
			Built at ETHGlobal Mumbai 2026 · <a href={config.repoURL}>Source</a> · AGPL-3.0
		</p>
	</footer>

	<svg width="0" height="0" style="position: absolute" aria-hidden="true">
		<defs>
			<g id="grid">
				<rect x="0" y="0" width="40" height="40" fill="#e2cba0" /><rect
					x="40"
					y="0"
					width="40"
					height="40"
					fill="#7a4a2c"
				/><rect x="80" y="0" width="40" height="40" fill="#e2cba0" />
				<rect x="0" y="40" width="40" height="40" fill="#7a4a2c" /><rect
					x="40"
					y="40"
					width="40"
					height="40"
					fill="#e2cba0"
				/><rect x="80" y="40" width="40" height="40" fill="#7a4a2c" />
				<rect x="0" y="80" width="40" height="40" fill="#e2cba0" /><rect
					x="40"
					y="80"
					width="40"
					height="40"
					fill="#7a4a2c"
				/><rect x="80" y="80" width="40" height="40" fill="#e2cba0" />
			</g>
		</defs>
	</svg>
</div>

<style>
	@font-face {
		font-family: 'Cinzel';
		/* imported through Vite, so the build fingerprints it and keeps the path
		   relative (the app must work from IPFS) */
		src: url('$lib/brand/fonts/Cinzel-VariableFont_wght.ttf') format('truetype');
		font-weight: 400 900;
		font-display: swap;
	}

	.landing {
		--night: #16110d;
		--walnut: #2a1d14;
		--maple: #e2cba0;
		--rosewood: #7a4a2c;
		--ink: #f6efe4;
		--muted: #b8a993;
		--gold: #f5b83d;
		--you: #ffd166;
		--them: #8fb8ff;
		--sq: 72px;
		background: var(--night);
		color: var(--ink);
		font-size: 18px;
		line-height: 1.6;
		min-height: 100%;
	}

	h2,
	h3,
	.headline {
		font-family: 'Cinzel', Georgia, serif;
		font-weight: 700;
		line-height: 1.15;
		margin: 0 0 0.6em;
	}

	a {
		color: var(--gold);
	}

	/* Hero: an endless board that fades into the night, with the Devcon board's
	   Ethereum inlay across the four squares that meet at its centre. */
	.hero {
		position: relative;
		min-height: min(calc(100vh - 4rem), 900px);
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.board {
		position: absolute;
		left: 0;
		right: 0;
		top: 38%;
		height: 90%;
		/* Conic quarters clockwise from 12 o'clock: the tile centre is a corner
		   where four squares meet, top-right and bottom-left maple. */
		background: conic-gradient(
				var(--maple) 25%,
				var(--rosewood) 0 50%,
				var(--maple) 0 75%,
				var(--rosewood) 0
			)
			50% 50% / calc(var(--sq) * 2) calc(var(--sq) * 2);
		opacity: 0.2;
		-webkit-mask: radial-gradient(
			ellipse 60% 55% at 50% 50%,
			#000 15%,
			transparent 75%
		);
		mask: radial-gradient(
			ellipse 60% 55% at 50% 50%,
			#000 15%,
			transparent 75%
		);
	}

	.inlay {
		position: absolute;
		left: 50%;
		top: 50%;
		width: calc(var(--sq) * 2);
		height: calc(var(--sq) * 2);
		transform: translate(-50%, -50%);
	}

	.inlay .maple {
		fill: var(--maple);
	}

	.inlay .rosewood {
		fill: var(--rosewood);
	}

	.hero-copy {
		position: relative;
		margin: auto;
		max-width: 1000px;
		padding: 48px 24px 18vh;
		text-align: center;
	}

	.title {
		margin: 0 0 1.5rem;
	}

	.lockup {
		margin: 0 auto;
		height: clamp(72px, 12vw, 128px);
		width: auto;
		filter: drop-shadow(0 12px 30px rgba(245, 184, 61, 0.25));
	}

	.headline {
		font-size: clamp(1.8rem, 4vw, 3.1rem);
	}

	.lede {
		color: var(--muted);
		font-size: 1.2rem;
		max-width: 620px;
		margin: 0 auto 2rem;
	}

	.cta {
		display: flex;
		gap: 16px;
		justify-content: center;
		flex-wrap: wrap;
	}

	.btn {
		display: inline-block;
		padding: 14px 28px;
		border: 2px solid var(--gold);
		border-radius: 10px;
		color: var(--ink);
		text-decoration: none;
		font-family: 'Cinzel', Georgia, serif;
		font-weight: 700;
		letter-spacing: 0.04em;
	}

	.btn.primary {
		background: var(--gold);
		color: var(--night);
	}

	.btn:hover {
		transform: translateY(-1px);
	}

	.more {
		display: inline-block;
		margin-top: 1.5rem;
		color: var(--muted);
		font-size: 0.95rem;
	}

	section {
		max-width: 1100px;
		margin: 0 auto;
		padding: 96px 24px;
	}

	section h2 {
		font-size: clamp(1.6rem, 3.2vw, 2.4rem);
		text-align: center;
		margin-bottom: 1.4em;
	}

	.steps {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
		gap: 24px;
	}

	.steps li {
		background: var(--walnut);
		border-radius: 16px;
		padding: 28px;
	}

	.num {
		display: inline-grid;
		place-items: center;
		width: 40px;
		height: 40px;
		border-radius: 50%;
		background: var(--gold);
		color: var(--night);
		font-family: 'Cinzel', serif;
		font-weight: 900;
		margin-bottom: 14px;
	}

	.steps h3 {
		font-size: 1.2rem;
	}

	.steps p,
	.cards figcaption,
	.fair p,
	.crops li {
		color: var(--muted);
	}

	.cards {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 24px;
	}

	.cards figure {
		margin: 0;
		background: var(--walnut);
		border-radius: 16px;
		padding: 20px;
	}

	.cards strong,
	.crops strong {
		color: var(--ink);
	}

	.mini {
		width: 100%;
		border-radius: 10px;
		margin-bottom: 12px;
	}

	.mini .p {
		font:
			30px 'DejaVu Sans',
			'Segoe UI Symbol',
			'Noto Sans Symbols 2',
			sans-serif;
		text-anchor: middle;
		dominant-baseline: central;
		paint-order: stroke;
		stroke-width: 2px;
	}

	.mini .you {
		fill: var(--you);
		stroke: var(--night);
	}

	.mini .them {
		fill: var(--them);
		stroke: var(--night);
	}

	.mini .arrow {
		fill: none;
		stroke-width: 4;
		stroke-linecap: round;
		stroke-dasharray: 2 8;
	}

	.mini .arrow.you {
		stroke: var(--night);
	}

	.mini .arrow.them {
		stroke: #2b4a80;
	}

	.mini .boom {
		font:
			900 34px system-ui,
			sans-serif;
		fill: #c0392b;
		text-anchor: middle;
		dominant-baseline: central;
	}

	.fair p {
		margin: 0 0 1em;
	}

	.fair > div {
		max-width: 760px;
		margin: 0 auto;
		font-size: 1.1rem;
	}

	.fair h2 {
		color: var(--gold);
	}

	.crops ul {
		list-style: none;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
		gap: 20px;
	}

	.crops li {
		border-left: 3px solid var(--gold);
		padding: 4px 0 4px 18px;
	}

	.play {
		text-align: center;
	}

	.play-mark {
		width: 90px;
		margin: 0 auto 1rem;
	}

	footer {
		text-align: center;
		color: var(--muted);
		padding: 40px 24px 60px;
		font-size: 0.9rem;
	}
</style>
