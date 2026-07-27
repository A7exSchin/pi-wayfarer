/**
 * Content-derived session titles.
 *
 * On `agent_settled` (pi is done and won't auto-continue), we optionally
 * regenerate the session display name from the most recent conversation.
 *
 * Clobber protection: we never overwrite a name the user set with `/name`.
 * We remember our last auto-generated name (in memory and in a `custom` session
 * entry so it survives reload). If the current session name differs from our
 * last auto value, a human set it and we back off.
 */

import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { convertToLlm, serializeConversation } from "@earendil-works/pi-coding-agent";
import { config } from "./config.ts";
import { type CompiledLanguage, resolveLanguage } from "./lang/index.ts";
import { resolveModel, runCompletion } from "./llm.ts";
import { heuristicTitle } from "./title-heuristic.ts";

export const TITLE_MARKER = "wayfarer-title";

const SYSTEM_PROMPT = `You generate a short title for a coding assistant session.

Given recent conversation, output ONLY the title:
- 3 to 6 words
- Title Case
- describe the core task or topic
- no surrounding quotes, no trailing punctuation, no preamble

Output the title and nothing else.`;

interface TitleState {
	/** Assistant-turn count at which we last generated a title. */
	lastTitledAt: number;
	/** The title we last set. */
	autoName?: string;
	/** True once we detect a human-set name; disables auto-titling for the session. */
	userOverride: boolean;
	/** Guards against overlapping generations. */
	inFlight: boolean;
}

export interface TitleMarkerData {
	name: string;
	at: number;
}

const states = new Map<string, TitleState>();

function keyFor(ctx: ExtensionContext): string {
	return ctx.sessionManager.getSessionFile() ?? "ephemeral";
}

function getState(ctx: ExtensionContext): TitleState {
	const key = keyFor(ctx);
	let state = states.get(key);
	if (!state) {
		state = { lastTitledAt: 0, userOverride: false, inFlight: false };
		states.set(key, state);
	}
	return state;
}

export function assistantTurnCount(entries: SessionEntry[]): number {
	let count = 0;
	for (const entry of entries) {
		if (entry.type === "message" && entry.message.role === "assistant") count++;
	}
	return count;
}

function recentConversationText(entries: SessionEntry[], lastN: number): string {
	const messages = entries.filter((e) => e.type === "message").map((e) => e.message);
	const tail = messages.slice(-lastN);
	const llm = convertToLlm(tail as never);
	const text = serializeConversation(llm);
	// Keep the most recent characters within budget.
	return text.length > config.titleMaxChars ? text.slice(-config.titleMaxChars) : text;
}

/**
 * Rebuild in-memory state after a session start/reload by reading our marker
 * entry and comparing against the live session name.
 */
export function restoreTitleState(pi: ExtensionAPI, ctx: ExtensionContext): void {
	const state = getState(ctx);
	state.inFlight = false;
	reportLanguageProblem(ctx);

	let marker: TitleMarkerData | undefined;
	for (const entry of ctx.sessionManager.getEntries()) {
		if (entry.type === "custom" && entry.customType === TITLE_MARKER) {
			marker = entry.data as TitleMarkerData;
		}
	}

	if (marker) {
		state.autoName = marker.name;
		state.lastTitledAt = marker.at;
	}

	const currentName = pi.getSessionName();
	// A name that we did not generate means the user owns it.
	state.userOverride = Boolean(currentName && currentName !== state.autoName);
}

/** Called on `agent_settled`. Decides whether to (re)title and does so. */
export async function maybeGenerateTitle(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
	if (ctx.mode !== "tui") return;
	const state = getState(ctx);
	if (state.inFlight) return;

	// Respect a human-set name.
	const currentName = pi.getSessionName();
	if (currentName && currentName !== state.autoName) {
		state.userOverride = true;
	}
	if (state.userOverride) return;

	const entries = ctx.sessionManager.getBranch();
	const turns = assistantTurnCount(entries);
	if (turns < config.titleFirstAtTurn) return;

	const isFirst = !state.autoName;
	if (!isFirst && turns - state.lastTitledAt < config.titleRefreshEveryTurns) return;

	state.inFlight = true;
	try {
		const raw = await generateTitle(ctx, entries);
		if (!raw) return;
		const title = cleanTitle(raw);
		if (!title) return;

		pi.setSessionName(title);
		pi.appendEntry<TitleMarkerData>(TITLE_MARKER, { name: title, at: turns });
		state.autoName = title;
		state.lastTitledAt = turns;
		state.userOverride = false;
	} catch {
		// Titling is best-effort; never disrupt the session on failure.
	} finally {
		state.inFlight = false;
	}
}

