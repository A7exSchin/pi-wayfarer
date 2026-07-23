/**
 * Wayfarer configuration.
 *
 * Everything tunable lives here. Edit the values, then run `/reload` inside pi
 * (or restart) to apply. Keys use pi's keybinding string format
 * (see docs/keybindings.md): `ctrl`, `shift`, `alt` modifiers + a key, e.g.
 * "ctrl+shift+w". Single-character panel keys ("s", "t") are matched literally.
 */

import type { KeyId } from "@earendil-works/pi-tui";

export type Scope = "folder" | "all";

export interface WayfarerConfig {
	/** Slash command that opens the panel. The toggle shortcut invokes this. */
	commandName: string;

	// --- Shortcuts -----------------------------------------------------------
	/** Global key that toggles the session overlay open. */
	toggleKey: KeyId;
	/** Inside the panel: summarize the highlighted session. */
	summaryKey: KeyId;
	/** Inside the panel: toggle between current-folder and all sessions. */
	scopeKey: KeyId;

	// --- Panel ---------------------------------------------------------------
	/** Sessions whose `modified` is older than this many days get a stale badge. */
	staleDays: number;
	/** Initial listing scope when the panel opens. */
	defaultScope: Scope;

	// --- Auto titles ---------------------------------------------------------
	/**
	 * Model used to generate titles/summaries, as "provider/model-id"
	 * (e.g. "anthropic/claude-haiku-4-5"). Leave undefined to reuse the
	 * session's currently selected model.
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

	toggleKey: "ctrl+shift+w",
	summaryKey: "s",
	scopeKey: "t",

	staleDays: 7,
	defaultScope: "folder",

	titleModel: undefined,
	titleFirstAtTurn: 2,
	titleRefreshEveryTurns: 3,
	titleMaxChars: 6000,
	maxTitleLength: 60,

	summaryModel: undefined,
	summaryMaxChars: 24000,
};
