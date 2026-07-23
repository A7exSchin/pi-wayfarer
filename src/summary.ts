/**
 * On-demand summary of the highlighted session.
 *
 * Read-only: it never switches sessions. We summarize the session's stored
 * message text (`SessionInfo.allMessagesText`, already gathered by the picker),
 * so there is no need to re-open and walk the file.
 */

import type { ExtensionContext, SessionInfo } from "@earendil-works/pi-coding-agent";
import { BorderedLoader, getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Key, type MarkdownTheme, Markdown, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import { config } from "./config.ts";
import { resolveModel, runCompletion } from "./llm.ts";

const SYSTEM_PROMPT = `You summarize a coding assistant session so it can be recalled quickly.

Produce compact markdown:
- A one-line gist first.
- Then short bullet sections: what was done, key decisions, files touched, and any open threads / next steps.

Be concise and factual. Do not invent details that are not in the conversation. If a section has nothing, omit it.`;

interface ViewTheme {
	fg(color: string, text: string): string;
	bold(text: string): string;
}

const VIEWPORT = 20;

class SummaryView {
	private offset = 0;
	private cache?: { width: number; lines: string[] };
	private readonly md: Markdown;

	onClose?: () => void;

	constructor(
		private readonly theme: ViewTheme,
		mdTheme: MarkdownTheme,
		private readonly title: string,
		text: string,
	) {
		this.md = new Markdown(text, 1, 0, mdTheme);
	}

	private bodyLines(width: number): string[] {
		if (!this.cache || this.cache.width !== width) {
			this.cache = { width, lines: this.md.render(Math.max(4, width)) };
		}
		return this.cache.lines;
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.up)) {
			if (this.offset > 0) this.offset--;
		} else if (matchesKey(data, Key.down)) {
			this.offset++;
		} else if (matchesKey(data, Key.pageUp)) {
			this.offset = Math.max(0, this.offset - VIEWPORT);
		} else if (matchesKey(data, Key.pageDown)) {
			this.offset += VIEWPORT;
		} else if (matchesKey(data, Key.escape) || matchesKey(data, Key.enter) || data === "q") {
			this.onClose?.();
		}
	}

	private rule(width: number): string {
		return this.theme.fg("border", "─".repeat(width));
	}

	render(width: number): string[] {
		const t = this.theme;
		const body = this.bodyLines(width);
		const viewport = Math.min(VIEWPORT, body.length);
		const maxOffset = Math.max(0, body.length - viewport);
		if (this.offset > maxOffset) this.offset = maxOffset;

		const lines: string[] = [];
		lines.push(this.rule(width));
		lines.push(truncateToWidth(t.fg("accent", t.bold(this.title)), width));
		lines.push(this.rule(width));

		const slice = body.slice(this.offset, this.offset + viewport);
		for (const line of slice) lines.push(truncateToWidth(line, width));

		lines.push(this.rule(width));
		const scrollable = body.length > viewport;
		const help = scrollable ? "↑↓ scroll · esc / q close" : "esc / q close";
		lines.push(truncateToWidth(t.fg("dim", help), width));
		lines.push(this.rule(width));
		return lines;
	}

	invalidate(): void {
		this.cache = undefined;
		this.md.invalidate();
	}
}

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
	await ctx.ui.custom<void>(
		(tui, theme, _keybindings, done) => {
			const view = new SummaryView(theme as unknown as ViewTheme, getMarkdownTheme(), title, summary);
			view.onClose = () => done();
			return {
				render: (width) => view.render(width),
				handleInput: (data) => {
					view.handleInput(data);
					tui.requestRender();
				},
				invalidate: () => view.invalidate(),
			};
		},
		{ overlay: true, overlayOptions: { anchor: "center", width: "70%", minWidth: 44, maxHeight: "85%" } },
	);
}
