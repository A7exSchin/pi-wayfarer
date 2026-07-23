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
import { resolveModel, runCompletion } from "./llm.ts";

const TITLE_MARKER = "wayfarer-title";

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

interface TitleMarkerData {
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

function assistantTurnCount(entries: SessionEntry[]): number {
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

	const model = resolveModel(ctx, config.titleModel);
	if (!model) return;

	const conversation = recentConversationText(entries, 12);
	if (!conversation.trim()) return;

	state.inFlight = true;
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 30_000);
	try {
		const raw = await runCompletion(ctx, model, SYSTEM_PROMPT, conversation, controller.signal);
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
		clearTimeout(timeout);
		state.inFlight = false;
	}
}

function cleanTitle(raw: string): string {
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
