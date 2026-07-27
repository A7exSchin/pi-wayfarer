/**
 * Interpretation of a completion response.
 *
 * Split out from `llm.ts` because that module imports `complete()` from
 * `@earendil-works/pi-ai` at runtime, which cannot resolve outside a pi install
 * — and this is exactly the logic that needs tests. It is where a provider error
 * was silently reported as an empty answer.
 */

/**
 * The part of pi-ai's `AssistantMessage` we depend on. Structural on purpose, so
 * the tests need no pi installation.
 *
 * Note `stream().result()` *resolves* on an error event rather than rejecting
 * (`pi-ai/utils/event-stream.js`), so an API failure arrives here as a normal
 * response carrying `stopReason: "error"` and `errorMessage`.
 */
export interface CompletionResponse {
	stopReason: "stop" | "length" | "toolUse" | "error" | "aborted";
	content: readonly { type: string; text?: string }[];
	errorMessage?: string;
}

/**
 * Extract the assistant's text.
 *
 * Returns `null` when the call was aborted or the model genuinely produced
 * nothing, and throws when the call failed — callers can then show a real
 * message instead of guessing.
 */
export function interpretCompletion(response: CompletionResponse, label: string): string | null {
	if (response.stopReason === "aborted") return null;

	if (response.stopReason === "error") {
		throw new Error(response.errorMessage?.trim() || `${label} returned an error without a message`);
	}

	const text = response.content
		.filter((block): block is { type: "text"; text: string } => block.type === "text" && typeof block.text === "string")
		.map((block) => block.text)
		.join("\n")
		.trim();

	if (text.length > 0) return text;

	// No text and no error. Separate the one case with a real explanation: a
	// thinking model can spend the whole output budget before writing an answer.
	if (response.stopReason === "length") {
		throw new Error(`${label} hit the output token limit before producing any text`);
	}

	return null;
}
