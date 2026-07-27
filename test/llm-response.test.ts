/**
 * Tests for completion-response interpretation.
 *
 * This is where a provider error was silently reported as "the model returned an
 * empty summary": `complete()` resolves on an error event instead of rejecting,
 * so the failure arrives as an ordinary response with no text.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type CompletionResponse, interpretCompletion } from "../src/llm-response.ts";

const LABEL = "anthropic/claude-opus-5";

function response(over: Partial<CompletionResponse> = {}): CompletionResponse {
	return { stopReason: "stop", content: [{ type: "text", text: "A Title" }], ...over };
}

describe("interpretCompletion", () => {
	it("returns the joined text of all text blocks", () => {
		const result = interpretCompletion(
			response({ content: [{ type: "text", text: "first" }, { type: "text", text: "second" }] }),
			LABEL,
		);
		assert.equal(result, "first\nsecond");
	});

	it("ignores thinking and tool-call blocks", () => {
		const result = interpretCompletion(
			response({
				content: [
					{ type: "thinking", text: undefined },
					{ type: "toolCall" },
					{ type: "text", text: "  the answer  " },
				],
			}),
			LABEL,
		);
		assert.equal(result, "the answer");
	});

	it("returns null when the call was aborted", () => {
		assert.equal(interpretCompletion(response({ stopReason: "aborted", content: [] }), LABEL), null);
	});

	it("returns null when the model genuinely produced nothing", () => {
		assert.equal(interpretCompletion(response({ stopReason: "stop", content: [] }), LABEL), null);
	});

	it("throws the provider's message when the call failed", () => {
		// The regression: this used to fall through to "no text" and be reported
		// as an empty answer.
		assert.throws(
			() =>
				interpretCompletion(
					response({ stopReason: "error", content: [], errorMessage: "401 invalid x-api-key" }),
					LABEL,
				),
			/401 invalid x-api-key/,
		);
	});

	it("throws a usable message when the provider reports an error without one", () => {
		assert.throws(
			() => interpretCompletion(response({ stopReason: "error", content: [], errorMessage: "   " }), LABEL),
			/anthropic\/claude-opus-5 returned an error without a message/,
		);
	});

	it("prefers the error over any partial text", () => {
		assert.throws(
			() =>
				interpretCompletion(
					response({ stopReason: "error", content: [{ type: "text", text: "half a" }], errorMessage: "overloaded" }),
					LABEL,
				),
			/overloaded/,
		);
	});

	it("explains an empty response that ran out of output tokens", () => {
		// A thinking model can spend the whole budget before writing an answer.
		assert.throws(
			() => interpretCompletion(response({ stopReason: "length", content: [] }), LABEL),
			/hit the output token limit/,
		);
	});

	it("keeps text that stopped at the token limit", () => {
		const result = interpretCompletion(
			response({ stopReason: "length", content: [{ type: "text", text: "truncated" }] }),
			LABEL,
		);
		assert.equal(result, "truncated");
	});
});
