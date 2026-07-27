/**
 * `/wf retitle` — the pi-facing half: reading sessions, showing the plan, and
 * writing names.
 *
 * Writes go through the public `SessionManager.open()` / `appendSessionInfo()`
 * API rather than touching `.jsonl` files directly. Two managers must never
 * point at one file, so the session pi currently has open is always skipped, as
 * are sessions touched in the last few minutes — those may belong to another
 * running pi instance.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { showMarkdown } from "./markdown-view.ts";
import { buildPlan, type Plan, type RetitleArgs, renderPlan, type Titler } from "./retitle.ts";
import { listSessions } from "./sessions.ts";
import { cleanTitle, generateTitle, heuristic, retitleCurrent, TITLE_MARKER, type TitleMarkerData } from "./titles.ts";

/** Read a stored session's active branch. */
function loadBranch(path: string) {
	return SessionManager.open(path).getBranch();
}

/** Write the plan. Returns how many sessions were renamed and how many failed. */
export function applyPlan(plan: Plan): { renamed: number; failed: number } {
	let renamed = 0;
	let failed = 0;

	for (const item of plan.items) {
		try {
			const manager = SessionManager.open(item.path);
			manager.appendSessionInfo(item.title);
			// Record the same marker live titling writes, so a later session knows
			// this name is ours and may refresh it instead of backing off.
			manager.appendCustomEntry(TITLE_MARKER, { name: item.title, at: item.turns } satisfies TitleMarkerData);
			renamed++;
		} catch {
			failed++;
		}
	}

	return { renamed, failed };
}

/** Entry point for `/wf retitle …`. */
export async function runRetitle(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	args: RetitleArgs,
): Promise<void> {
	if (args.mode === "current") {
		if (args.dryRun) {
			// Preview through the configured strategy, so what is shown is what a real
			// run would write — including a model call when titleStrategy says so.
			const raw = await generateTitle(ctx, ctx.sessionManager.getBranch());
			const title = raw ? cleanTitle(raw) : "";
			ctx.ui.notify(
				title ? `Would rename to "${title}"` : "Not enough content to derive a title",
				"info",
			);
			return;
		}
		const result = await retitleCurrent(pi, ctx, args.force);
		if (result.ok) ctx.ui.notify(`Renamed to "${result.title}"`, "info");
		else ctx.ui.notify(`Not retitled: ${result.reason}`, "info");
		return;
	}

	// Default titler is free and deterministic; --llm opts into one model call
	// per candidate session, which is why it is not the default for a batch.
	const titler: Titler = args.llm
		? async (entries) => {
				const raw = await generateTitle(ctx, entries);
				return raw ? cleanTitle(raw) : null;
			}
		: (entries) => cleanTitle(heuristic(entries).title);

	ctx.ui.setStatus("wayfarer", "Scanning sessions…");
	let plan: Plan;
	try {
		const sessions = await listSessions(ctx, args.global ? "all" : "folder");
		plan = await buildPlan(sessions, {
			activePath: ctx.sessionManager.getSessionFile(),
			force: args.force,
			loadBranch,
			titler,
			onProgress: (done, total) => ctx.ui.setStatus("wayfarer", `Titling sessions … ${done}/${total}`),
		});
	} finally {
		ctx.ui.setStatus("wayfarer", undefined);
	}

	if (plan.items.length === 0) {
		const skipped = [...plan.skipped.entries()].map(([reason, count]) => `${count} ${reason}`).join(", ");
		ctx.ui.notify(`Nothing to retitle${skipped ? ` (${skipped})` : ""}`, "info");
		return;
	}

	await showMarkdown(ctx, args.dryRun ? "Retitle plan (dry run)" : "Retitle plan", renderPlan(plan, args));
	if (args.dryRun) return;

	const confirmed = await ctx.ui.confirm(
		"Retitle sessions",
		`Rename ${plan.items.length} session(s)? This cannot be undone.`,
	);
	if (!confirmed) {
		ctx.ui.notify("Retitle cancelled", "info");
		return;
	}

	const { renamed, failed } = applyPlan(plan);
	ctx.ui.notify(`Renamed ${renamed} session(s)${failed ? `, ${failed} failed` : ""}`, failed ? "warning" : "info");
}
