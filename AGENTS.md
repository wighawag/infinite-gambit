# chess-battleground

An onchain infinite-board chess game built on a commit-reveal foundation. This repo is a FINAL GAME, not a template: nothing descends from it. It was generated from `template-commit-reveal` (see `.offshoot.json`) and may still take updates from it, which is the only reason some sections below talk about upstream.

Start with `CONTEXT.md` (the words), then `work/specs/` (what we are building) and `docs/adr/` (why it is built that way).

# setup

`pnpm i`

**Check how `pnpm` is reached before assuming** (`pnpm --version`; on some hosts it is not on PATH and lives at `~/.volta/bin/pnpm`, on others it is on PATH and volta is not installed at all).

**`web/src/lib/deployments.ts` is generated and gitignored.** The root `prepare` script (`scripts/ensure-deployments.mjs`) creates it on install. A `check` failure inside `$lib/core` usually means it needs regenerating, not that shared code is broken.

# frontend

in ./web
for typescript checks: `pnpm check`
for tests: `pnpm test`

## Svelte conventions

- **`.svelte` files must be logic-less or logic-minimal.** They should only render UI and wire props/stores together. Small presentational conveniences are fine (a display formatter, a class toggle, a UI-only animation, local open/closed modal state). Anything else, business/domain logic, async blockchain calls, transaction building, balance checks, data fetching/derivation, non-trivial computation, filtering/sorting/aggregating domain data, network error handling, belongs in a plain `.ts` module (a helper, a store, or a service) that the component imports. For this game that includes all chess rules: move legality, resolution, and the bot.

- **Never create `.svelte.ts` files.** Do not use Svelte runes (`$state`, `$derived`, `$effect`, ...) outside of `.svelte` components. Put reusable logic in plain `.ts` files and expose reactivity with Svelte stores (`writable`/`readable`/`derived` from `svelte/store`). Components consume those stores with the `$store` syntax and own any `$effect`/lifecycle wiring themselves.

- Logic lives in `.ts`, reactivity crosses the boundary as stores. Prefer factory functions that return `{subscribe, ...actions}` (see the existing stores under `src/lib/**` and `src/routes/**/lib/stores/`).

## The framework boundary

- **Only `web/src/lib/kit` may import `$app/*`.** Everything under `web/src/lib/core` takes what it needs from the framework as a parameter (`PathResolver`, `ServiceWorkerEnvironment`), and `web/src/routes/**` is exempt because routes are the framework's own surface. `web/test/framework-boundary.test.ts` enforces this and `web/src/lib/kit/README.md` states the scope.

- **`web/src/lib/index.ts` is where the app is composed**, which is why it may import both `./kit/*` and the environment.

- `web/src/lib/core` and these boundary tests came from upstream. Prefer not to edit them for this game's convenience: a local edit turns every future upstream update into a merge conflict.

# Contracts

- **Deploy every contract with `deterministic: true`, and give every other transaction of a deploy script a `guard`** (`execute(..., {guard: {kind: 'call', functionName, args, equals}})`). The LAN package (`nix build .#lan`, see "On a LAN box, with no internet" in README.template.md) replays the deploy on a box's chain: it needs addresses that depend only on the init code, and a guard to know whether a setup call already happened. The LAN build fails otherwise (no contract test checks it any more, so run `nix build git+file://$PWD#lan` after changing a deploy script). Under CREATE2 a constructor's `msg.sender` is the factory, so never use it as the deployer.
- **The LAN package is built by ethereum-lan-node** (`lib.mkRockethGame`, called from `flake.nix`): change how it builds THERE, not here. A game's specifics go in the `"lan"` field of the root `package.json` (`pnpmDepsHash`, and optionally `preBuild`, `deployBin`, `solc`, `name`, `title`, `description`), never in `flake.nix`, which is the same in every repo. Recompute `pnpmDepsHash` after any `pnpm-lock.yaml` change, including one merged from the template (see that README.template.md section). Keep the two hooks it needs from this repo: `path: process.env.SOLC_PATH` in `contracts/hardhat.config.ts`, and `withGuardRecording` in `contracts/rocketh/deploy.ts`. Build with `nix build git+file://$PWD#lan` (git add new files first), never a `path:` flake reference.
- **The commit-reveal base (`contracts/src/commit-reveal/`) is the framework**: the hash chain, the reserve and both settlements. The game builds on it through its seams (`_playerOf` for who acts, `_forfeit` for what a missed reveal costs, `_cycle` for the clock) rather than editing it.

