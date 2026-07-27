/**
 * `/wf retitle` — planning logic.
 *
 * Deliberately free of runtime imports from pi: session loading and writing are
 * injected by `retitle-run.ts`. That keeps the decision of *what* would be
 * renamed testable without a pi installation, and keeps this module honest about
 * being pure.
 */

import type { SessionEntry, SessionInfo } from "@earendil-works/pi-coding-agent";

/** Sessions modified within this window may be open elsewhere; leave them alone. */
const RECENT_WINDOW_MS = 5 * 60 * 1000;

/** How many proposed titles to show before truncating the plan. */
const PLAN_PREVIEW = 40;

export interface RetitleArgs {
	/** `current` = this session, `batch` = stored sessions. */
	mode: "current" | "batch";
	/** Batch only: every project instead of the current folder. */
	global: boolean;
	/** Replace names that were set by hand. */
	force: boolean;
	/** Show the plan, write nothing. */
	dryRun: boolean;
	/** Batch only: use the configured title strategy (may cost model calls). */
	llm: boolean;
}

export type ParseResult = { ok: true; args: RetitleArgs } | { ok: false; error: string };

/**
 * Parse the argument string of `/wf`. Returns `undefined` when this is not a
 * retitle invocation, so the caller can fall through to opening the panel.
 */
export function parseRetitleArgs(raw: string): ParseResult | undefined {
	const tokens = raw.trim().split(/\s+/).filter(Boolean);
	if (tokens.length === 0 || tokens[0] !== "retitle") return undefined;

	const args: RetitleArgs = { mode: "current", global: false, force: false, dryRun: false, llm: false };

	for (const token of tokens.slice(1)) {
		switch (token) {
			case "all":
				args.mode = "batch";
				break;
			case "--global":
			case "-g":
				args.global = true;
				break;
			case "--force":
			case "-f":
				args.force = true;
				break;
			case "--dry-run":
			case "-n":
				args.dryRun = true;
				break;
			case "--llm":
				args.llm = true;
				break;
			default:
				return { ok: false, error: `Unknown option "${token}"` };
		}
	}

	if (args.mode === "current" && args.global) {
		return { ok: false, error: "--global only applies to `retitle all`" };
	}
	if (args.mode === "current" && args.llm) {
		return { ok: false, error: "--llm only applies to `retitle all`; single retitles use titleStrategy" };
	}

	return { ok: true, args };
}

export interface PlanItem {
	path: string;
	/** Name the session has today, if any. */
	current?: string;
	/** Name we would write. */
	title: string;
	/** Assistant turns at the time of titling, recorded in the marker. */
	turns: number;
}

export interface Plan {
	items: PlanItem[];
	/** Why sessions were left out, keyed by reason. */
	skipped: Map<string, number>;
}

function skip(plan: Plan, reason: string): void {
	plan.skipped.set(reason, (plan.skipped.get(reason) ?? 0) + 1);
}

/**
 * Produces the title for one session's entries. Injected so the batch can run
 * the free heuristic by default and the configured strategy under `--llm`,
 * without this module knowing about models.
 */
export type Titler = (entries: SessionEntry[]) => string | null | Promise<string | null>;

export interface PlanOptions {
	/** Session pi currently has open; never touched. */
	activePath?: string;
	/** Replace names set by hand. */
	force: boolean;
	/** Injectable clock, for tests. */
	now?: number;
	/** Produces the title for a session's entries. */
	titler: Titler;
	/** Reads a session file and returns its active branch. */
	loadBranch: (path: string) => SessionEntry[];
	/** Called as each candidate is titled, for status display. */
	onProgress?: (done: number, total: number) => void;
}

/**
 * Decide what would be written. Inspection only: opens each session read-only
 * and never appends.
 */
export async function buildPlan(sessions: SessionInfo[], options: PlanOptions): Promise<Plan> {
	const plan: Plan = { items: [], skipped: new Map() };
	const now = options.now ?? Date.now();
	const titler = options.titler;
	let done = 0;

	for (const session of sessions) {
		options.onProgress?.(done++, sessions.length);

		if (options.activePath && session.path === options.activePath) {
			skip(plan, "current session");
			continue;
		}
		if (session.name?.trim() && !options.force) {
			skip(plan, "already named");
			continue;
		}
		if (now - session.modified.getTime() < RECENT_WINDOW_MS) {
			skip(plan, "modified just now");
			continue;
		}

		try {
			const entries = options.loadBranch(session.path);
			const raw = await titler(entries);
			const title = raw ? raw.trim() : "";
			if (!title) {
				skip(plan, "no title derivable");
				continue;
			}
			plan.items.push({
				path: session.path,
				current: session.name?.trim() || undefined,
				title,
				turns: countAssistantTurns(entries),
			});
		} catch {
			skip(plan, "unreadable");
		}
	}

	return plan;
}

/** Render the plan as markdown for the overlay. */
export function renderPlan(plan: Plan, args: RetitleArgs): string {
	const lines: string[] = [];
	const scope = args.global ? "all projects" : "this folder";
	lines.push(`**${plan.items.length}** session(s) in ${scope} would be renamed.`);
	lines.push("");

	for (const item of plan.items.slice(0, PLAN_PREVIEW)) {
		lines.push(item.current ? `- ${item.title}  _(was: ${item.current})_` : `- ${item.title}`);
	}
	if (plan.items.length > PLAN_PREVIEW) {
		lines.push(`- …and ${plan.items.length - PLAN_PREVIEW} more`);
	}

	if (plan.skipped.size > 0) {
		lines.push("");
		lines.push("**Skipped**");
		for (const [reason, count] of [...plan.skipped.entries()].sort((a, b) => b[1] - a[1])) {
			lines.push(`- ${count} × ${reason}`);
		}
	}

	return lines.join("\n");
}

/** Assistant messages in a branch, recorded in the marker entry. */
function countAssistantTurns(entries: SessionEntry[]): number {
	let count = 0;
	for (const entry of entries) {
		if (entry.type === "message" && entry.message.role === "assistant") count++;
	}
	return count;
}
