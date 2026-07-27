/**
 * Scrollable markdown overlay.
 *
 * Extracted from the summary view so anything with markdown to show — summaries,
 * the retitle plan — renders identically instead of growing its own component.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { copyToClipboard, getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Key, type MarkdownTheme, Markdown, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import { config } from "./config.ts";
import { keyHit } from "./keys.ts";

interface ViewTheme {
	fg(color: string, text: string): string;
	bold(text: string): string;
}

const VIEWPORT = 20;

class MarkdownView {
	private offset = 0;
	private cache?: { width: number; lines: string[] };
	private readonly md: Markdown;
	/** Transient footer message, e.g. the result of a copy. Cleared on the next key. */
	private notice?: string;

	onClose?: () => void;
	/** Fired on the copy key; the caller owns the clipboard and the re-render. */
	onCopy?: () => void;

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
		const hadNotice = this.notice !== undefined;
		this.notice = undefined;

		if (matchesKey(data, Key.up)) {
			if (this.offset > 0) this.offset--;
		} else if (matchesKey(data, Key.down)) {
			this.offset++;
		} else if (matchesKey(data, Key.pageUp)) {
			this.offset = Math.max(0, this.offset - VIEWPORT);
		} else if (matchesKey(data, Key.pageDown)) {
			this.offset += VIEWPORT;
		} else if (keyHit(data, config.copyKey)) {
			this.onCopy?.();
		} else if (matchesKey(data, Key.escape) || matchesKey(data, Key.enter) || data === "q") {
			// A notice is dismissed first, so the key that clears it does not also close.
			if (!hadNotice) this.onClose?.();
		}
	}

	/** Show a transient line in the footer (copy result, errors). */
	setNotice(notice: string): void {
		this.notice = notice;
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
		const help =
			this.notice ??
			`${scrollable ? "↑↓ scroll · " : ""}${config.copyKey} copy · esc / q close`;
		lines.push(truncateToWidth(t.fg(this.notice ? "accent" : "dim", help), width));
		lines.push(this.rule(width));
		return lines;
	}

	invalidate(): void {
		this.cache = undefined;
		this.md.invalidate();
	}
}

/** Show markdown in a centred overlay. Resolves when the user closes it. */
export async function showMarkdown(ctx: ExtensionContext, title: string, text: string): Promise<void> {
	await ctx.ui.custom<void>(
		(tui, theme, _keybindings, done) => {
			const view = new MarkdownView(theme as unknown as ViewTheme, getMarkdownTheme(), title, text);
			view.onClose = () => done();
			view.onCopy = () => {
				// Copies the source markdown, not the rendered lines: what lands in the
				// clipboard should be pasteable, not wrapped and ANSI-coloured.
				copyToClipboard(text)
					.then(() => view.setNotice(`Copied ${text.length} characters to the clipboard`))
					.catch((error: unknown) => {
						view.setNotice(`Copy failed: ${error instanceof Error ? error.message : String(error)}`);
					})
					.finally(() => tui.requestRender());
			};
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
