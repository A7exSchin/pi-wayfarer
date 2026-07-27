/**
 * Unit tests for the deterministic titler.
 *
 * Run with `npm test` (Node's built-in runner; TypeScript is stripped at load,
 * so no build step and no dev dependencies are required).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { heuristicTitle } from "../src/title-heuristic.ts";

const MAX_LEN = 60;

/** A user message entry. */
function user(text: string): SessionEntry {
	return { type: "message", message: { role: "user", content: [{ type: "text", text }] } } as unknown as SessionEntry;
}

/** An assistant entry containing tool calls, as `[toolName, path]` pairs. */
function tools(...calls: [string, string][]): SessionEntry {
	return {
		type: "message",
		message: {
			role: "assistant",
			content: calls.map(([name, path]) => ({ type: "toolCall", name, arguments: { path } })),
		},
	} as unknown as SessionEntry;
}

function title(entries: SessionEntry[], confidenceThreshold?: number) {
	return heuristicTitle(entries, { maxLen: MAX_LEN, confidenceThreshold });
}

describe("tokenizer", () => {
	it("does not absorb sentence-final punctuation into a token", () => {
		assert.equal(title([user("Fix the panel overlay.")]).title, "Panel Overlay");
	});

	it("keeps dotted file names intact", () => {
		// The ranking between the two equally scored phrases is not the point here;
		// the point is that `package.json` survives as one token.
		assert.match(title([user("rename package.json in the release workflow")]).title, /Package\.json/);
		assert.match(title([user("bump package.json version")]).title, /Package\.json/);
	});

	it("does not let a phrase straddle a sentence boundary", () => {
		assert.equal(title([user("Fix the panel overlay. Update config.ts for me.")]).title, "Panel Overlay");
	});

	it("does not let a phrase straddle a message boundary", () => {
		assert.equal(title([user("Fix the panel overlay"), user("Now add tests")]).title, "Panel Overlay");
	});

	it("treats line breaks as phrase delimiters", () => {
		assert.equal(title([user("fix the bug\nadd tests")]).title, "Add Tests");
	});

	it("keeps contractions whole so the stoplist matches them", () => {
		assert.equal(title([user("auto-titling doesn't work in headless mode")]).title, "Auto Titling");
		assert.equal(title([user("auto-titling doesn\u2019t work in headless mode")]).title, "Auto Titling");
	});

	it("keeps possessives readable", () => {
		assert.equal(title([user("normalise the user's session name")]).title, "User's Session Name");
	});

	it("breaks phrases at brackets and slashes", () => {
		assert.equal(title([user("check panel.ts (overlay) / summary.ts rendering")]).title, "Check Panel.ts");
	});

	it("keeps accented and non-ASCII letters inside tokens", () => {
		// An ASCII-only token class produced "Lschlich Als Schreibzugriff Erkannt"
		// from a real session: the "ä" split the word and the fragment ranked as a word.
		assert.equal(
			title([user("fälschlich als Schreibzugriff erkannt")]).title,
			"Fälschlich Als Schreibzugriff Erkannt",
		);
		assert.match(title([user("the café naïve résumé parser")]).title, /Café Naïve Résumé/);
	});

	it("handles non-Latin scripts without emitting fragments", () => {
		const result = title([user("Проверить конфигурацию сервера")]);
		assert.match(result.title, /Проверить Конфигурацию Сервера/);
	});
});

describe("title composition", () => {
	it("appends the dominant file", () => {
		const result = title([
			user("Rewrite the title heuristic so RAKE splits at punctuation"),
			tools(["edit", "src/title-heuristic.ts"], ["read", "src/config.ts"]),
		]);
		assert.equal(result.title, "Title Heuristic \u2014 title-heuristic.ts");
	});

	it("weights writes above reads when picking the dominant file", () => {
		const result = title([user("refactor the session panel"), tools(["read", "a.ts"], ["write", "panel.ts"])]);
		assert.match(result.title, /panel\.ts$/);
	});

	it("falls back to file names when there is no user language", () => {
		const result = title([user("/wf"), tools(["write", "src/panel.ts"], ["read", "README.md"])]);
		assert.equal(result.title, "Editing panel.ts, README.md");
		assert.equal(result.confident, false, "file-only titles must never suppress the LLM fallback");
	});

	it("lowercases minor words that are not stopwords", () => {
		// "via" carries enough meaning to stay in a phrase but should not be capitalised.
		const result = title([user("issue the certificate via a dns challenge")]);
		assert.match(result.title, /via/);
		assert.ok(!/Via/.test(result.title), result.title);
	});

	it("clamps to the length cap", () => {
		const long = "implement deterministic hierarchical keyphrase extraction pipeline";
		const result = heuristicTitle([user(long)], { maxLen: 20 });
		assert.ok(result.title.length <= 20, result.title);
		assert.ok(result.title.endsWith("\u2026"));
	});

	it("returns an empty title for an empty branch", () => {
		const result = title([]);
		assert.equal(result.title, "");
		assert.equal(result.confident, false);
		assert.deepEqual(result.reasons, ["no-signal"]);
	});
});

