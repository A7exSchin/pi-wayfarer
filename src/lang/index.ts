/**
 * Language registry.
 *
 * Built-in packs are registered here. Third parties add a language by importing
 * `registerLanguage` from this module and calling it once at load time (from
 * their own extension, or from a fork's `src/index.ts`), then setting
 * `config.language` to the pack's id. `config.language` also accepts a
 * `LanguagePack` object directly, which skips the registry entirely.
 */

import { english } from "./en.ts";
import { type CompiledLanguage, compileLanguage, type LanguagePack } from "./types.ts";

export { compileLanguage } from "./types.ts";
export type { CompiledLanguage, LanguagePack } from "./types.ts";

/** Id used when `config.language` is unset. */
export const DEFAULT_LANGUAGE_ID = english.id;

const packs = new Map<string, LanguagePack>();
const compiled = new Map<string, CompiledLanguage>();

/**
 * Register a language pack, replacing any pack with the same id.
 * Call before the first title is generated; the compiled cache is invalidated
 * for that id, so re-registering during `/reload` is safe.
 */
export function registerLanguage(pack: LanguagePack): void {
	const id = normalizeId(pack.id);
	packs.set(id, { ...pack, id });
	compiled.delete(id);
}

/** Ids of all registered packs, for diagnostics and error messages. */
export function languageIds(): string[] {
	return [...packs.keys()].sort();
}

/**
 * Resolve `config.language` to lookup sets.
 *
 * Throws on an unknown id rather than silently falling back: a typo in the
 * config should be visible, not quietly produce English titles.
 */
export function resolveLanguage(language: string | LanguagePack | undefined): CompiledLanguage {
	if (language && typeof language !== "string") return compileLanguage(language);

	const id = normalizeId(language ?? DEFAULT_LANGUAGE_ID);
	const cached = compiled.get(id);
	if (cached) return cached;

	const pack = packs.get(id);
	if (!pack) {
		throw new Error(`Unknown language "${id}". Registered: ${languageIds().join(", ") || "(none)"}`);
	}

	const result = compileLanguage(pack);
	compiled.set(id, result);
	return result;
}

function normalizeId(id: string): string {
	return id.trim().toLowerCase();
}

registerLanguage(english);
