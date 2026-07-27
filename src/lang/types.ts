/**
 * Language packs for the deterministic titler.
 *
 * Everything language-specific lives here so the titler itself stays a pure
 * scoring algorithm. A pack is plain data: four word lists, no code. Adding a
 * language means writing one of these and registering it — see `README.md`.
 */

/**
 * The word lists a language needs. All entries must be lowercase; the titler
 * lowercases input before lookup.
 */
export interface LanguagePack {
	/** Identifier used in config, e.g. `"en"`, `"de"`, `"pt-br"`. */
	readonly id: string;
	/** Human-readable name, shown in diagnostics. */
	readonly name: string;
	/**
	 * Stopwords. These delimit RAKE candidate phrases: a phrase never contains one.
	 * Include function words *and* conversational filler ("ok", "sounds", "perfect"),
	 * because phrases are ranked by how often they recur and filler recurs constantly.
	 */
	readonly stopwords: readonly string[];
	/**
	 * Verbs that describe an action but never a topic ("fix", "update", "run").
	 * They may appear in a title, but a phrase made *only* of them is penalised,
	 * and they never count towards the recurrence signal.
	 */
	readonly genericActions: readonly string[];
	/** Words left lowercase by title casing unless they lead the title. */
	readonly minorWords: readonly string[];
}

/** A pack with its lists turned into sets, ready for lookup. */
export interface CompiledLanguage {
	readonly id: string;
	readonly name: string;
	readonly stopwords: ReadonlySet<string>;
	readonly genericActions: ReadonlySet<string>;
	readonly minorWords: ReadonlySet<string>;
}

/** Turn a pack's arrays into lookup sets. The registry caches the result. */
export function compileLanguage(pack: LanguagePack): CompiledLanguage {
	return {
		id: pack.id,
		name: pack.name,
		stopwords: new Set(pack.stopwords),
		genericActions: new Set(pack.genericActions),
		minorWords: new Set(pack.minorWords),
	};
}
