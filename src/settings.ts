/**
 * User-level settings.
 *
 * `config.ts` declares the defaults in TypeScript. Anything changed from the
 * settings overlay is written to a small JSON file instead, because assigning to
 * the config module only lasts until `/reload` — a setting that forgets itself is
 * worse than no setting.
 *
 * The file is a *validated overlay*: unknown keys and bad values are reported and
 * ignored rather than silently reverting to a default, and every key not exposed
 * in the overlay stays editable in `config.ts` as before.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Scope, WayfarerConfig } from "./config.ts";

/** The subset of the config the overlay can change. */
export interface WayfarerSettings {
	/** "provider/model-id", or undefined for the session's current model. */
	summaryModel?: string;
	/** "provider/model-id", or undefined for the session's current model. */
	titleModel?: string;
	titleStrategy?: WayfarerConfig["titleStrategy"];
	defaultScope?: Scope;
}

export interface LoadResult {
	settings: WayfarerSettings;
	/** Human-readable complaints about the file; shown once, never fatal. */
	problems: string[];
}

const TITLE_STRATEGIES = ["heuristic", "llm", "auto"] as const;
const SCOPES = ["folder", "all"] as const;

/**
 * Where the settings file lives: alongside pi's own configuration, honouring
 * `PI_CODING_AGENT_DIR` so a relocated config directory keeps everything together.
 */
export function settingsPath(env: NodeJS.ProcessEnv = process.env): string {
	const configDir = env.PI_CODING_AGENT_DIR?.trim() || join(homedir(), ".pi", "agent");
	return join(configDir, "wayfarer.json");
}

/** True for "provider/model-id" — the form `resolveModel()` expects. */
function isModelRef(value: unknown): value is string {
	if (typeof value !== "string") return false;
	const slash = value.indexOf("/");
	return slash > 0 && slash < value.length - 1;
}

/**
 * Validate a parsed JSON object into settings. Every rejected value is reported;
 * nothing throws, because a broken settings file must not stop the extension.
 */
export function validateSettings(raw: unknown): LoadResult {
	const problems: string[] = [];
	const settings: WayfarerSettings = {};

	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
		return { settings, problems: ["settings file must contain a JSON object"] };
	}

	for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
		switch (key) {
			case "summaryModel":
			case "titleModel":
				if (value === null || value === undefined) break; // explicit "use the session model"
				if (!isModelRef(value)) {
					problems.push(`${key}: expected "provider/model-id", got ${JSON.stringify(value)}`);
					break;
				}
				settings[key] = value;
				break;

			case "titleStrategy":
				if (!TITLE_STRATEGIES.includes(value as (typeof TITLE_STRATEGIES)[number])) {
					problems.push(`titleStrategy: expected one of ${TITLE_STRATEGIES.join(", ")}`);
					break;
				}
				settings.titleStrategy = value as WayfarerConfig["titleStrategy"];
				break;

			case "defaultScope":
				if (!SCOPES.includes(value as (typeof SCOPES)[number])) {
					problems.push(`defaultScope: expected one of ${SCOPES.join(", ")}`);
					break;
				}
				settings.defaultScope = value as Scope;
				break;

			default:
				problems.push(`unknown setting "${key}" (ignored)`);
		}
	}

	return { settings, problems };
}

/** Read the settings file. A missing file is not a problem; a broken one is reported. */
export function loadSettings(path = settingsPath()): LoadResult {
	if (!existsSync(path)) return { settings: {}, problems: [] };

	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		return { settings: {}, problems: [`could not parse ${path}: ${error instanceof Error ? error.message : error}`] };
	}

	return validateSettings(parsed);
}

/** Write the settings file, creating its directory if needed. */
export function saveSettings(settings: WayfarerSettings, path = settingsPath()): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(compact(settings), null, "\t")}\n`, "utf8");
}

/** Drop undefined entries so "use the session model" is absence, not null. */
function compact(settings: WayfarerSettings): WayfarerSettings {
	const out: WayfarerSettings = {};
	for (const [key, value] of Object.entries(settings)) {
		if (value !== undefined) (out as Record<string, unknown>)[key] = value;
	}
	return out;
}

/**
 * Apply settings over the live config. Mutates in place: the rest of the
 * extension reads `config` directly, and this keeps a single source of truth.
 */
export function applySettings(config: WayfarerConfig, settings: WayfarerSettings): void {
	if ("summaryModel" in settings) config.summaryModel = settings.summaryModel;
	if ("titleModel" in settings) config.titleModel = settings.titleModel;
	if (settings.titleStrategy) config.titleStrategy = settings.titleStrategy;
	if (settings.defaultScope) config.defaultScope = settings.defaultScope;
}

/** The settings that correspond to the current config, for editing in the overlay. */
export function settingsFromConfig(config: WayfarerConfig): WayfarerSettings {
	return {
		summaryModel: config.summaryModel,
		titleModel: config.titleModel,
		titleStrategy: config.titleStrategy,
		defaultScope: config.defaultScope,
	};
}