/**
 * Retitle the current session on demand, ignoring the turn-count throttle.
 * Honours a human-set name unless `force` is set.
 */
export async function retitleCurrent(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	force: boolean,
): Promise<{ ok: true; title: string } | { ok: false; reason: string }> {
	const state = getState(ctx);
	if (state.inFlight) return { ok: false, reason: "a title is already being generated" };

	const currentName = pi.getSessionName();
	if (currentName && currentName !== state.autoName && !force) {
		state.userOverride = true;
		return { ok: false, reason: `"${currentName}" was set by hand — use --force to replace it` };
	}

	const entries = ctx.sessionManager.getBranch();
	state.inFlight = true;
	try {
		const raw = await generateTitle(ctx, entries);
		const title = raw ? cleanTitle(raw) : "";
		if (!title) return { ok: false, reason: "not enough content to derive a title" };

		const turns = assistantTurnCount(entries);
		pi.setSessionName(title);
		pi.appendEntry<TitleMarkerData>(TITLE_MARKER, { name: title, at: turns });
		state.autoName = title;
		state.lastTitledAt = turns;
		state.userOverride = false;
		return { ok: true, title };
	} catch (error) {
		return { ok: false, reason: error instanceof Error ? error.message : String(error) };
	} finally {
		state.inFlight = false;
	}
}

/** Produce a title according to the configured strategy. Exported for batch retitling. */
export async function generateTitle(ctx: ExtensionContext, entries: SessionEntry[]): Promise<string | null> {
	switch (config.titleStrategy) {
		case "heuristic":
			return heuristic(entries).title || null;
		case "auto": {
			const { title, confident } = heuristic(entries);
			if (confident && title) return title;
			return (await llmTitle(ctx, entries)) ?? (title || null);
		}
		default: // "llm": fall back to the heuristic when no model is available.
			return (await llmTitle(ctx, entries)) ?? (heuristic(entries).title || null);
	}
}

/** Run the deterministic titler with the configured caps, threshold and language. */
export function heuristic(entries: SessionEntry[]) {
	return heuristicTitle(entries, {
		maxLen: config.maxTitleLength,
		confidenceThreshold: config.titleConfidenceThreshold,
		language: language(),
	});
}

/**
 * Resolve `config.language` once per process. An unknown id is a configuration
 * error: we surface it (see `reportLanguageProblem`) and use English meanwhile,
 * rather than dropping titles silently.
 */
let cachedLanguage: CompiledLanguage | undefined;
let languageError: string | undefined;

function language(): CompiledLanguage {
	if (cachedLanguage) return cachedLanguage;
	try {
		cachedLanguage = resolveLanguage(config.language);
	} catch (error) {
		languageError = error instanceof Error ? error.message : String(error);
		cachedLanguage = resolveLanguage(undefined); // English
	}
	return cachedLanguage;
}

/**
 * Show a misconfigured `language` once per session. Called from `session_start`,
 * where `ctx.ui` is available in TUI and RPC modes.
 */
function reportLanguageProblem(ctx: ExtensionContext): void {
	language(); // populates languageError on failure
	if (!languageError || !ctx.hasUI) return;
	ctx.ui.notify(`Wayfarer: ${languageError} — using English.`, "warning");
	languageError = undefined; // report once
}

/** Generate a title with the model, or null if no model / no content / aborted. */
async function llmTitle(ctx: ExtensionContext, entries: SessionEntry[]): Promise<string | null> {
	const model = resolveModel(ctx, config.titleModel);
	if (!model) return null;

	const conversation = recentConversationText(entries, 12);
	if (!conversation.trim()) return null;

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 30_000);
	try {
		return await runCompletion(ctx, model, SYSTEM_PROMPT, conversation, controller.signal);
	} finally {
		clearTimeout(timeout);
	}
}

export function cleanTitle(raw: string): string {
	let title = raw.split("\n")[0]?.trim() ?? "";
	// Strip wrapping quotes/backticks a model might add despite instructions.
	title = title.replace(/^["'`]+|["'`]+$/g, "").trim();
	// Drop trailing punctuation.
	title = title.replace(/[.,;:]+$/, "").trim();
	if (title.length > config.maxTitleLength) {
		title = `${title.slice(0, config.maxTitleLength - 1).trimEnd()}…`;
	}
	return title;
}
