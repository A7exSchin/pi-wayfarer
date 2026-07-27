/**
 * Tests for endpoint resolution.
 *
 * The case that matters: a GitHub Copilot token scoped to the business plan
 * presented at the individual endpoint answers 421 Misdirected Request.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withResolvedEndpoint } from "../src/llm-target.ts";

const INDIVIDUAL = "https://api.individual.githubcopilot.com";
const BUSINESS = "https://api.business.githubcopilot.com";

describe("withResolvedEndpoint", () => {
	it("applies the credential-resolved endpoint", () => {
		const model = { id: "claude-opus-5", baseUrl: INDIVIDUAL };
		assert.deepEqual(withResolvedEndpoint(model, BUSINESS), { id: "claude-opus-5", baseUrl: BUSINESS });
	});

	it("leaves the model untouched when no endpoint was resolved", () => {
		const model = { id: "gpt-5", baseUrl: INDIVIDUAL };
		assert.equal(withResolvedEndpoint(model, undefined), model, "same object, not a copy");
	});

	it("leaves the model untouched when the endpoint already matches", () => {
		const model = { id: "gpt-5", baseUrl: INDIVIDUAL };
		assert.equal(withResolvedEndpoint(model, INDIVIDUAL), model, "same object, not a copy");
	});

	it("does not mutate the catalogue entry", () => {
		const model = { id: "claude-opus-5", baseUrl: INDIVIDUAL };
		withResolvedEndpoint(model, BUSINESS);
		assert.equal(model.baseUrl, INDIVIDUAL);
	});

	it("preserves every other field of the model", () => {
		const model = { id: "claude-opus-5", baseUrl: INDIVIDUAL, maxTokens: 8192, headers: { "X-Test": "1" } };
		const result = withResolvedEndpoint(model, BUSINESS);
		assert.equal(result.maxTokens, 8192);
		assert.deepEqual(result.headers, { "X-Test": "1" });
	});

	it("ignores an empty resolved endpoint", () => {
		const model = { id: "gpt-5", baseUrl: INDIVIDUAL };
		assert.equal(withResolvedEndpoint(model, ""), model);
	});
});
