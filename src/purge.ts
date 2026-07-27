/**
 * `/wf purge` — planning logic.
 *
 * Like `retitle.ts`, this module has no runtime imports from pi: filesystem and
 * session access are injected by `purge-run.ts`, so *what would be deleted* is
 * testable without a pi installation. Given the operation, that matters more
 * here than anywhere else in the extension.
 */

import type { SessionInfo } from "@earendil-works/pi-coding-agent";

/** Sessions modified within this window may be open elsewhere; leave them alone. */
const RECENT_WINDOW_MS = 5 * 60 * 1000;

/** How many sessions to list before truncating the plan. */
const PLAN_PREVIEW = 40;

const DAY_MS = 86_400_000;

export interface PurgeArgs {
	/** Age threshold in days; defaults to `config.purgeDays`. */
	days: number;
	/** Restrict to near-empty sessions, regardless of age. */
	empty: boolean;
	/** Every project instead of the current folder. */
	global: boolean;
	/** Include sessions whose name was set by hand. */
	force: boolean;
	/** Show the plan, delete nothing. */
	dryRun: boolean;
	/** Bypass the bin and delete outright. */
	permanent: boolean;
}

export type ParseResult = { ok: true; args: PurgeArgs } | { ok: false; error: string };

/**
 * Parse `/wf purge …`. Returns `undefined` when this is not a purge invocation,
 * so the caller can fall through to the panel.
 */
export function parsePurgeArgs(raw: string, defaults: { days: number }): ParseResult | undefined {
	const tokens = raw.trim().split(/\s+/).filter(Boolean);
	if (tokens.length === 0 || tokens[0] !== "purge") return undefined;

	const args: PurgeArgs = {
		days: defaults.days,
		empty: false,
		global: false,
		force: false,
		dryRun: false,
		permanent: false,
	};

	for (let i = 1; i < tokens.length; i++) {
		const token = tokens[i] as string;
		switch (token) {
			case "--days": {
				const value = tokens[++i];
				const days = Number(value);
				if (!value || !Number.isFinite(days) || days < 0) {
					return { ok: false, error: `--days needs a non-negative number, got "${value ?? ""}"` };
				}
				args.days = days;
				break;
			}
			case "--empty":
				args.empty = true;
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
			case "--permanent":
				args.permanent = true;
				break;
			default:
				return { ok: false, error: `Unknown option "${token}"` };
		}
	}

	return { ok: true, args };
}

export interface PurgeItem {
	path: string;
	name?: string;
	modified: Date;
	messageCount: number;
	/** File size in bytes, for the "how much would I free" line. */
	bytes: number;
}

export interface PurgePlan {
	items: PurgeItem[];
	skipped: Map<string, number>;
}

function skip(plan: PurgePlan, reason: string): void {
	plan.skipped.set(reason, (plan.skipped.get(reason) ?? 0) + 1);
}

export interface PurgeOptions {
	args: PurgeArgs;
	/** Session pi currently has open; never touched. */
	activePath?: string;
	/** `--empty` threshold. */
	maxMessages: number;
	/** Injectable clock, for tests. */
	now?: number;
	/** File size in bytes, or 0 when it cannot be determined. */
	sizeOf: (path: string) => number;
	/**
	 * True when the session's name was written by Wayfarer (its `wayfarer-title`
	 * marker matches the current name). Such names carry no human intent, so they
	 * do not protect the session.
	 */
	isAutoNamed: (session: SessionInfo) => boolean;
}

/**
 * Decide what would be removed. Inspection only.
 *
 * Protections, in order: the live session, anything touched in the last few
 * minutes, sessions you named yourself, and any session another session forked
 * from — deleting a parent would orphan its children.
 */
export function buildPurgePlan(sessions: SessionInfo[], options: PurgeOptions): PurgePlan {
	const plan: PurgePlan = { items: [], skipped: new Map() };
	const now = options.now ?? Date.now();
	const cutoff = now - options.args.days * DAY_MS;

	// Parents of sessions that exist right now. Forks are not otherwise modelled
	// yet, but purge must not silently orphan them.
	const parents = new Set(
		sessions.map((session) => session.parentSessionPath).filter((path): path is string => Boolean(path)),
	);

	for (const session of sessions) {
		if (options.activePath && session.path === options.activePath) {
			skip(plan, "current session");
			continue;
		}
		if (now - session.modified.getTime() < RECENT_WINDOW_MS) {
			skip(plan, "modified just now");
			continue;
		}
		if (session.name?.trim() && !options.isAutoNamed(session) && !options.args.force) {
			skip(plan, "named by hand");
			continue;
		}
		if (parents.has(session.path)) {
			skip(plan, "parent of a fork");
			continue;
		}

		if (options.args.empty) {
			if (session.messageCount > options.maxMessages) {
				skip(plan, "not empty");
				continue;
			}
		} else if (session.modified.getTime() > cutoff) {
			skip(plan, "recent enough");
			continue;
		}

		plan.items.push({
			path: session.path,
			name: session.name?.trim() || undefined,
			modified: session.modified,
			messageCount: session.messageCount,
			bytes: options.sizeOf(session.path),
		});
	}

	return plan;
}

/** Bytes as a short human string. */
export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Whole days between `then` and `now`, for the plan listing. */
export function ageInDays(then: Date, now: number): number {
	return Math.floor((now - then.getTime()) / DAY_MS);
}

/** Render the plan as markdown for the overlay. */
export function renderPurgePlan(plan: PurgePlan, options: { args: PurgeArgs; now?: number }): string {
	const now = options.now ?? Date.now();
	const args = options.args;
	const bytes = plan.items.reduce((sum, item) => sum + item.bytes, 0);
	const oldest = plan.items.reduce((max, item) => Math.max(max, ageInDays(item.modified, now)), 0);

	const scope = args.global ? "all projects" : "this folder";
	const criterion = args.empty ? "are empty" : `are older than ${args.days} day(s)`;

	const lines: string[] = [];
	lines.push(
		`**${plan.items.length}** session(s) in ${scope} ${criterion} · ` +
			`${formatBytes(bytes)} · oldest ${oldest} day(s)`,
	);
	lines.push("");
	lines.push(
		args.permanent
			? "They will be **deleted permanently**."
			: "They will be moved to the Wayfarer bin and can be restored with `/wf restore`.",
	);
	lines.push("");

	for (const item of plan.items.slice(0, PLAN_PREVIEW)) {
		const label = item.name ?? "(unnamed)";
		lines.push(
			`- ${label} — ${ageInDays(item.modified, now)}d, ${item.messageCount} msg, ${formatBytes(item.bytes)}`,
		);
	}
	if (plan.items.length > PLAN_PREVIEW) {
		lines.push(`- …and ${plan.items.length - PLAN_PREVIEW} more`);
	}

	if (plan.skipped.size > 0) {
		lines.push("");
		lines.push("**Kept**");
		for (const [reason, count] of [...plan.skipped.entries()].sort((a, b) => b[1] - a[1])) {
			lines.push(`- ${count} × ${reason}`);
		}
	}

	return lines.join("\n");
}
