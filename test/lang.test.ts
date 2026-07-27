/**
 * Tests for the language layer: the registry contract third parties rely on, and
 * the guarantee that no language-specific word list leaks back into the titler.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { english } from "../src/lang/en.ts";
import {
	compileLanguage,
	DEFAULT_LANGUAGE_ID,
	type LanguagePack,
	languageIds,
	registerLanguage,
	resolveLanguage,
} from "../src/lang/index.ts";
import { heuristicTitle } from "../src/title-heuristic.ts";

function user(text: string): SessionEntry {
	return { type: "message", message: { role: "user", content: [{ type: "text", text }] } } as unknown as SessionEntry;
}

/** A minimal German pack — exactly what a third party would have to write. */
const german: LanguagePack = {
	id: "de",
	name: "Deutsch",
	stopwords: [
		"aber", "als", "am", "auch", "auf", "aus", "bei", "bitte", "das", "dass", "dem", "den", "der",
		"des", "die", "doch", "ein", "eine", "einen", "einer", "eines", "er", "es", "f\u00fcr", "gut",
		"hat", "ich", "ihr", "im", "in", "ist", "ja", "kann", "mal", "mit", "nicht", "noch", "nur",
		"oder", "sie", "sind", "so", "und", "von", "war", "was", "wenn", "wie", "wir", "zu", "zum",
		"jetzt", "danke", "okay", "passt", "genau",
	],
	genericActions: ["mach", "mache", "machen", "\u00e4ndere", "\u00e4ndern", "pr\u00fcfe", "pr\u00fcfen", "zeige", "zeigen"],
	minorWords: ["der", "die", "das", "und", "oder", "von", "zu", "im", "in", "auf", "mit", "f\u00fcr"],
};

describe("language registry", () => {
	it("ships English as the default", () => {
		assert.equal(DEFAULT_LANGUAGE_ID, "en");
		assert.ok(languageIds().includes("en"));
		assert.equal(resolveLanguage(undefined).id, "en");
	});

	it("compiles word lists into lookup sets", () => {
		const compiled = compileLanguage(english);
		assert.ok(compiled.stopwords.has("the"));
		assert.ok(compiled.genericActions.has("update"));
		assert.ok(compiled.minorWords.has("of"));
		assert.equal(compiled.stopwords.has("panel"), false);
	});

	it("throws on an unknown id instead of silently using English", () => {
		assert.throws(() => resolveLanguage("xx"), /Unknown language "xx"/);
	});

	it("normalises ids so casing and padding do not matter", () => {
		assert.equal(resolveLanguage("  EN ").id, "en");
	});

	it("accepts a pack object without registering it", () => {
		const compiled = resolveLanguage(german);
		assert.equal(compiled.id, "de");
		assert.equal(languageIds().includes("de"), false);
	});

	it("lets a third party register a pack and select it by id", () => {
		registerLanguage(german);
		assert.ok(languageIds().includes("de"));
		assert.equal(resolveLanguage("de").name, "Deutsch");
	});
});

describe("titler with a non-default language", () => {
	const messages = [
		user("Bitte pr\u00fcfe die Zertifikatsrotation im Cluster"),
		user("die Zertifikatsrotation schl\u00e4gt beim Neustart fehl"),
		user("jetzt noch bitte eine Notiz dazu, danke"),
	];

	it("uses the pack's stopwords to delimit phrases", () => {
		const withGerman = heuristicTitle(messages, { maxLen: 60, language: german });
		// "jetzt noch bitte eine" is filler that only a German stoplist removes.
		assert.ok(!/Jetzt Noch Bitte/i.test(withGerman.title), withGerman.title);
		assert.match(withGerman.title, /Zertifikatsrotation/i);
	});

	it("differs from the English default on the same input", () => {
		const withEnglish = heuristicTitle(messages, { maxLen: 60 });
		const withGerman = heuristicTitle(messages, { maxLen: 60, language: german });
		assert.notEqual(withEnglish.title, withGerman.title);
	});

	it("accepts a registered id as well as a pack object", () => {
		registerLanguage(german);
		assert.equal(
			heuristicTitle(messages, { maxLen: 60, language: "de" }).title,
			heuristicTitle(messages, { maxLen: 60, language: german }).title,
		);
	});

	it("applies the pack's minor words when title-casing", () => {
		// A minor word only ever reaches the title if it is *not* also a stopword —
		// stopwords delimit phrases, so they can never appear inside one.
		const text = [user("Sicherung mittels Snapshot im Cluster")];
		const minor: LanguagePack = { ...german, minorWords: ["mittels"] };
		const none: LanguagePack = { ...german, minorWords: [] };
		assert.match(heuristicTitle(text, { maxLen: 60, language: minor }).title, /Sicherung mittels Snapshot/);
		assert.match(heuristicTitle(text, { maxLen: 60, language: none }).title, /Sicherung Mittels Snapshot/);
	});

	it("throws for an unknown id passed through options", () => {
		assert.throws(() => heuristicTitle(messages, { maxLen: 60, language: "zz" }), /Unknown language/);
	});
});
