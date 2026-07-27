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

	const summary = await ctx.ui.custom<string | null>(
		(tui, theme, _keybindings, done) => {
			const loader = new BorderedLoader(tui, theme, `Summarizing with ${model.id}…`);
			loader.onAbort = () => done(null);
			runCompletion(ctx, model, SYSTEM_PROMPT, text, loader.signal)
				.then(done)
				.catch(() => done(null));
			return loader;
		},
		{ overlay: true, overlayOptions: { anchor: "center", width: "60%", minWidth: 40 } },
	);

	if (!summary) {
		ctx.ui.notify("Summary cancelled or failed", "info");
		return;
	}

	const title = session.name?.trim() || "Session summary";
	await showMarkdown(ctx, title, summary);
}
