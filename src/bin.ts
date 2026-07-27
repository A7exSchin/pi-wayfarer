/**
 * The Wayfarer bin.
 *
 * Purged sessions are *moved*, not deleted: `<session-dir>/.wayfarer-trash/`.
 * pi lists sessions non-recursively (`readdir(dir).filter(f => f.endsWith(".jsonl"))`
 * in `SessionManager.list`/`listAll`), so a nested directory is invisible to the
 * picker and to Wayfarer's own panel — binned sessions cannot reappear.
 *
 * A move within the same directory is a rename: atomic, no copy, no window where
 * the session exists twice or half-written.
 *
 * Real deletion only happens later, when an entry outlives
 * `purgeRetentionDays`. That deletion mirrors pi's own `/resume` behaviour: try
 * the `trash` CLI, fall back to `unlink`.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync } from "node:fs";
import { appendFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export const BIN_DIR_NAME = ".wayfarer-trash";
const MANIFEST_NAME = "manifest.jsonl";
const DAY_MS = 86_400_000;

/** One line of the bin manifest. */
export interface BinRecord {
	/** File name inside the bin. */
	file: string;
	/** Absolute path the session came from, where `restore` puts it back. */
	origin: string;
	/** Display name at the time of binning, for the restore listing. */
	name?: string;
	/** ISO timestamp of the move. */
	deletedAt: string;
}

export interface BinEntry extends BinRecord {
	/** Absolute path inside the bin. */
	path: string;
	/** Whether the file is still there (the manifest is append-only). */
	present: boolean;
}

/** The bin directory for a session directory. Not created until needed. */
export function binDirFor(sessionDir: string): string {
	return join(sessionDir, BIN_DIR_NAME);
}

function manifestPath(binDir: string): string {
	return join(binDir, MANIFEST_NAME);
}

/**
 * Move a session into the bin. Returns the record written to the manifest.
 * The session directory is derived from the file itself, so sessions from
 * several projects each land in their own bin.
 */
export function moveToBin(sessionPath: string, name?: string): BinRecord {
	const binDir = binDirFor(dirname(sessionPath));
	mkdirSync(binDir, { recursive: true });

	// Collisions are only possible if the same file name is binned twice; keep
	// both rather than overwrite.
	let file = basename(sessionPath);
	if (existsSync(join(binDir, file))) {
		file = `${Date.now()}_${file}`;
	}

	renameSync(sessionPath, join(binDir, file));

	const record: BinRecord = { file, origin: sessionPath, name, deletedAt: new Date().toISOString() };
	appendFileSync(manifestPath(binDir), `${JSON.stringify(record)}\n`, "utf8");
	return record;
}

/** Read a bin's manifest, newest first. Entries whose file is gone are marked. */
export function readBin(sessionDir: string): BinEntry[] {
	const binDir = binDirFor(sessionDir);
	const manifest = manifestPath(binDir);
	if (!existsSync(manifest)) return [];

	const entries: BinEntry[] = [];
	for (const line of readFileSync(manifest, "utf8").split("\n")) {
		if (!line.trim()) continue;
		try {
			const record = JSON.parse(line) as BinRecord;
			const path = join(binDir, record.file);
			entries.push({ ...record, path, present: existsSync(path) });
		} catch {
			// A truncated line loses one record, not the manifest.
		}
	}

	return entries.reverse();
}

/**
 * Move a binned session back to where it came from. Fails rather than
 * overwriting if something already occupies the original path.
 */
export function restoreFromBin(entry: BinEntry): { ok: true } | { ok: false; error: string } {
	if (!entry.present) return { ok: false, error: "file is no longer in the bin" };
	if (existsSync(entry.origin)) return { ok: false, error: "a session already exists at the original path" };

	try {
		mkdirSync(dirname(entry.origin), { recursive: true });
		renameSync(entry.path, entry.origin);
		return { ok: true };
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : String(error) };
	}
}

export type DeleteMethod = "trash" | "unlink";

/**
 * Delete a file for real: `trash` first so it lands in the OS trash, `unlink`
 * only if that is unavailable. Mirrors pi's own session deletion.
 */
export function deleteFile(path: string): { ok: true; method: DeleteMethod } | { ok: false; error: string } {
	const args = path.startsWith("-") ? ["--", path] : [path];
	const result = spawnSync("trash", args, { encoding: "utf-8" });
	if (result.status === 0 || !existsSync(path)) return { ok: true, method: "trash" };

	try {
		unlinkSync(path);
		return { ok: true, method: "unlink" };
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : String(error) };
	}
}

/**
 * Delete binned sessions older than the retention window. Called at the start of
 * a purge run, so the bin cannot grow without bound.
 *
 * `deleter` is injectable so tests can observe the decision without moving real
 * files to the OS trash.
 */
export function pruneBin(
	sessionDir: string,
	retentionDays: number,
	now = Date.now(),
	deleter: (path: string) => { ok: boolean } = deleteFile,
): { deleted: number; failed: number } {
	const cutoff = now - retentionDays * DAY_MS;
	let deleted = 0;
	let failed = 0;

	for (const entry of readBin(sessionDir)) {
		if (!entry.present) continue;
		const at = Date.parse(entry.deletedAt);
		if (!Number.isFinite(at) || at > cutoff) continue;

		if (deleter(entry.path).ok) deleted++;
		else failed++;
	}

	return { deleted, failed };
}

/** Size of a file in bytes, or 0 when it cannot be read. */
export function sizeOf(path: string): number {
	try {
		return statSync(path).size;
	} catch {
		return 0;
	}
}

/** Session directories that currently hold a bin, given the directories in play. */
export function binnedDirs(sessionDirs: string[]): string[] {
	return sessionDirs.filter((dir) => existsSync(manifestPath(binDirFor(dir))));
}

/** All session directories under a sessions root (for `--global` restore). */
export function projectDirs(sessionsRoot: string): string[] {
	try {
		return readdirSync(sessionsRoot, { withFileTypes: true })
			.filter((entry) => entry.isDirectory() && entry.name !== BIN_DIR_NAME)
			.map((entry) => join(sessionsRoot, entry.name));
	} catch {
		return [];
	}
}
