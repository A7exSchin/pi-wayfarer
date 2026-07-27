/**
 * Wayfarer configuration.
 *
 * Everything tunable lives here. Edit the values, then run `/reload` inside pi
 * (or restart) to apply. The in-panel keys (`summaryKey`, `scopeKey`) use pi's
 * keybinding string format (see docs/keybindings.md); single-character keys such
 * as "s" and "t" are matched literally.
 */

import type { KeyId } from "@earendil-works/pi-tui";
import { DEFAULT_LANGUAGE_ID, type LanguagePack } from "./lang/index.ts";

export type Scope = "folder" | "all";

export interface WayfarerConfig {
	/** Slash command that opens the panel. */
	commandName: string;
	/** Additional command names that behave identically (shorthands). */
	aliasNames: string[];

	// --- In-panel keys -------------------------------------------------------
	/** Inside the panel: summarize the highlighted session. */
	summaryKey: KeyId;
	/** Inside the panel: toggle between current-folder and all sessions. */
	scopeKey: KeyId;
	/** Inside the panel: move the highlighted session to the Wayfarer bin. */
	deleteKey: KeyId;
	/** Inside a summary / plan overlay: copy its contents to the clipboard. */
	copyKey: KeyId;

	// --- Panel ---------------------------------------------------------------
	/** Sessions whose `modified` is older than this many days get a stale badge. */
	staleDays: number;
	/** Initial listing scope when the panel opens. */
	defaultScope: Scope;

	// --- Purge ---------------------------------------------------------------
	/**
	 * `/wf purge` removes sessions older than this many days. Deliberately
	 * separate from `staleDays`: that one only drives a badge in the panel, and a
	 * visual hint makes a poor threshold for destroying data.
	 */
	purgeDays: number;
	/**
	 * How long the Wayfarer bin (`.wayfarer-trash/` inside the session directory)
	 * keeps a session before it is really deleted. Expired entries are pruned at
	 * the start of each purge run, through the `trash` CLI when available.
	 */
	purgeRetentionDays: number;
	/** `/wf purge --empty` treats sessions with at most this many messages as empty. */
	purgeMaxMessages: number;

	// --- Auto titles ---------------------------------------------------------
	/**
	 * How titles are generated:
	 * - "heuristic": deterministic, zero-cost (files touched + RAKE keyphrases).
	 * - "llm": always use the model (`titleModel`, or the current model).
	 * - "auto": heuristic first; fall back to the model only when the heuristic
	 *   result is weak (single generic keyword and no file signal).
	 */
	titleStrategy: "heuristic" | "llm" | "auto";
	/**
	 * Language used by the deterministic titler, as a registered pack id (`"en"`)
	 * or a `LanguagePack` object. Packs are plain word lists in `src/lang/`;
	 * register your own with `registerLanguage()` (see README, "Adding a language").
	 * An unknown id is reported once per session and titling falls back to English.
	 */
	language: string | LanguagePack;
	/**
	 * Confidence score at or above which the `auto` strategy trusts the heuristic
	 * and skips the model call. Higher = more model calls, better titles.
	 * Contributions: +1/+2 the phrase recurs across ≥3/≥6 distinct user messages,
	 * +2 the phrase names one of the files you touched, +1 clear margin over the
	 * runner-up phrase, -2 generic-action-only phrase, -2 very thin session.
	 * Measured over a 43-session corpus: threshold 1 → ~35% of sessions call the
	 * model, 2 → ~65%, 3 → ~91%. Run `npm run eval` against your own sessions.
	 */
	titleConfidenceThreshold: number;
	/**
	 * Model used to generate titles/summaries, as "provider/model-id"
	 * (e.g. "anthropic/claude-haiku-4-5"). Leave undefined to reuse the
	 * session's currently selected model. Only used for the "llm"/"auto" strategies.
	 */
	titleModel: string | undefined;
	/** Generate the first title once the branch has at least this many assistant turns. */
	titleFirstAtTurn: number;
	/** After the first title, regenerate every N additional assistant turns. */
	titleRefreshEveryTurns: number;
	/** Character budget of recent conversation text sent to the titling model. */
	titleMaxChars: number;
	/** Hard cap on the generated title length (characters). */
	maxTitleLength: number;

	// --- Summaries -----------------------------------------------------------
	/** Model for on-demand summaries. Falls back to `titleModel`, then current model. */
	summaryModel: string | undefined;
	/** Character budget of session text sent to the summary model. */
	summaryMaxChars: number;
}

export const config: WayfarerConfig = {
	commandName: "wayfarer",
	aliasNames: ["wf"],

	summaryKey: "s",
	scopeKey: "t",
	deleteKey: "d",
	copyKey: "c",

	staleDays: 7,
	defaultScope: "folder",

	purgeDays: 90,
	purgeRetentionDays: 30,
	purgeMaxMessages: 2,

	titleStrategy: "heuristic",
	language: DEFAULT_LANGUAGE_ID,
	titleConfidenceThreshold: 2,
	titleModel: undefined,
	titleFirstAtTurn: 2,
	titleRefreshEveryTurns: 3,
	titleMaxChars: 6000,
	maxTitleLength: 60,

	summaryModel: undefined,
	summaryMaxChars: 24000,
};
