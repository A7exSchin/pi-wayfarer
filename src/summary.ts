/**
 * On-demand summary of the highlighted session.
 *
 * Read-only: it never switches sessions. We summarize the session's stored
 * message text (`SessionInfo.allMessagesText`, already gathered by the picker),
 * so there is no need to re-open and walk the file.
 */

import type { ExtensionContext, SessionInfo } from "@earendil-works/pi-coding-agent";
import { BorderedLoader } from "@earendil-works/pi-coding-agent";
import { config } from "./config.ts";
import { resolveModel, runCompletion } from "./llm.ts";
import { showMarkdown } from "./markdown-view.ts";

const SYSTEM_PROMPT = `You summarize a coding assistant session so it can be recalled quickly.

Produce compact markdown:
- A one-line gist first.
- Then short bullet sections: what was done, key decisions, files touched, and any open threads / next steps.

Be concise and factual. Do not invent details that are not in the conversation. If a section has nothing, omit it.`;

/**
 * What the model call produced. Kept explicit because collapsing these into
 * `string | null` made every failure look identical — a cancelled call, an empty
 * response and a provider error all surfaced as one unreadable notification.
 */
type SummaryOutcome =
	| { kind: "ok"; text: string }
	| { kind: "empty" }
	| { kind: "aborted" }
	| { kind: "error"; message: string };

/** Generate and display a summary for the given session. */
export async function showSummary(ctx: ExtensionContext, session: SessionInfo): Promise<void> {
	const model = resolveModel(ctx, config.summaryModel ?? config.titleModel);
	if (!model) {
		ctx.ui.notify("No model available for summary", "error");
		return;
	}

	const raw = session.allMessagesText ?? "";
	const text = raw.length > config.summaryMaxChars ? raw.slice(-config.summaryMaxChars) : raw;
	if (!text.trim()) {
		ctx.ui.notify("Session has no content to summarize", "info");
		return;
	}

	const outcome = await ctx.ui.custom<SummaryOutcome>(
		(tui, theme, _keybindings, done) => {
			const loader = new BorderedLoader(tui, theme, `Summarizing with ${model.id}…`);
			loader.onAbort = () => done({ kind: "aborted" });
			runCompletion(ctx, model, SYSTEM_PROMPT, text, loader.signal)
				.then((result) => {
					if (result) return done({ kind: "ok", text: result });
					// runCompletion returns null both when aborted and when the model
					// produced nothing; the signal tells them apart.
					done(loader.signal.aborted ? { kind: "aborted" } : { kind: "empty" });
				})
				.catch((error: unknown) => {
					const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
					done({ kind: "error", message });
				});
			return loader;
		},
		{ overlay: true, overlayOptions: { anchor: "center", width: "60%", minWidth: 40 } },
	);

	switch (outcome.kind) {
		case "ok":
			await showMarkdown(ctx, session.name?.trim() || "Session summary", outcome.text);
			return;
		case "aborted":
			ctx.ui.notify("Summary cancelled", "info");
			return;
		case "empty":
			ctx.ui.notify(`${model.id} returned an empty summary`, "warning");
			return;
		default:
			// Shown in the overlay rather than a notification: an error you cannot
			// read is the reason this code exists.
			await showMarkdown(
				ctx,
				"Summary failed",
				[`The call to \`${model.provider}/${model.id}\` failed:`, "", "```", outcome.message, "```"].join("\n"),
			);
			return;
	}
}