# The words

**`CONTEXT.md` is the glossary.** Its first part is the framework's vocabulary (cycle, submission, commitment, stake, forfeit, identity, ...) and is game-neutral on purpose. Its "This game" section holds chess-battleground's own words (army, move, spawn point, deployment, exit, capture, stone, promotion, collision, freeze). Read it before naming anything, and extend that section when the game settles a new word.

- The interval is a `cycle` (`cycleNumber`), never `epoch`. `round` and `turn` are reserved for games by the framework, and this game deliberately uses neither, so they cannot be confused with a cycle.
- `web/src/lib/core/transaction/in-flight.ts` says `ms since epoch`: that is the UNIX epoch, not a renamed interval. Leave it.
- `web/test/svelte-conventions-boundary.test.ts` cites `game/core/round.ts` and `RoundState`. That is a record of another repo's file, kept verbatim from upstream. Leave it.

**ADR numbers need a repo attached.** This repo's own decisions are in `docs/adr/` and are cited by path (`docs/adr/0002-order-free-lazy-resolution.md`). A bare `ADR-0002` or `ADR-0004` in code inherited from upstream means **jolly-roger's** ADRs, which are unrelated to ours. Do not renumber or "fix" those citations.

# Commit-reveal rules

Every one of these is easy to break by accident.

- **A reveal must not branch on state another reveal in the same cycle could have changed.** Reveals arrive in whatever order the mempool delivers them, so the board after a set of commitments must not depend on that order. If it does, whoever pays the most gas decides the outcome, and committing bought nothing. This game meets the rule with lazy resolution (`docs/adr/0002-order-free-lazy-resolution.md`): reveals only accumulate order-free facts and every comparison happens when a square is next read. Keep a test that replays the same commitments in several orders and asserts the same board, ownership and stakes. The test is whether the ORDER can change what a player GETS. If you need an exemption, write the argument next to the code and pin it with a test; if you cannot make the argument, you are looking at the rule, not an exception.

- **Something must be at stake, or nobody has to reveal.** Here a missed reveal freezes the army forever (`docs/adr/0005-missed-reveal-freezes-the-army.md`).

- **Renaming a persisted key or field forfeits the stake of every player who has one in flight, and every suite stays green while it happens.** The secret that opens a commitment lives in the browser, in the game's submission storage, and nowhere else. `load()` discards any record it cannot read, so a record written by the previous build under the old name is a player who can no longer reveal: their army freezes. Nothing catches this: the tests are renamed with the code and the type checker sees a rename rather than a break. So once the game has users, the storage key and every field name in the record are a WIRE: treat a change to either like a change to the ABI. If you must, read both shapes for a release and write the new one. Before the first deploy this costs nothing, and "nothing is deployed yet" is a claim to check (`git ls-files contracts/deployments`), not assume.

# Planning: the `work/` folder

Planning lives in `work/` on `main`, following dorfl's `work/` contract (reference docs in `work/protocol/`, re-synced by `dorfl sync`; never edit them by hand). Specs are in `work/specs/`, the build board in `work/tasks/`, captured signals in `work/notes/`, and what needs a human in `work/questions/`. Decisions are in `docs/adr/`.

`dorfl` is pinned as a root devDependency and `dorfl.json` forwards bare `dorfl` to it. The acceptance gate is `dorfl.json`'s `verify`.

If reality contradicts a spec or an ADR, change the document in the same commit as the code that proved it wrong, and say which claim was wrong.

# Taking an update from upstream

Only relevant when merging a new version of `template-commit-reveal` into this repo.

- **Run `node scripts/check-dangling-imports.mjs`** (it is also the first step of `verify`). A hunk that merges cleanly can still import a file this repo deleted, most often the template's reference game (`$lib/placement`) once chess replaces it. `scripts/apply-omissions.sh` runs it for you when resolving modify/delete conflicts.
- **List every template file this game deliberately deletes in `.offshoot-omissions`, with a reason**, so the next merge's modify/delete conflict is a lookup rather than an investigation.
