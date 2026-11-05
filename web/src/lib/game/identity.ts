/**
 * WHAT THIS GAME KEYS A SUBMISSION BY.
 *
 * The framework never names a concrete identity: `createSubmission`,
 * `CommitRevealAdapter`, `createDerivedSecret` and `createSubmissionRecovery`
 * are all generic over `TIdentity extends PlayerIdentity`, deliberately,
 * because the games this template exists for disagree about what a player IS.
 * An account-keyed game plays as an address; reveal-or-die and bomber-world
 * commit per ERC721 token; conquest commits per owner-derived empire id.
 *
 * So SOMETHING has to say which one this app chose, and this module is it.
 * It exists so that the choice is made in ONE file rather than spelled out at
 * every site that carries it, and the reason that matters is a merge:
 * `with/nft-identity` is a branch of this repo where the reference game becomes
 * token-keyed, and every shared file that names `0x${string}` as the identity
 * would be a file that branch has to edit and therefore conflict on forever.
 * `core/connection/mode.ts` is the proven version of the same pattern, where
 * `TARGET_STEP` is one constant and one line of difference across three
 * branches. See rules N1 to N3 of Decision 3 in the plan on the `work` branch.
 *
 * TWO WORDS THAT ARE NOT THE SAME WORD, and conflating them is the mistake
 * this module exists to make impossible:
 *
 * - the ACCOUNT is who signed in. It owns things, it pays, and it is an
 *   address in every game and every configuration. `Game.identity` is that,
 *   and so are `acquire`'s `owner`, the reserve's `payer` and everything in
 *   `onchain/delegation.ts`.
 * - the GAME IDENTITY is who PLAYS. The submission, the commitment, the
 *   secret's domain separation, the stake and the submission's storage key are
 *   all keyed by it, and it is what changes shape between games.
 *
 * IN CHESS THEY ARE DIFFERENT VALUES OF DIFFERENT TYPES. Who plays is an ARMY
 * (`CONTEXT.md`): a `uint256` id, `nonce << 160 | owner`, owned by the account
 * and acted for by its signer. An account may own several armies; the client
 * plays one at a time, chosen by `$lib/chess/armies.ts`. The template kept
 * the two names apart while their values agreed, which is what made this a
 * change of one alias rather than of every call site.
 */
import type {Readable} from 'svelte/store';
import type {PlayerIdentity} from './core/seams';

/**
 * THE ONE LINE.
 *
 * This is the whole difference between an address game and a token game, and
 * `with/nft-identity` changes it to `bigint`. Nothing else in this file, and
 * nothing in `game/core/`, has to move for that.
 *
 * A descendant that keys by a token does the same thing in its own copy of
 * this file: reveal-or-die's is `bigint`, which is the entire identity
 * difference between that repo and this one.
 */
export type GameIdentity = bigint;

/**
 * THE SAME LINE, ON THE OTHER SIDE OF THE ABI.
 *
 * The contract keys every player by a `uint256` (see `IGame.sol` and
 * `UsingGameInternal._playerOf`), and an army id already IS that number, so
 * this is the identity itself. It is still a function, and still the one
 * place that says so, because a disagreement with `_playerOf` surfaces as a
 * commitment filed under an identity the reveal cannot find.
 */
export function onchainIdentity(identity: GameIdentity): bigint {
	return identity;
}

/**
 * The framework has to be able to carry it.
 *
 * Compile-time only. `PlayerIdentity` is the union the seams accept, so an
 * alias outside it would fail at every call site at once with an error that
 * names the call site rather than the cause. This fails here instead, next to
 * the line that is actually wrong.
 */
type IdentityIsCarryable = GameIdentity extends PlayerIdentity ? true : never;
const _identityIsCarryable: IdentityIsCarryable = true;
void _identityIsCarryable;

/**
 * Which identity this client is playing AS, right now.
 *
 * Undefined before there is one, which is a real state rather than a loading
 * artefact: nobody is signed in yet, or the account holds nothing it can play
 * with. The setup gate turns that into an instruction instead of a dead board.
 *
 * A plain `Readable` and nothing more, on purpose. A game in this tree whose
 * account can own SEVERAL identities already offers a `select` on its own
 * equivalent store, because somebody has to pick; adding one here would ship a
 * capability upstream that no consumer on `main` can exercise, since there is
 * exactly one identity and it is not chosen. A richer store satisfies this
 * type structurally, so a game that needs selection supplies it without this
 * type growing a method that does nothing here.
 *
 * The game is deliberately not named, and neither is what it calls an identity:
 * a citation is only correct while it spells what that repo actually uses, and
 * this file is inherited by every one of them. See `AGENTS.md`, which keeps the
 * list of places where naming one was worth the risk.
 */
export type ActiveIdentityStore = Readable<GameIdentity | undefined>;

/**
 * THE IDENTITY PROVIDER IS THE GAME'S. This game CHOOSES: an account may own
 * several armies, and before its first deployment it owns none, so the
 * identity is the account's NEXT army (the one its deployment will create).
 * See `createArmies` in `$lib/chess/armies.ts`, which satisfies
 * {@link ActiveIdentityStore} with a store that reads the account's armies
 * off the chain.
 */
