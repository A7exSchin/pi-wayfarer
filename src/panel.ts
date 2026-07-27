/**
 * The session overlay: a left-anchored panel listing sessions for the current
 * folder (or all folders), with staleness badges derived from `modified`.
 *
 * pi's TUI is single-column, so this is a toggleable overlay rendered on top of
 * the transcript, not a persistent split dock.
 *
 * Keys: up/down navigate, Enter switch, `s` summarize, `t` toggle scope,
 * Esc / toggle-key close.
 */

import type { ExtensionCommandContext, SessionInfo } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { config, type Scope } from "./config.ts";
import { keyHit } from "./keys.ts";
import { listSessions } from "./sessions.ts";

export type PanelResult =
	| { type: "switch"; session: SessionInfo }
	| { type: "summarize"; session: SessionInfo; index: number; scope: Scope }
	| { type: "delete"; session: SessionInfo; index: number; scope: Scope }
	| { type: "close" };

interface OpenPanelOptions {
	initialIndex: number;
	scope: Scope;
}

// Minimal theme surface we rely on from the injected TUI theme.
interface PanelTheme {
	fg(color: string, text: string): string;
	bold(text: string): string;
}

async function loadSessions(ctx: ExtensionCommandContext, scope: Scope): Promise<SessionInfo[]> {
	return await listSessions(ctx, scope);
}

