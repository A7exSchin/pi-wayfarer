/**
 * Tests for `/wf purge` planning.
 *
 * Covers the command surface and, more importantly, every rule that decides
 * whether a session is deleted. Nothing here touches the filesystem.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SessionInfo } from "@earendil-works/pi-coding-agent";
import {
	ageInDays,
	buildPurgePlan,
	formatBytes,
	parsePurgeArgs,
	type PurgeArgs,
	type PurgePlan,
	renderPurgePlan,
} from "../src/purge.ts";

const NOW = Date.UTC(2026, 6, 27, 12, 0, 0);
const DAY = 86_400_000;
const DEFAULTS = { days: 90 };

function session(over: Partial<SessionInfo> & { path: string }): SessionInfo {
	return {
		id: over.path,
		cwd: "/tmp/project",
		created: new Date(NOW - 400 * DAY),
		modified: new Date(NOW - 200 * DAY),
		messageCount: 10,
		firstMessage: "",
		allMessagesText: "",
		...over,
	} as SessionInfo;
}

const args = (over: Partial<PurgeArgs> = {}): PurgeArgs => ({
	days: 90,
	empty: false,
	global: false,
	force: false,
	dryRun: false,
	permanent: false,
	...over,
});

const plan = (sessions: SessionInfo[], over: Partial<Parameters<typeof buildPurgePlan>[1]> = {}) =>
	buildPurgePlan(sessions, {
		args: args(),
		maxMessages: 2,
		now: NOW,
		sizeOf: () => 1024,
		isAutoNamed: () => false,
		...over,
	});

describe("purge argument parsing", () => {
	it("returns undefined for anything that is not a purge command", () => {
		assert.equal(parsePurgeArgs("", DEFAULTS), undefined);
		assert.equal(parsePurgeArgs("retitle all", DEFAULTS), undefined);
	});

	it("uses the configured age threshold by default", () => {
		const parsed = parsePurgeArgs("purge", DEFAULTS);
		assert.ok(parsed?.ok);
		assert.equal(parsed.args.days, 90);
		assert.equal(parsed.args.permanent, false, "purge must default to the recoverable path");
	});

	it("accepts --days with a value", () => {
		const parsed = parsePurgeArgs("purge --days 30", DEFAULTS);
		assert.ok(parsed?.ok && parsed.args.days === 30);
	});

	it("rejects a missing or nonsensical --days value", () => {
		for (const input of ["purge --days", "purge --days soon", "purge --days -5"]) {
			const parsed = parsePurgeArgs(input, DEFAULTS);
			assert.ok(parsed && !parsed.ok, input);
			assert.match(parsed.error, /--days needs a non-negative number/);
		}
	});

	it("accepts the remaining flags", () => {
		const parsed = parsePurgeArgs("purge --empty -g -f -n --permanent", DEFAULTS);
		assert.ok(parsed?.ok);
		assert.deepEqual(parsed.args, { days: 90, empty: true, global: true, force: true, dryRun: true, permanent: true });
	});

	it("rejects unknown options rather than ignoring them", () => {
		const parsed = parsePurgeArgs("purge --yolo", DEFAULTS);
		assert.ok(parsed && !parsed.ok);
		assert.match(parsed.error, /Unknown option "--yolo"/);
	});
});

describe("purge plan", () => {
	it("selects sessions older than the threshold", () => {
		const result = plan([
			session({ path: "/s/old.jsonl", modified: new Date(NOW - 120 * DAY) }),
			session({ path: "/s/fresh.jsonl", modified: new Date(NOW - 10 * DAY) }),
		]);
		assert.deepEqual(
			result.items.map((i) => i.path),
			["/s/old.jsonl"],
		);
		assert.equal(result.skipped.get("recent enough"), 1);
	});

	it("never touches the session pi has open", () => {
		const result = plan([session({ path: "/s/active.jsonl" })], { activePath: "/s/active.jsonl" });
		assert.equal(result.items.length, 0);
		assert.equal(result.skipped.get("current session"), 1);
	});

	it("never touches a session modified moments ago", () => {
		const result = plan([session({ path: "/s/hot.jsonl", modified: new Date(NOW - 60_000) })]);
		assert.equal(result.skipped.get("modified just now"), 1);
	});

	it("protects sessions named by hand", () => {
		const result = plan([session({ path: "/s/a.jsonl", name: "Important Thing" })]);
		assert.equal(result.items.length, 0);
		assert.equal(result.skipped.get("named by hand"), 1);
	});

	it("does not treat a Wayfarer-generated name as human intent", () => {
		const result = plan([session({ path: "/s/a.jsonl", name: "Session Panel — panel.ts" })], {
			isAutoNamed: () => true,
		});
		assert.equal(result.items.length, 1, "auto-named sessions stay purgeable");
	});

	it("includes hand-named sessions under --force", () => {
		const result = plan([session({ path: "/s/a.jsonl", name: "Important Thing" })], { args: args({ force: true }) });
		assert.equal(result.items.length, 1);
	});

	it("protects a session another session forked from", () => {
		const result = plan([
			session({ path: "/s/parent.jsonl" }),
			session({ path: "/s/child.jsonl", parentSessionPath: "/s/parent.jsonl" }),
		]);
		assert.deepEqual(
			result.items.map((i) => i.path),
			["/s/child.jsonl"],
		);
		assert.equal(result.skipped.get("parent of a fork"), 1);
	});

	it("--empty selects by message count, ignoring age", () => {
		const result = plan(
			[
				session({ path: "/s/empty.jsonl", messageCount: 1, modified: new Date(NOW - 2 * DAY) }),
				session({ path: "/s/busy.jsonl", messageCount: 40, modified: new Date(NOW - 300 * DAY) }),
			],
			{ args: args({ empty: true }) },
		);
		assert.deepEqual(
			result.items.map((i) => i.path),
			["/s/empty.jsonl"],
		);
		assert.equal(result.skipped.get("not empty"), 1);
	});

	it("records size and message count for the plan display", () => {
		const result = plan([session({ path: "/s/a.jsonl", messageCount: 7 })], { sizeOf: () => 4096 });
		assert.equal(result.items[0]?.bytes, 4096);
		assert.equal(result.items[0]?.messageCount, 7);
	});
});

describe("purge plan rendering", () => {
	const built: PurgePlan = {
		items: [
			{ path: "/s/a.jsonl", name: "Old Experiment", modified: new Date(NOW - 120 * DAY), messageCount: 12, bytes: 2048 },
			{ path: "/s/b.jsonl", modified: new Date(NOW - 200 * DAY), messageCount: 1, bytes: 512 },
		],
		skipped: new Map([["named by hand", 3]]),
	};

	it("summarises count, size and age", () => {
		const text = renderPurgePlan(built, { args: args(), now: NOW });
		assert.match(text, /\*\*2\*\* session\(s\) in this folder are older than 90 day\(s\)/);
		assert.match(text, /3 KB/); // 2048 + 512, rounded to whole KB
		assert.match(text, /oldest 200 day\(s\)/);
	});

	it("says where the sessions go", () => {
		assert.match(renderPurgePlan(built, { args: args(), now: NOW }), /moved to the Wayfarer bin/);
		assert.match(renderPurgePlan(built, { args: args({ permanent: true }), now: NOW }), /deleted permanently/);
	});

	it("lists each session with age, messages and size", () => {
		const text = renderPurgePlan(built, { args: args(), now: NOW });
		assert.match(text, /- Old Experiment — 120d, 12 msg, 2 KB/);
		assert.match(text, /- \(unnamed\) — 200d, 1 msg, 512 B/);
	});

	it("summarises what was kept", () => {
		assert.match(renderPurgePlan(built, { args: args(), now: NOW }), /- 3 × named by hand/);
	});
});

describe("formatting helpers", () => {
	it("formats bytes", () => {
		assert.equal(formatBytes(512), "512 B");
		assert.equal(formatBytes(2048), "2 KB");
		assert.equal(formatBytes(5 * 1024 * 1024), "5.0 MB");
	});

	it("counts whole days", () => {
		assert.equal(ageInDays(new Date(NOW - 3 * DAY - 1000), NOW), 3);
		assert.equal(ageInDays(new Date(NOW), NOW), 0);
	});
});
