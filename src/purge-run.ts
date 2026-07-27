/**
 * `/wf purge` and `/wf restore` — the pi-facing half.
 *
 * Purging moves sessions into the Wayfarer bin (see `bin.ts`); nothing is
 * destroyed until an entry outlives `purgeRetentionDays`, or unless
 * `--permanent` is given. Every run shows the plan before touching anything.
 */

import type { ExtensionCommandContext, SessionInfo } from "@earendil-works/pi-coding-agent";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { type BinEntry, deleteFile, moveToBin, pruneBin, readBin, restoreFromBin, sizeOf } from "./bin.ts";
import { config } from "./config.ts";
import { showMarkdown } from "./markdown-view.ts";
import { ageInDays, buildPurgePlan, formatBytes, type PurgeArgs, type PurgePlan, renderPurgePlan } from "./purge.ts";
import { listSessions } from "./sessions.ts";
import { TITLE_MARKER, type TitleMarkerData } from "./titles.ts";

/**
 * True when the session's current name is the one Wayfarer wrote. Such a name
 * records no human intent, so it does not protect the session from purging.
 * Sessions without a name never reach this check.
 */
function isAutoNamed(session: SessionInfo): boolean {
	const name = session.name?.trim();
	if (!name) return false;

	try {
		let marker: TitleMarkerData | undefined;
		for (const entry of SessionManager.open(session.path).getEntries()) {
			if (entry.type === "custom" && entry.customType === TITLE_MARKER) {
				marker = entry.data as TitleMarkerData;
			}
		}
		return marker?.name === name;
	} catch {
		// Unreadable: treat the name as human, i.e. protect it.
		return false;
	}
}

/** Session directories involved in a purge, used to prune and to list bins. */
function sessionDirsFor(ctx: ExtensionCommandContext, sessions: SessionInfo[]): string[] {
	const dirs = new Set<string>([ctx.sessionManager.getSessionDir()]);
	for (const session of sessions) {
		const slash = Math.max(session.path.lastIndexOf("/"), session.path.lastIndexOf("\\"));
		if (slash > 0) dirs.add(session.path.slice(0, slash));
	}
	return [...dirs];
}

/** Move one session to the bin (or delete it) and report the outcome. */
function removeOne(session: SessionInfo, permanent: boolean): { ok: boolean; detail: string } {
	try {
		if (permanent) {
			const result = deleteFile(session.path);
			return result.ok
				? { ok: true, detail: result.method === "trash" ? "moved to OS trash" : "deleted" }
				: { ok: false, detail: result.error };
		}
		moveToBin(session.path, session.name?.trim() || undefined);
		return { ok: true, detail: "moved to the Wayfarer bin" };
	} catch (error) {
		return { ok: false, detail: error instanceof Error ? error.message : String(error) };
	}
}

/** Entry point for `/wf purge …`. */
export async function runPurge(ctx: ExtensionCommandContext, args: PurgeArgs): Promise<void> {
	ctx.ui.setStatus("wayfarer", "Scanning sessions…");
	let plan: PurgePlan;
	let sessions: SessionInfo[];
	try {
		sessions = await listSessions(ctx, args.global ? "all" : "folder");

		// Expire old bin entries first, so the bin cannot grow without bound.
		let pruned = 0;
		for (const dir of sessionDirsFor(ctx, sessions)) {
			pruned += pruneBin(dir, config.purgeRetentionDays).deleted;
		}
		if (pruned > 0) ctx.ui.notify(`Bin: deleted ${pruned} expired session(s)`, "info");

		plan = buildPurgePlan(sessions, {
			args,
			activePath: ctx.sessionManager.getSessionFile(),
			maxMessages: config.purgeMaxMessages,
			sizeOf,
			isAutoNamed,
		});
	} finally {
		ctx.ui.setStatus("wayfarer", undefined);
	}

	if (plan.items.length === 0) {
		const kept = [...plan.skipped.entries()].map(([reason, count]) => `${count} ${reason}`).join(", ");
		ctx.ui.notify(`Nothing to purge${kept ? ` (${kept})` : ""}`, "info");
		return;
	}

	await showMarkdown(ctx, args.dryRun ? "Purge plan (dry run)" : "Purge plan", renderPurgePlan(plan, { args }));
	if (args.dryRun) return;

	const confirmed = await ctx.ui.confirm(
		args.permanent ? "Delete sessions permanently" : "Purge sessions",
		args.permanent
			? `Permanently delete ${plan.items.length} session(s)? This cannot be undone.`
			: `Move ${plan.items.length} session(s) to the Wayfarer bin? Restore with /${config.commandName} restore.`,
	);
	if (!confirmed) {
		ctx.ui.notify("Purge cancelled", "info");
		return;
	}

	const byPath = new Map(sessions.map((session) => [session.path, session]));
	let removed = 0;
	let failed = 0;
	for (const item of plan.items) {
		const session = byPath.get(item.path);
		if (!session) {
			failed++;
			continue;
		}
		if (removeOne(session, args.permanent).ok) removed++;
		else failed++;
	}

	const verb = args.permanent ? "Deleted" : "Binned";
	ctx.ui.notify(`${verb} ${removed} session(s)${failed ? `, ${failed} failed` : ""}`, failed ? "warning" : "info");
}

/** Bin one session from the panel, after confirming. Returns true if it was removed. */
export async function purgeOne(ctx: ExtensionCommandContext, session: SessionInfo): Promise<boolean> {
	if (session.path === ctx.sessionManager.getSessionFile()) {
		ctx.ui.notify("Cannot bin the session you are in", "warning");
		return false;
	}

	const label = session.name?.trim() || "(unnamed)";
	const age = ageInDays(session.modified, Date.now());
	const confirmed = await ctx.ui.confirm(
		"Bin session",
		`${label} — ${age}d old, ${session.messageCount} msg, ${formatBytes(sizeOf(session.path))}. ` +
			`Restore with /${config.commandName} restore.`,
	);
	if (!confirmed) return false;

	const result = removeOne(session, false);
	ctx.ui.notify(result.ok ? `Binned "${label}"` : `Could not bin session: ${result.detail}`, result.ok ? "info" : "error");
	return result.ok;
}

/** Entry point for `/wf restore`. */
export async function runRestore(ctx: ExtensionCommandContext): Promise<void> {
	const sessions = await listSessions(ctx, "folder");
	const entries: BinEntry[] = [];
	for (const dir of sessionDirsFor(ctx, sessions)) {
		entries.push(...readBin(dir).filter((entry) => entry.present));
	}

	if (entries.length === 0) {
		ctx.ui.notify("The Wayfarer bin is empty", "info");
		return;
	}

	const now = Date.now();
	const labels = entries.map((entry) => {
		const name = entry.name ?? "(unnamed)";
		const age = ageInDays(new Date(entry.deletedAt), now);
		return `${name} — binned ${age}d ago`;
	});

	const choice = await ctx.ui.select("Restore session", labels);
	if (!choice) return;

	const entry = entries[labels.indexOf(choice)];
	if (!entry) return;

	const result = restoreFromBin(entry);
	ctx.ui.notify(
		result.ok ? `Restored "${entry.name ?? "session"}"` : `Could not restore: ${result.error}`,
		result.ok ? "info" : "error",
	);
}