describe("ranking", () => {
	it("prefers the recurring topic over a higher-scoring one-off phrase", () => {
		// RAKE's raw score is a sum over words, so "skip generic verbs" (three rare
		// words, mentioned once) outranks "heuristic" (mentioned three times) unless
		// the ranking is length-damped and recurrence-weighted.
		const result = title([
			user("Rewrite the title heuristic so RAKE splits at punctuation boundaries"),
			tools(["edit", "src/title-heuristic.ts"]),
			user("the heuristic should also skip generic verbs when scoring"),
			user("does the heuristic still handle contractions correctly"),
		]);
		assert.equal(result.title, "Title Heuristic — title-heuristic.ts");
		assert.equal(result.confident, true, result.reasons.join(","));
	});

	it("drops hex identifiers so they cannot become the title", () => {
		const result = title([
			user("container 66cd5b598c keeps restarting"),
			user("the container restarting is blocking the rollout"),
		]);
		assert.ok(!/66cd5b598c/i.test(result.title), result.title);
	});

	it("keeps ordinary words that happen to be spelled with hex letters", () => {
		const result = title([user("the facade decade problem in the parser module")]);
		assert.match(result.title, /Facade Decade/);
	});

	it("drops snake_case identifiers pasted from code or logs", () => {
		const result = title([
			user("routes.mcp_routes add_server fails when exposing affine"),
			user("exposing affine towards the llms is the goal"),
		]);
		assert.ok(!/add_server|mcp_routes/i.test(result.title), result.title);
		assert.match(result.title, /Affine/i);
	});

	it("does not let conversational filler become the topic", () => {
		const result = title([
			user("add a token estimator package"),
			user("sounds good"),
			user("yes that sounds good, go ahead"),
			user("perfect, sounds good to me"),
		]);
		assert.ok(!/sounds|good|ahead/i.test(result.title), result.title);
		assert.match(result.title, /Token Estimator/i);
	});
});

describe("confidence scoring", () => {
	it("rewards recurrence across distinct messages", () => {
		const recurring = title([
			user("the session panel renders the wrong colour for stale rows"),
			user("the panel should also show the folder scope"),
			user("make the panel overlay wider"),
			user("panel selection must survive a reload"),
		]);
		assert.ok(
			recurring.reasons.some((r) => r.startsWith("recurrence:")),
			recurring.reasons.join(","),
		);

		// Same volume of text, but nothing repeats: no recurrence credit.
		const scattered = title([
			user("the session panel renders the wrong colour for stale rows"),
			user("document the release workflow in the readme"),
			user("summaries should wrap at eighty columns"),
			user("bump the peer dependency range"),
		]);
		assert.ok(
			!scattered.reasons.some((r) => r.startsWith("recurrence:")),
			scattered.reasons.join(","),
		);
		assert.ok(recurring.score > scattered.score, `${recurring.score} !> ${scattered.score}`);
	});

	it("rewards agreement between the phrase and a file that was touched", () => {
		const result = title([
			user("the session panel renders stale rows in the wrong colour"),
			tools(["edit", "src/panel.ts"]),
			user("the session panel should show the folder scope too"),
		]);
		assert.equal(result.title, "Session Panel — panel.ts");
		assert.ok(
			result.reasons.some((r) => r.startsWith("file-overlap:")),
			result.reasons.join(","),
		);
		assert.equal(result.confident, true);
	});

	it("stays unconfident when nothing corroborates the phrase", () => {
		// Enough text to clear the volume floor, but the phrase recurs nowhere and
		// has nothing to do with the file that was touched.
		const result = title([
			user("could you take a quick look at whatever seems odd around here today"),
			tools(["read", "src/panel.ts"]),
		]);
		assert.equal(result.confident, false, `${result.title} :: ${result.reasons.join(",")}`);
	});


	it("corroborates against any of the most-touched files, not just the top one", () => {
		const result = title([
			user("the summary rendering drops the last line"),
			user("summary output should wrap at the panel width"),
			tools(["write", "src/panel.ts"], ["write", "src/panel.ts"], ["edit", "src/summary.ts"]),
		]);
		assert.ok(
			result.reasons.some((r) => r === "file-overlap:summary"),
			result.reasons.join(","),
		);
	});

	it("does not reward phrase length (a RAKE artefact, not evidence)", () => {
		const result = title([user("deterministic hierarchical keyphrase extraction pipeline design")]);
		assert.ok(
			!result.reasons.some((r) => r.startsWith("words:")),
			result.reasons.join(","),
		);
	});

	it("does not treat a mere file touch as evidence (the old bug)", () => {
		// Long enough to clear the volume floor, but the phrase has nothing to do
		// with the file and recurs nowhere.
		const result = title([
			user("could you take a quick look at whatever seems odd around here today please"),
			tools(["read", "src/panel.ts"]),
		]);
		assert.equal(result.confident, false, `${result.title} :: ${result.reasons.join(",")}`);
	});

	it("penalises very thin sessions", () => {
		const result = title([user("fix titles")]);
		assert.ok(
			result.reasons.some((r) => r.startsWith("-thin:")),
			result.reasons.join(","),
		);
		assert.equal(result.confident, false);
	});

	it("penalises phrases made only of generic action words", () => {
		const result = title([
			user("please update"),
			user("now run it again and check"),
			user("update again"),
			user("update once more and check it"),
		]);
		assert.ok(result.reasons.includes("-generic-only"), `${result.title} :: ${result.reasons.join(",")}`);
		assert.equal(result.confident, false);
	});

	it("ignores generic words when measuring recurrence", () => {
		const generic = title([user("update the thing"), user("update again"), user("update once more")]);
		assert.ok(
			!generic.reasons.some((r) => r.startsWith("recurrence:")),
			generic.reasons.join(","),
		);
	});

	it("exposes the threshold", () => {
		const entries = [user("fix titles")];
		assert.equal(title(entries, 99).confident, false);
		assert.equal(title(entries, -99).confident, true);
	});

	it("reports a numeric score and reasons for every result", () => {
		const result = title([user("wire the summary panel into the session manager")]);
		assert.equal(typeof result.score, "number");
		assert.ok(Array.isArray(result.reasons) && result.reasons.length > 0);
	});
});
