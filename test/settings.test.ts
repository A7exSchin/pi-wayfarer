/**
 * Tests for settings persistence and validation.
 *
 * The overlay (`settings-view.ts`) imports pi at runtime and cannot be loaded
 * outside a pi install; this module is pure file IO plus validation, so it gets
 * real tests. File operations use a per-test temp directory.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { config } from "../src/config.ts";
import {
	applySettings,
	loadSettings,
	saveSettings,
	settingsFromConfig,
	settingsPath,
	validateSettings,
} from "../src/settings.ts";

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "wayfarer-settings-"));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe("settings path", () => {
	it("defaults to ~/.pi/agent/wayfarer.json", () => {
		assert.match(settingsPath({}), /\/\.pi\/agent\/wayfarer\.json$/);
	});

	it("honours PI_CODING_AGENT_DIR", () => {
		assert.equal(settingsPath({ PI_CODING_AGENT_DIR: "/custom/config" }), "/custom/config/wayfarer.json");
	});
});

describe("validateSettings", () => {
	it("accepts model refs as provider/model-id", () => {
		const { settings, problems } = validateSettings({ summaryModel: "anthropic/claude-haiku-4-5" });
		assert.deepEqual(problems, []);
		assert.equal(settings.summaryModel, "anthropic/claude-haiku-4-5");
	});

	it("accepts null as 'use the session model'", () => {
		const { settings, problems } = validateSettings({ titleModel: null });
		assert.deepEqual(problems, []);
		assert.equal(settings.titleModel, undefined);
	});

	it("rejects a model ref without a provider or model id", () => {
		for (const bad of ["nodomain", "/no-model", "provider/", 42]) {
			const { problems } = validateSettings({ summaryModel: bad });
			assert.ok(problems.some((p) => p.startsWith("summaryModel:")), `${bad}`);
		}
	});

	it("accepts the documented title strategies and scopes", () => {
		const { settings, problems } = validateSettings({ titleStrategy: "auto", defaultScope: "all" });
		assert.deepEqual(problems, []);
		assert.equal(settings.titleStrategy, "auto");
		assert.equal(settings.defaultScope, "all");
	});

	it("rejects unknown strategy and scope values", () => {
		const { problems } = validateSettings({ titleStrategy: "magic", defaultScope: "everywhere" });
		assert.ok(problems.some((p) => p.startsWith("titleStrategy:")));
		assert.ok(problems.some((p) => p.startsWith("defaultScope:")));
	});

	it("reports unknown keys but keeps the valid ones", () => {
		const { settings, problems } = validateSettings({ summaryModel: "a/b", colour: "blue" });
		assert.equal(settings.summaryModel, "a/b");
		assert.ok(problems.some((p) => p.includes("unknown setting \"colour\"")));
	});

	it("demands a JSON object", () => {
		for (const bad of [null, "string", 42, [], true]) {
			const { problems } = validateSettings(bad);
			assert.ok(problems.some((p) => p.includes("must contain a JSON object")), `${JSON.stringify(bad)}`);
		}
	});
});

describe("load and save", () => {
	it("treats a missing file as empty settings", () => {
		const { settings, problems } = loadSettings(join(dir, "missing.json"));
		assert.deepEqual(settings, {});
		assert.deepEqual(problems, []);
	});

	it("round-trips settings through the file", () => {
		const path = join(dir, "wayfarer.json");
		saveSettings({ summaryModel: "anthropic/claude-haiku-4-5", titleStrategy: "llm" }, path);

		const { settings, problems } = loadSettings(path);
		assert.deepEqual(problems, []);
		assert.equal(settings.summaryModel, "anthropic/claude-haiku-4-5");
		assert.equal(settings.titleStrategy, "llm");
	});

	it("does not write keys left at their default (use the session model)", () => {
		const path = join(dir, "wayfarer.json");
		saveSettings({ summaryModel: undefined, titleModel: "a/b" }, path);
		// Re-read via loadSettings rather than re-implementing the file contract.
		const { settings } = loadSettings(path);
		assert.equal(settings.summaryModel, undefined);
		assert.equal(settings.titleModel, "a/b");
	});

	it("reports a malformed file rather than throwing", () => {
		const path = join(dir, "bad.json");
		writeFileSync(path, "{ this is not json", "utf8");
		const { settings, problems } = loadSettings(path);
		assert.deepEqual(settings, {});
		assert.ok(problems.some((p) => p.startsWith("could not parse")));
	});
});

describe("applySettings and settingsFromConfig", () => {
	it("applies each set field over the config", () => {
		const before = config.summaryModel;
		try {
			applySettings(config, { summaryModel: "a/b", titleStrategy: "auto" });
			assert.equal(config.summaryModel, "a/b");
			assert.equal(config.titleStrategy, "auto");
		} finally {
			config.summaryModel = before;
			config.titleStrategy = "heuristic";
		}
	});

	it("leaves a field untouched when the settings omit it", () => {
		const before = config.titleStrategy;
		try {
			applySettings(config, { summaryModel: "a/b" });
			assert.equal(config.titleStrategy, before);
		} finally {
			config.summaryModel = undefined;
		}
	});

	it("round-trips through settingsFromConfig then applySettings", () => {
		const snapshot = settingsFromConfig(config);
		try {
			applySettings(config, { summaryModel: "x/y", defaultScope: "all" });
			const edited = settingsFromConfig(config);
			assert.equal(edited.summaryModel, "x/y");
			assert.equal(edited.defaultScope, "all");
			// Restore via the snapshot.
			applySettings(config, snapshot);
			assert.equal(config.summaryModel, snapshot.summaryModel);
			assert.equal(config.defaultScope, snapshot.defaultScope);
		} catch (error) {
			applySettings(config, snapshot);
			throw error;
		}
	});
});
