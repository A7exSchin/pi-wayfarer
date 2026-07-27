/**
 * Offline evaluator for the deterministic titler.
 *
 * Replays real pi sessions (`~/.pi/agent/sessions/--<path>--/*.jsonl`, see the
 * `session-format.md` doc shipped with pi) through `heuristicTitle()` and reports
 * what titles it would have produced, what the confidence score was, and how
 * often `auto` mode would fall back to the model.
 *
 * Usage:
 *   node test/evaluate-sessions.ts [--threshold N] [--dir PATH] [--language ID] [--quiet]
 *
 * Nothing is written; sessions are read-only.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { DEFAULT_LANGUAGE_ID } from "../src/lang/index.ts";
import { DEFAULT_CONFIDENCE_THRESHOLD, heuristicTitle } from "../src/title-heuristic.ts";

interface RawEntry {
	type: string;
	id?: string;
	parentId?: string | null;
	name?: string;
	cwd?: string;
	[key: string]: unknown;
}

export interface Replay {
	file: string;
	project: string;
	storedName?: string;
	entries: SessionEntry[];
}

function parseArgs(argv: string[]) {
	const get = (flag: string): string | undefined => {
		const i = argv.indexOf(flag);
		return i >= 0 ? argv[i + 1] : undefined;
	};
	return {
		threshold: Number(get("--threshold") ?? DEFAULT_CONFIDENCE_THRESHOLD),
		dir: get("--dir") ?? join(homedir(), ".pi", "agent", "sessions"),
		language: get("--language") ?? DEFAULT_LANGUAGE_ID,
		quiet: argv.includes("--quiet"),
	};
}

export function sessionFiles(root: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		const path = join(root, entry.name);
		if (entry.isDirectory()) out.push(...sessionFiles(path));
		else if (entry.name.endsWith(".jsonl")) out.push(path);
	}
	return out.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
}

/**
 * Rebuild the active branch: walk `parentId` links back from the last entry, the
 * same way `SessionManager.getBranch()` does.
 */
export function replay(file: string): Replay | undefined {
	const raw: RawEntry[] = [];
	for (const line of readFileSync(file, "utf8").split("\n")) {
		if (!line.trim()) continue;
		try {
			raw.push(JSON.parse(line) as RawEntry);
		} catch {
			// Ignore truncated trailing lines from a crashed session.
		}
	}
	if (raw.length === 0) return undefined;

	const header = raw.find((e) => e.type === "session");
	const byId = new Map<string, RawEntry>();
	for (const entry of raw) if (entry.id) byId.set(entry.id, entry);

	const branch: RawEntry[] = [];
	let cursor: RawEntry | undefined = raw[raw.length - 1];
	const guard = new Set<string>();
	while (cursor && cursor.type !== "session") {
		if (cursor.id) {
			if (guard.has(cursor.id)) break; // cycle guard
			guard.add(cursor.id);
		}
		branch.push(cursor);
		cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
	}
	branch.reverse();

	const named = [...branch].reverse().find((e) => e.type === "session_info" && typeof e.name === "string");

	return {
		file,
		project: header?.cwd ? basename(header.cwd) : basename(file),
		storedName: named?.name,
		entries: branch as unknown as SessionEntry[],
	};
}

function pad(text: string, width: number): string {
	const clipped = text.length > width ? `${text.slice(0, width - 1)}\u2026` : text;
	return clipped.padEnd(width);
}

function histogram(values: number[]): string {
	const counts = new Map<number, number>();
	for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
	return [...counts.entries()]
		.sort((a, b) => a[0] - b[0])
		.map(([score, count]) => `${score}:${count}`)
		.join("  ");
}

// CLI entry point; the helpers above are importable for experiments.
if (import.meta.main) {
	const args = parseArgs(process.argv.slice(2));
	const files = sessionFiles(args.dir);
	if (files.length === 0) {
		console.error(`No sessions found under ${args.dir}`);
		process.exit(1);
	}

	const scores: number[] = [];
	const reasonCounts = new Map<string, number>();
	let confidentCount = 0;
	let evaluated = 0;
	let named = 0;
	let namedConfident = 0;

	if (!args.quiet) {
		console.log(`${pad("project", 22)} ${pad("heuristic title", 44)} ${pad("sc", 3)} ${pad("cf", 3)} reasons`);
		console.log("-".repeat(120));
	}

	for (const file of files) {
		const session = replay(file);
		if (!session) continue;
		const messages = session.entries.filter((e) => e.type === "message");
		if (messages.length < 2) continue; // nothing a titler could work with

		const result = heuristicTitle(session.entries, { maxLen: 60, confidenceThreshold: args.threshold, language: args.language });
		evaluated++;
		scores.push(result.score);
		if (result.confident) confidentCount++;
		for (const reason of result.reasons) {
			const key = reason.split(":")[0] ?? reason;
			reasonCounts.set(key, (reasonCounts.get(key) ?? 0) + 1);
		}
		if (session.storedName) {
			named++;
			if (result.confident) namedConfident++;
		}

		if (!args.quiet) {
			console.log(
				`${pad(session.project, 22)} ${pad(result.title || "(empty)", 44)} ${pad(String(result.score), 3)} ${pad(
					result.confident ? "yes" : "NO",
					3,
				)} ${result.reasons.join(" ")}`,
			);
			if (session.storedName) console.log(`${" ".repeat(22)} stored name: ${session.storedName}`);
		}
	}

	const fallbackRate = evaluated === 0 ? 0 : (evaluated - confidentCount) / evaluated;
	console.log("");
	console.log(`sessions evaluated : ${evaluated} (of ${files.length} files, threshold ${args.threshold})`);
	console.log(`confident          : ${confidentCount} (${((confidentCount / evaluated) * 100).toFixed(1)}%)`);
	console.log(`auto fallback rate : ${(fallbackRate * 100).toFixed(1)}% would call the model`);
	console.log(`score histogram    : ${histogram(scores)}`);
	console.log(
		`reason frequency   : ${[...reasonCounts.entries()]
			.sort((a, b) => b[1] - a[1])
			.map(([reason, count]) => `${reason}=${count}`)
			.join("  ")}`,
	);
	if (named > 0) console.log(`human-named sessions: ${named}, of which confident: ${namedConfident}`);
}