// SGR color/style escape sequences.
const ANSI_PATTERN = /\u001b\[[0-9;]*m/g;

function stripAnsi(text: string): string {
	return text.replace(ANSI_PATTERN, "");
}

function relTime(date: Date): string {
	const minutes = Math.floor((Date.now() - date.getTime()) / 60_000);
	if (minutes < 1) return "now";
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h`;
	const days = Math.floor(hours / 24);
	if (days < 7) return `${days}d`;
	const weeks = Math.floor(days / 7);
	if (weeks < 5) return `${weeks}w`;
	return `${Math.floor(days / 30)}mo`;
}

function isStale(date: Date): boolean {
	return (Date.now() - date.getTime()) / 86_400_000 > config.staleDays;
}

function displayName(session: SessionInfo): string {
	if (session.name?.trim()) return session.name.trim();
	const first = session.firstMessage?.split("\n")[0]?.trim();
	return first && first.length > 0 ? first : "(untitled)";
}

const DEFAULT_TERM_HEIGHT = 24;
// Border rules + header + help line + scroll counter that frame the list.
const PANEL_CHROME_ROWS = 7;
// Fraction of the terminal height the panel should occupy (matches maxHeight).
const HEIGHT_FRACTION = 0.75;
const MIN_VIEWPORT = 5;

class SessionPanel {
	selected: number;
	private scope: Scope;
	private loading = false;
	private termHeight = DEFAULT_TERM_HEIGHT;

	onSwitch?: (session: SessionInfo) => void;
	onSummarize?: (session: SessionInfo, index: number) => void;
	onDelete?: (session: SessionInfo, index: number) => void;
	onToggleScope?: () => void;
	onClose?: () => void;

	constructor(
		private readonly theme: PanelTheme,
		private sessions: SessionInfo[],
		private readonly currentFile: string | undefined,
		initialIndex: number,
		scope: Scope,
	) {
		this.scope = scope;
		this.selected = Math.min(Math.max(0, initialIndex), Math.max(0, sessions.length - 1));
	}

	setSessions(sessions: SessionInfo[]): void {
		this.sessions = sessions;
		this.selected = Math.min(this.selected, Math.max(0, sessions.length - 1));
		this.loading = false;
	}

	setScope(scope: Scope): void {
		this.scope = scope;
	}

	setLoading(loading: boolean): void {
		this.loading = loading;
	}

	/** Fed from the overlay's `visible` callback so the list can fill the height. */
	setTermHeight(height: number): void {
		if (height > 0) this.termHeight = height;
	}

	private viewportRows(): number {
		const target = Math.floor(this.termHeight * HEIGHT_FRACTION) - PANEL_CHROME_ROWS;
		return Math.max(MIN_VIEWPORT, target);
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.up)) {
			if (this.selected > 0) this.selected--;
		} else if (matchesKey(data, Key.down)) {
			if (this.selected < this.sessions.length - 1) this.selected++;
		} else if (matchesKey(data, Key.enter)) {
			const s = this.sessions[this.selected];
			if (s) this.onSwitch?.(s);
		} else if (keyHit(data, config.summaryKey)) {
			const s = this.sessions[this.selected];
			if (s) this.onSummarize?.(s, this.selected);
		} else if (keyHit(data, config.deleteKey)) {
			const s = this.sessions[this.selected];
			if (s) this.onDelete?.(s, this.selected);
		} else if (keyHit(data, config.scopeKey)) {
			this.onToggleScope?.();
		} else if (matchesKey(data, Key.escape)) {
			this.onClose?.();
		}
	}

	private rule(width: number): string {
		return this.theme.fg("border", "─".repeat(width));
	}

	render(width: number): string[] {
		const t = this.theme;
		const lines: string[] = [];
		lines.push(this.rule(width));

		const scopeLabel = this.scope === "folder" ? "this folder" : "all folders";
		const header = `Wayfarer · ${scopeLabel} · ${this.sessions.length} session${this.sessions.length === 1 ? "" : "s"}`;
		lines.push(truncateToWidth(t.fg("accent", t.bold(header)), width));
		lines.push(this.rule(width));

		if (this.loading) {
			lines.push(truncateToWidth(t.fg("muted", "  loading…"), width));
		} else if (this.sessions.length === 0) {
			lines.push(truncateToWidth(t.fg("muted", "  no sessions found"), width));
		} else {
			const viewport = this.viewportRows();
			const start = Math.min(
				Math.max(0, this.selected - Math.floor(viewport / 2)),
				Math.max(0, this.sessions.length - viewport),
			);
			const end = Math.min(this.sessions.length, start + viewport);
			for (let i = start; i < end; i++) {
				lines.push(this.renderRow(i, width));
			}
			if (this.sessions.length > viewport) {
				lines.push(truncateToWidth(t.fg("dim", `  ${this.selected + 1}/${this.sessions.length}`), width));
			}
		}

		lines.push(this.rule(width));
		const scopeHint = this.scope === "folder" ? "all" : "folder";
		const help = `↑↓ move · ⏎ switch · ${config.summaryKey} summary · ${config.deleteKey} bin · ${config.scopeKey} ${scopeHint} · esc close`;
		lines.push(truncateToWidth(t.fg("dim", help), width));
		lines.push(this.rule(width));
		return lines;
	}

	private renderRow(index: number, width: number): string {
		const t = this.theme;
		const session = this.sessions[index]!;
		const isCurrent = this.currentFile !== undefined && session.path === this.currentFile;
		const selected = index === this.selected;
		const stale = isStale(session.modified);

		const cursor = selected ? "❯ " : "  ";
		const marker = isCurrent ? "● " : "";
		const meta = `  ${relTime(session.modified)} · ${session.messageCount}m${stale ? " · stale" : ""}`;

		// Reserve space for the meta column, name fills the rest.
		const metaWidth = visibleWidth(meta);
		const nameBudget = Math.max(4, width - cursor.length - marker.length - metaWidth);
		// truncateToWidth embeds SGR resets around the ellipsis; strip them so the
		// single fg() wrap below colors the whole row. Otherwise the reset ends the
		// row color early and the trailing meta renders in the default (white).
		const name = stripAnsi(truncateToWidth(displayName(session), nameBudget, "…"));

		const rawName = `${cursor}${marker}${name}`;
		const pad = Math.max(0, width - visibleWidth(rawName) - metaWidth);
		const rawLine = `${rawName}${" ".repeat(pad)}${meta}`;

		let colored: string;
		if (selected) {
			colored = t.fg("accent", rawLine);
		} else if (stale) {
			colored = t.fg("dim", rawLine);
		} else if (isCurrent) {
			colored = t.fg("success", rawLine);
		} else {
			colored = t.fg("text", rawLine);
		}
		return truncateToWidth(colored, width);
	}

	invalidate(): void {
		// Stateless render (theme callbacks applied per frame); nothing to clear.
	}
}

/** Open the overlay and resolve with the user's action. */
export async function openPanel(ctx: ExtensionCommandContext, opts: OpenPanelOptions): Promise<PanelResult> {
	let scope = opts.scope;
	const sessions = await loadSessions(ctx, scope);
	const currentFile = ctx.sessionManager.getSessionFile();

	let panelRef: SessionPanel | undefined;

	return ctx.ui.custom<PanelResult>(
		(tui, theme, _keybindings, done) => {
			const panel = new SessionPanel(theme as unknown as PanelTheme, sessions, currentFile, opts.initialIndex, scope);
			panelRef = panel;
			panel.onSwitch = (session) => done({ type: "switch", session });
			panel.onSummarize = (session, index) => done({ type: "summarize", session, index, scope });
			panel.onDelete = (session, index) => done({ type: "delete", session, index, scope });
			panel.onClose = () => done({ type: "close" });
			panel.onToggleScope = () => {
				scope = scope === "folder" ? "all" : "folder";
				panel.setLoading(true);
				tui.requestRender();
				loadSessions(ctx, scope)
					.then((next) => {
						panel.setScope(scope);
						panel.setSessions(next);
						tui.requestRender();
					})
					.catch(() => {
						panel.setLoading(false);
						tui.requestRender();
					});
			};

			return {
				render: (width) => panel.render(width),
				handleInput: (data) => {
					panel.handleInput(data);
					tui.requestRender();
				},
				invalidate: () => panel.invalidate(),
			};
		},
		{
			overlay: true,
			overlayOptions: {
				anchor: "top-left",
				width: "50%",
				minWidth: 34,
				maxHeight: "75%",
				visible: (_termWidth, termHeight) => {
					panelRef?.setTermHeight(termHeight);
					return true;
				},
			},
		},
	);
}
