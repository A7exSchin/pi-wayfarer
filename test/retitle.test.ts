/**
 * Tests for `/wf retitle`.
 *
 * The command surface (argument parsing) and the write plan (which sessions are
 * touched, and what would be written) are pure and tested here. `applyPlan()` is
 * not exercised: it appends to real session files, and a test that did so would
 * be writing to session data.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SessionEntry, SessionInfo } from "@earendil-works/pi-coding-agent";
import { buildPlan, parseRetitleArgs, type Plan, renderPlan, type RetitleArgs } from "../src/retitle.ts";

const NOW = Date.UTC(2026, 6, 27, 12, 0, 0);
const HOUR = 60 * 60 * 1000;

function session(over: Partial<SessionInfo> & { path: string }): SessionInfo {
	return {
		id: over.path,
		cwd: "/tmp/project",
		created: new Date(NOW - 2 * HOUR),
		modified: new Date(NOW - HOUR),
		messageCount: 4,
		firstMessage: "",
		allMessagesText: "",
		...over,
	} as SessionInfo;
}

const args = (over: Partial<RetitleArgs> = {}): RetitleArgs => ({
	mode: "batch",
	global: false,
	force: false,
	dryRun: false,
	llm: false,
	...over,
});

describe("retitle argument parsing", () => {
	it("returns undefined for anything that is not a retitle command", () => {
		assert.equal(parseRetitleArgs(""), undefined);
		assert.equal(parseRetitleArgs("   "), undefined);
		assert.equal(parseRetitleArgs("summary"), undefined);
	});

	it("defaults to the current session", () => {
		const parsed = parseRetitleArgs("retitle");
		assert.deepEqual(parsed, {
			ok: true,
			args: { mode: "current", global: false, force: false, dryRun: false, llm: false },
		});
	});

	it("switches to batch mode with `all`", () => {
		const parsed = parseRetitleArgs("retitle all");
		assert.ok(parsed?.ok && parsed.args.mode === "batch");
		assert.equal(parsed.ok && parsed.args.global, false, "batch defaults to the current folder");
	});

	it("accepts long and short flags", () => {
		const long = parseRetitleArgs("retitle all --global --force --dry-run --llm");
		const short = parseRetitleArgs("retitle all -g -f -n --llm");
		assert.ok(long?.ok && short?.ok);
		assert.deepEqual(long.args, short.args);
		assert.deepEqual(long.args, { mode: "batch", global: true, force: true, dryRun: true, llm: true });
	});

	it("rejects unknown options rather than ignoring them", () => {
		const parsed = parseRetitleArgs("retitle all --recursive");
		assert.ok(parsed && !parsed.ok);
		assert.match(parsed.error, /Unknown option "--recursive"/);
	});

	it("rejects batch-only flags on a single retitle", () => {
		assert.match((parseRetitleArgs("retitle --global") as { error: string }).error, /only applies to/);
		assert.match((parseRetitleArgs("retitle --llm") as { error: string }).error, /only applies to/);
	});
});

describe("retitle plan", () => {
	/** A branch with one assistant turn. */
	const branch: SessionEntry[] = [
		{ type: "message", message: { role: "assistant", content: [] } } as unknown as SessionEntry,
	];
	const missing = (path: string): SessionEntry[] => {
		throw new Error(`no such session: ${path}`);
	};

	const filtered = async (sessions: SessionInfo[], over: Partial<Parameters<typeof buildPlan>[1]> = {}) =>
		await buildPlan(sessions, {
			force: false,
			now: NOW,
			titler: () => "Title",
			loadBranch: () => branch,
			...over,
		});

	it("never touches the session pi currently has open", async () => {
		const plan = await filtered([session({ path: "/s/active.jsonl" })], { activePath: "/s/active.jsonl" });
		assert.equal(plan.items.length, 0);
		assert.equal(plan.skipped.get("current session"), 1);
	});

	it("skips sessions that already have a name", async () => {
		const plan = await filtered([session({ path: "/s/a.jsonl", name: "Hand Written" })]);
		assert.equal(plan.skipped.get("already named"), 1);
	});

	it("retitles named sessions only with --force", async () => {
		const plan = await filtered([session({ path: "/s/a.jsonl", name: "Hand Written" })], { force: true });
		assert.equal(plan.skipped.get("already named"), undefined);
		assert.deepEqual(plan.items.map((i) => [i.title, i.current]), [["Title", "Hand Written"]]);
	});

	it("records the assistant turn count for the marker entry", async () => {
		const plan = await filtered([session({ path: "/s/a.jsonl" })]);
		assert.equal(plan.items[0]?.turns, 1);
	});

	it("skips sessions the titler cannot name", async () => {
		const plan = await filtered([session({ path: "/s/a.jsonl" })], { titler: () => "   " });
		assert.equal(plan.items.length, 0);
		assert.equal(plan.skipped.get("no title derivable"), 1);
	});

	it("supports an async titler (--llm)", async () => {
		const plan = await filtered([session({ path: "/s/a.jsonl" })], {
			titler: async () => "From The Model",
		});
		assert.equal(plan.items[0]?.title, "From The Model");
	});

	it("skips sessions modified in the last few minutes (possibly open elsewhere)", async () => {
		const plan = await filtered([session({ path: "/s/hot.jsonl", modified: new Date(NOW - 60_000) })]);
		assert.equal(plan.skipped.get("modified just now"), 1);
	});

	it("counts unreadable sessions instead of aborting the run", async () => {
		const plan = await filtered(
			[session({ path: "/s/missing-1.jsonl" }), session({ path: "/s/missing-2.jsonl" })],
			{ loadBranch: missing },
		);
		assert.equal(plan.items.length, 0);
		assert.equal(plan.skipped.get("unreadable"), 2);
	});

	it("reports progress for every session considered", async () => {
		const seen: number[] = [];
		await filtered([session({ path: "/s/a.jsonl" }), session({ path: "/s/b.jsonl" })], {
			onProgress: (done, total) => {
				assert.equal(total, 2);
				seen.push(done);
			},
		});
		assert.deepEqual(seen, [0, 1]);
	});
});

describe("retitle plan rendering", () => {
	const plan: Plan = {
		items: [
			{ path: "/s/a.jsonl", title: "Session Panel", turns: 6 },
			{ path: "/s/b.jsonl", title: "Language Packs", current: "old name", turns: 3 },
		],
		skipped: new Map([
			["already named", 4],
			["current session", 1],
		]),
	};

	it("lists proposed titles and shows what is being replaced", () => {
		const text = renderPlan(plan, args());
		assert.match(text, /\*\*2\*\* session\(s\) in this folder/);
		assert.match(text, /- Session Panel/);
		assert.match(text, /- Language Packs {2}_\(was: old name\)_/);
	});

	it("names the scope", () => {
		assert.match(renderPlan(plan, args({ global: true })), /all projects/);
	});

	it("summarises what was skipped and why", () => {
		const text = renderPlan(plan, args());
		assert.match(text, /- 4 × already named/);
		assert.match(text, /- 1 × current session/);
	});

	it("truncates long plans", () => {
		const many: Plan = {
			items: Array.from({ length: 50 }, (_, i) => ({ path: `/s/${i}.jsonl`, title: `T${i}`, turns: 1 })),
			skipped: new Map(),
		};
		const text = renderPlan(many, args());
		assert.match(text, /…and 10 more/);
	});
});
