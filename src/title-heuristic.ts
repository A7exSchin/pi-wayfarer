/**
 * Deterministic, zero-cost title generation.
 *
 * Two free signals already live in the session:
 *  - Files touched, from `write` / `edit` / `read` tool calls (basename, weighted).
 *  - Keyphrases from the user's messages, via RAKE (Rapid Automatic Keyword
 *    Extraction, Rose et al. 2010) — a stopword/degree-frequency method that needs
 *    no model and no dependencies.
 *
 * We compose a title from the top keyphrase (enriched with the dominant file when
 * present), and report a confidence *score* so the `auto` strategy knows when it is
 * worth falling back to the LLM. The score is additive and every contribution is
 * reported in `reasons`, so the decision (which controls spend in `auto` mode) is
 * auditable.
 */

import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { type CompiledLanguage, type LanguagePack, resolveLanguage } from "./lang/index.ts";

/**
 * A token is a run of word characters that may contain *internal* dots and
 * apostrophes, so `config.ts` and `doesn't` survive intact while a
 * sentence-final `overlay.` does not swallow its period. Underscores and `+`/`#`
 * stay word-internal (`snake_case`, `c++`, `c#`).
 *
 * Unicode-aware on purpose: an ASCII-only class silently split accented words
 * mid-token (`fälschlich` → `lschlich`, `café` → `caf`), and the fragments then
 * ranked as if they were words.
 */
