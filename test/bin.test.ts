/**
 * Tests for the Wayfarer bin.
 *
 * These do touch the filesystem — but only inside a temporary directory created
 * per test. Real deletion is injected, so nothing is ever handed to `trash`.
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { BIN_DIR_NAME, binDirFor, moveToBin, pruneBin, readBin, restoreFromBin, sizeOf } from "../src/bin.ts";

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "wayfarer-bin-"));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

/** Write a fake session file and return its path. */
function fakeSession(name: string, content = '{"type":"session"}\n'): string {
	const path = join(dir, name);
	writeFileSync(path, content, "utf8");
	return path;
}

describe("moving sessions to the bin", () => {
	it("moves the file out of the session directory", () => {
		const path = fakeSession("a.jsonl");
		moveToBin(path, "A Session");

		assert.equal(existsSync(path), false, "the session must leave the listed directory");
		assert.equal(existsSync(join(binDirFor(dir), "a.jsonl")), true);
	});

	it("hides binned sessions from pi's listing", () => {
		// pi lists `<dir>/*.jsonl` non-recursively, so a nested directory is invisible.
		moveToBin(fakeSession("a.jsonl"));
		const visible = readFileSync(join(binDirFor(dir), "a.jsonl"), "utf8");
		assert.ok(visible.length > 0);
		assert.equal(binDirFor(dir), join(dir, BIN_DIR_NAME));
		assert.equal(BIN_DIR_NAME.startsWith("."), true, "bin directory is hidden");
	});

	it("records origin and name in the manifest", () => {
		const path = fakeSession("a.jsonl");
		const record = moveToBin(path, "A Session");

		assert.equal(record.origin, path);
		assert.equal(record.name, "A Session");
		assert.ok(Date.parse(record.deletedAt) > 0);

		const entries = readBin(dir);
		assert.equal(entries.length, 1);
		assert.equal(entries[0]?.present, true);
		assert.equal(entries[0]?.origin, path);
	});

	it("keeps both when the same file name is binned twice", () => {
		moveToBin(fakeSession("a.jsonl", "first"));
		moveToBin(fakeSession("a.jsonl", "second"));

		const entries = readBin(dir);
		assert.equal(entries.length, 2);
		assert.equal(new Set(entries.map((e) => e.file)).size, 2, "file names must not collide");
		assert.ok(entries.every((e) => e.present));
	});

	it("lists newest first", () => {
		moveToBin(fakeSession("first.jsonl"), "First");
		moveToBin(fakeSession("second.jsonl"), "Second");
		assert.deepEqual(
			readBin(dir).map((e) => e.name),
			["Second", "First"],
		);
	});

	it("returns nothing for a directory that was never purged", () => {
		assert.deepEqual(readBin(dir), []);
	});

	it("survives a truncated manifest line", () => {
		moveToBin(fakeSession("a.jsonl"), "A");
		writeFileSync(join(binDirFor(dir), "manifest.jsonl"), '{"file":"a.jsonl","orig', { flag: "a" });
		assert.equal(readBin(dir).length, 1, "one good record still parses");
	});
});

describe("restoring", () => {
	it("puts the session back where it came from", () => {
		const path = fakeSession("a.jsonl", "payload");
		moveToBin(path, "A");

		const entry = readBin(dir)[0];
		assert.ok(entry);
		assert.deepEqual(restoreFromBin(entry), { ok: true });
		assert.equal(existsSync(path), true);
		assert.equal(readFileSync(path, "utf8"), "payload");
	});

	it("refuses to overwrite a session that reappeared at the original path", () => {
		const path = fakeSession("a.jsonl", "old");
		moveToBin(path, "A");
		writeFileSync(path, "new", "utf8");

		const entry = readBin(dir)[0];
		assert.ok(entry);
		const result = restoreFromBin(entry);
		assert.equal(result.ok, false);
		assert.match((result as { error: string }).error, /already exists/);
		assert.equal(readFileSync(path, "utf8"), "new", "the existing file is untouched");
	});

	it("reports a missing bin file instead of throwing", () => {
		const path = fakeSession("a.jsonl");
		moveToBin(path, "A");
		const entry = readBin(dir)[0];
		assert.ok(entry);
		rmSync(entry.path);

		const result = restoreFromBin({ ...entry, present: false });
		assert.equal(result.ok, false);
	});
});

describe("retention", () => {
	const DAY = 86_400_000;

	it("deletes only entries past the retention window", () => {
		const deleted: string[] = [];
		const deleter = (path: string) => {
			deleted.push(path);
			rmSync(path, { force: true });
			return { ok: true };
		};

		moveToBin(fakeSession("old.jsonl"), "Old");
		moveToBin(fakeSession("new.jsonl"), "New");

		// Rewrite the manifest so one entry looks 60 days old.
		const manifest = join(binDirFor(dir), "manifest.jsonl");
		const lines = readFileSync(manifest, "utf8").trim().split("\n");
		const aged = JSON.parse(lines[0] as string);
		aged.deletedAt = new Date(Date.now() - 60 * DAY).toISOString();
		writeFileSync(manifest, `${JSON.stringify(aged)}\n${lines[1]}\n`, "utf8");

		const result = pruneBin(dir, 30, Date.now(), deleter);
		assert.equal(result.deleted, 1);
		assert.equal(deleted.length, 1);
		assert.match(deleted[0] as string, /old\.jsonl$/);
		assert.equal(existsSync(join(binDirFor(dir), "new.jsonl")), true, "recent entries survive");
	});

	it("does nothing when the bin is empty", () => {
		assert.deepEqual(pruneBin(dir, 30, Date.now(), () => ({ ok: true })), { deleted: 0, failed: 0 });
	});

	it("counts failures instead of throwing", () => {
		moveToBin(fakeSession("a.jsonl"), "A");
		const manifest = join(binDirFor(dir), "manifest.jsonl");
		const record = JSON.parse(readFileSync(manifest, "utf8").trim());
		record.deletedAt = new Date(Date.now() - 60 * DAY).toISOString();
		writeFileSync(manifest, `${JSON.stringify(record)}\n`, "utf8");

		const result = pruneBin(dir, 30, Date.now(), () => ({ ok: false }));
		assert.deepEqual(result, { deleted: 0, failed: 1 });
	});
});

describe("sizeOf", () => {
	it("returns the file size", () => {
		assert.equal(sizeOf(fakeSession("a.jsonl", "12345")), 5);
	});

	it("returns 0 for a path that does not exist", () => {
		assert.equal(sizeOf(join(dir, "nope.jsonl")), 0);
	});

	it("does not create anything", () => {
		mkdirSync(join(dir, "sub"));
		assert.equal(sizeOf(join(dir, "sub")) >= 0, true);
	});
});
