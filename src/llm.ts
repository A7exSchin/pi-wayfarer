/**
 * Shared model-call helper.
 *
 * Extensions make standalone LLM calls via `complete()` from
 * `@earendil-works/pi-ai/compat`, resolving auth through the model registry.
 * This mirrors the pattern in pi's own `qna.ts` / `handoff.ts` examples.
 */

import { complete } from "@earendil-works/pi-ai/compat";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type CompletionResponse, interpretCompletion } from "./llm-response.ts";

// The pi-ai Model type is generic and heavy; we only pass it back to `complete`.
type AnyModel = NonNullable<ExtensionContext["model"]>;

/**
 * Resolve the model to use for a background call.
 *
 * `override` is a "provider/model-id" string. When set and resolvable it wins;
 * otherwise we fall back to the session's currently selected model.
 */
export function resolveModel(ctx: ExtensionContext, override: string | undefined): AnyModel | undefined {
	if (override) {
		const slash = override.indexOf("/");
		if (slash > 0) {
			const provider = override.slice(0, slash);
			const modelId = override.slice(slash + 1);
			const found = ctx.modelRegistry.find(provider, modelId);
			if (found) return found;
		}
	}
	return ctx.model;
}

/**
 * Run a single-shot completion. Returns the text, or null when the call was
 * aborted or the model produced nothing.
 *
 * Throws on auth failure *and* on a failed call: `complete()` resolves rather
 * than rejecting when the provider errors, so without this the caller cannot
 * tell a broken request from an empty answer.
 */
export async function runCompletion(
	ctx: ExtensionContext,
	model: AnyModel,
	systemPrompt: string,
	userText: string,
	signal: AbortSignal | undefined,
): Promise<string | null> {
	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!auth.ok) throw new Error(auth.error);
	if (!auth.apiKey) throw new Error(`No API key for ${model.provider}`);

	const response = await complete(
		model,
		{
			systemPrompt,
			messages: [{ role: "user", content: [{ type: "text", text: userText }], timestamp: Date.now() }],
		},
		{ apiKey: auth.apiKey, headers: auth.headers, env: auth.env, signal },
	);

	return interpretCompletion(response as unknown as CompletionResponse, `${model.provider}/${model.id}`);
}