const TOKEN_RE = /[\p{L}\p{N}+#_]+(?:['.][\p{L}\p{N}+#_]+)*/gu;

/**
 * Characters allowed between two tokens without ending a candidate phrase:
 * spaces/tabs plus the hyphen joiner (`auto-titling`). Anything else —
 * punctuation, brackets, dashes, slashes, newlines — is a phrase delimiter, as
 * in canonical RAKE.
 */
const PHRASE_GLUE_RE = /^[ \t\-]*$/;

const WRITE_TOOLS = new Set(["write", "edit"]);
const READ_TOOLS = new Set(["read"]);

/** `score >= threshold` ⇒ skip the LLM in `auto` mode. Overridable via config. */
export const DEFAULT_CONFIDENCE_THRESHOLD = 2;

/** Below this many content tokens across all user messages, the session is too thin to title well. */
const MIN_CONTENT_TOKENS = 12;

/** How far the top phrase must outscore the runner-up to count as an unambiguous pick. */
const MARGIN_RATIO = 1.5;

/** How many of the most-touched files the phrase may corroborate against. */
const FILE_OVERLAP_CANDIDATES = 3;

/**
 * Ranking correction for RAKE's structural biases.
 *
 * RAKE scores a phrase as the *sum* of its word scores, so score grows with
 * phrase length and rare words outrank repeated ones. Measured over a 43-session
 * corpus, the top phrase was of maximal length in 40 of them. We therefore rank by
 *
 *   rank = rakeScore / len^LENGTH_DAMPING * (1 + log2(recurrence))
 *
 * where `recurrence` is the number of distinct user messages mentioning the
 * phrase's best-supported content word. Length damping neutralises the sum bias;
 * the recurrence factor promotes what the user actually kept talking about.
 * Both exponents were chosen by sweeping them against real sessions — see
 * `test/evaluate-sessions.ts`.
 */
const LENGTH_DAMPING = 0.5;
const RECURRENCE_WEIGHT = 1;

/** Longest candidate phrase we will consider (RAKE favours long, rare phrases). */
const MAX_PHRASE_WORDS = 4;

export interface HeuristicResult {
	title: string;
	/** True when `score >= threshold`. */
	confident: boolean;
	/** Additive confidence score; see `confidenceScore()`. */
	score: number;
	/** Human-readable contributions, e.g. `["words:2", "file-overlap:heuristic", "-thin:7"]`. */
	reasons: string[];
}

interface ScoredPhrase {
	/** The phrase as a display string. */
	key: string;
	tokens: string[];
	/** Raw RAKE score: sum of degree/frequency word scores. */
	rakeScore: number;
	/** Distinct user messages mentioning the phrase's best-supported content word. */
	recurrence: number;
	/** Ranking score: `rakeScore`, length-damped and recurrence-weighted. */
	rank: number;
}

interface RakeResult {
	/** Unique phrases, best first. */
	ranked: ScoredPhrase[];
	/** Token → indices of the user messages it occurs in (recurrence signal). */
	tokenMessages: Map<string, Set<number>>;
	/** Total number of content tokens across all messages (volume signal). */
	contentTokens: number;
}

function basename(path: string): string {
	const parts = path.split(/[\\/]/);
	return parts[parts.length - 1] || path;
}

/** Rank file basenames touched by tool calls; writes/edits weigh more than reads. */
function collectFiles(entries: SessionEntry[]): string[] {
	const scores = new Map<string, number>();
	for (const entry of entries) {
		if (entry.type !== "message" || entry.message.role !== "assistant") continue;
		const content = entry.message.content;
		if (!Array.isArray(content)) continue;
		for (const block of content) {
			if (block.type !== "toolCall") continue;
			const weight = WRITE_TOOLS.has(block.name) ? 3 : READ_TOOLS.has(block.name) ? 1 : 0;
			if (weight === 0) continue;
			const path = (block.arguments as { path?: unknown })?.path;
			if (typeof path !== "string" || path.length === 0) continue;
			const name = basename(path);
			scores.set(name, (scores.get(name) ?? 0) + weight);
		}
	}
	return [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
}

/**
 * User-authored message texts, one entry per message. Kept separate (rather than
 * concatenated) because recurrence across *distinct* messages is a confidence signal.
 */
function userMessages(entries: SessionEntry[]): string[] {
	const parts: string[] = [];
	for (const entry of entries) {
		if (entry.type !== "message" || entry.message.role !== "user") continue;
		const content = entry.message.content;
		const text =
			typeof content === "string"
				? content
				: content
						.filter((c): c is { type: "text"; text: string } => c.type === "text")
						.map((c) => c.text)
						.join(" ");
		const trimmed = text.trim();
		if (!trimmed || trimmed.startsWith("/")) continue; // skip slash commands
		parts.push(trimmed);
	}
	return parts;
}

/**
 * Hex-looking identifiers (UUID fragments, container IDs, hashes). They are not
 * words, they never recur meaningfully, and they produced titles like
 * "6f1bd239 7a26 4b48 870f" on real sessions. A digit is required so ordinary
 * words made of hex letters ("decade", "facade") survive.
 */
const HEX_ID_RE = /^(?=.*\d)[0-9a-f]{6,}$/;

/** True for tokens that cannot carry meaning and therefore break a phrase. */
function isBreakingToken(token: string, lang: CompiledLanguage): boolean {
	return (
		lang.stopwords.has(token) ||
		token.length < 2 ||
		/^\p{N}+$/u.test(token) ||
		!/[\p{L}\p{N}]/u.test(token) ||
		HEX_ID_RE.test(token) ||
		// snake_case identifiers come from pasted code and logs, not from the user
		// describing the task. Dotted names (config.ts) are kept: those are prose.
		token.includes("_")
	);
}

/**
 * Split text into RAKE candidate phrases: maximal runs of content words bounded
 * by stopwords *and* by punctuation/line breaks, so a phrase never straddles a
 * sentence or message boundary.
 */
function candidatePhrases(text: string, lang: CompiledLanguage): string[][] {
	const lower = text.toLowerCase().replace(/\u2019/g, "'"); // normalise curly apostrophes
	const phrases: string[][] = [];
	let current: string[] = [];
	let cursor = 0;

	const flush = (): void => {
		if (current.length > 0) {
			phrases.push(current);
			current = [];
		}
	};

	for (const match of lower.matchAll(TOKEN_RE)) {
		const token = match[0];
		const start = match.index ?? cursor;
		if (!PHRASE_GLUE_RE.test(lower.slice(cursor, start))) flush();
		cursor = start + token.length;
		if (isBreakingToken(token, lang)) flush();
		else current.push(token);
	}
	flush();

	return phrases;
}

/**
 * RAKE keyphrase extraction over the user messages, plus the auxiliary signals
 * (per-token message coverage, total content volume) used for confidence.
 */
function rake(messages: string[], lang: CompiledLanguage): RakeResult {
	const phrases: string[][] = [];
	const tokenMessages = new Map<string, Set<number>>();
	let contentTokens = 0;

	messages.forEach((text, index) => {
		for (const phrase of candidatePhrases(text, lang)) {
			phrases.push(phrase);
			contentTokens += phrase.length;
			for (const token of phrase) {
				let seen = tokenMessages.get(token);
				if (!seen) {
					seen = new Set();
					tokenMessages.set(token, seen);
				}
				seen.add(index);
			}
		}
	});

	const freq = new Map<string, number>();
	const degree = new Map<string, number>();
	for (const phrase of phrases) {
		const extra = phrase.length - 1;
		for (const word of phrase) {
			freq.set(word, (freq.get(word) ?? 0) + 1);
			degree.set(word, (degree.get(word) ?? 0) + extra + 1);
		}
	}
	const wordScore = (word: string): number => (degree.get(word) ?? 0) / (freq.get(word) ?? 1);

	const scored = new Map<string, ScoredPhrase>();
	for (const phrase of phrases) {
		if (phrase.length > MAX_PHRASE_WORDS) continue; // keep titles short
		const key = phrase.join(" ");
		if (scored.has(key)) continue;

		const rakeScore = phrase.reduce((sum, word) => sum + wordScore(word), 0);
		// Generic verbs are excluded: "update" recurring five times says nothing.
		const recurrence = Math.max(
			1,
			...phrase
				.filter((token) => !lang.genericActions.has(token))
				.map((token) => tokenMessages.get(token)?.size ?? 0),
		);
		const rank =
			(rakeScore / phrase.length ** LENGTH_DAMPING) * (1 + RECURRENCE_WEIGHT * Math.log2(recurrence));
		scored.set(key, { key, tokens: phrase, rakeScore, recurrence, rank });
	}

	const ranked = [...scored.values()].sort((a, b) => b.rank - a.rank);
	return { ranked, tokenMessages, contentTokens };
}

/** Split a file name into comparable stems: drop the extension, split on `-`/`_`/`.`. */
function stems(name: string): string[] {
	return name
		.toLowerCase()
		.replace(/\.[\p{L}\p{N}]+$/u, "")
		.split(/[-_.]+/)
		.filter((part) => part.length >= 3);
}

/**
 * Cross-signal corroboration: does a word of the phrase also name one of the
 * dominant files? Two independently derived signals agreeing is the strongest
 * evidence we have. Returns the matching stem, or undefined.
 */
function fileOverlap(tokens: string[], files: string[]): string | undefined {
	const target = new Set(files.flatMap(stems));
	for (const token of tokens) {
		for (const stem of stems(token)) {
			if (target.has(stem)) return stem;
			// Tolerate inflection ("heuristics" vs "heuristic") without a stemmer.
			if (stem.length >= 4 && [...target].some((t) => t.length >= 4 && (t.startsWith(stem) || stem.startsWith(t)))) {
				return stem;
			}
		}
	}
	return undefined;
}

/**
 * Additive confidence score. Positive terms are evidence that the phrase really
 * is the session topic; negative terms are evidence that a model would do better.
 */
function confidenceScore(
	rakeResult: RakeResult,
	files: string[],
	lang: CompiledLanguage,
): { score: number; reasons: string[] } {
	const [top, runnerUp] = rakeResult.ranked;
	if (!top) return { score: 0, reasons: ["no-keyphrase"] };

	let score = 0;
	const reasons: string[] = [];

	// NB: phrase length is deliberately *not* rewarded. Measured over 43 real
	// sessions, the top phrase was of maximal length in 40 of them — a structural
	// artefact of RAKE (phrase score is a sum over words), not evidence of topicality.

	// Recurrence: how many distinct user messages mention the phrase's best-supported
	// content word. Note that ranking already maximises this, so the bar is set high:
	// measured on a 43-session corpus the top phrase recurs at all in 29 of 43, but
	// only 21 reach 3 and 8 reach 6.
	const recurrence = top.recurrence;
	if (recurrence >= 6) {
		score += 2;
		reasons.push(`recurrence:${recurrence}`);
	} else if (recurrence >= 3) {
		score += 1;
		reasons.push(`recurrence:${recurrence}`);
	}

	const overlap = fileOverlap(top.tokens, files.slice(0, FILE_OVERLAP_CANDIDATES));
	if (overlap) {
		score += 2;
		reasons.push(`file-overlap:${overlap}`);
	}

	const margin = runnerUp && runnerUp.rank > 0 ? top.rank / runnerUp.rank : Number.POSITIVE_INFINITY;
	if (margin >= MARGIN_RATIO) {
		score += 1;
		reasons.push(`margin:${Number.isFinite(margin) ? margin.toFixed(2) : "sole"}`);
	}

	if (top.tokens.every((token) => lang.genericActions.has(token))) {
		score -= 2;
		reasons.push("-generic-only");
	}

	if (rakeResult.contentTokens < MIN_CONTENT_TOKENS) {
		score -= 2;
		reasons.push(`-thin:${rakeResult.contentTokens}`);
	}

	return { score, reasons };
}

function titleCase(text: string, lang: CompiledLanguage): string {
	return text
		.split(/\s+/)
		.map((word, i) =>
			i > 0 && lang.minorWords.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1),
		)
		.join(" ");
}

function firstUserLine(entries: SessionEntry[]): string {
	for (const entry of entries) {
		if (entry.type !== "message" || entry.message.role !== "user") continue;
		const content = entry.message.content;
		const text =
			typeof content === "string"
				? content
				: content
						.filter((c): c is { type: "text"; text: string } => c.type === "text")
						.map((c) => c.text)
						.join(" ");
		const line = text
			.split("\n")
			.map((l) => l.trim())
			.find((l) => l.length > 0 && !l.startsWith("/"));
		if (line) return line;
	}
	return "";
}

function clamp(text: string, maxLen: number): string {
	const trimmed = text.trim();
	return trimmed.length > maxLen ? `${trimmed.slice(0, maxLen - 1).trimEnd()}…` : trimmed;
}

/** Inputs for {@link heuristicTitle}. Everything is optional except the length cap. */
export interface HeuristicOptions {
	/** Hard cap on the returned title, including the appended file name. */
	maxLen: number;
	/** `score >= threshold` ⇒ `confident`. Defaults to {@link DEFAULT_CONFIDENCE_THRESHOLD}. */
	confidenceThreshold?: number;
	/**
	 * Language pack id (registered via `registerLanguage`), a pack object, or an
	 * already-compiled language. Defaults to English. Throws on an unknown id.
	 */
	language?: string | LanguagePack | CompiledLanguage;
}

/**
 * Build a deterministic title from the branch. `confident` is true when the
 * evidence is strong enough to skip the LLM in `auto` mode.
 */
export function heuristicTitle(entries: SessionEntry[], options: HeuristicOptions): HeuristicResult {
	const { maxLen, confidenceThreshold = DEFAULT_CONFIDENCE_THRESHOLD } = options;
	const lang = asCompiled(options.language);

	const files = collectFiles(entries);
	const rakeResult = rake(userMessages(entries), lang);
	const top = rakeResult.ranked[0];

	// No usable user language: fall back to file names or the first prompt line.
	// Both are weak by construction — a model reading the assistant side would do
	// better — so these are never confident.
	if (!top) {
		const title = files.length > 0 ? `Editing ${files.slice(0, 2).join(", ")}` : firstUserLine(entries);
		const reason = files.length > 0 ? "no-user-language" : "no-signal";
		return { title: clamp(title, maxLen), confident: false, score: 0, reasons: [reason] };
	}

	let title = titleCase(top.key, lang);
	if (files[0]) title = `${title} — ${files[0]}`;

	const { score, reasons } = confidenceScore(rakeResult, files, lang);
	return { title: clamp(title, maxLen), confident: score >= confidenceThreshold, score, reasons };
}

/** Accept a language id, a raw pack, or an already-compiled language. */
function asCompiled(language: HeuristicOptions["language"]): CompiledLanguage {
	if (language && typeof language !== "string" && language.stopwords instanceof Set) {
		return language as CompiledLanguage;
	}
	return resolveLanguage(language as string | LanguagePack | undefined);
}
