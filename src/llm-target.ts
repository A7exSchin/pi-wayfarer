/**
 * Endpoint resolution for standalone model calls.
 *
 * Some providers derive their endpoint from the credential rather than from the
 * model catalogue. GitHub Copilot is the clearest case: the account plan decides
 * whether requests go to `api.individual.`, `api.business.` or
 * `api.enterprise.githubcopilot.com`, and the endpoint is encoded in the token
 * (`pi-ai/auth/oauth/github-copilot.js` → `toAuth()` returns a per-credential
 * `baseUrl`). Presenting a token at the wrong endpoint answers
 * `421 Misdirected Request`.
 *
 * `ModelRegistry.getApiKeyAndHeaders()` returns only `{ apiKey, headers, env }`,
 * so a caller that stops there sends requests to the catalogue default. The
 * resolved endpoint comes from `getProviderAuth()` instead.
 *
 * Kept separate from `llm.ts` so it can be tested: that module imports pi-ai at
 * runtime and cannot load outside a pi install.
 */

/** The part of a pi-ai `Model` this module touches. */
export interface Endpoint {
	baseUrl: string;
}

/**
 * Return the model to call, with the credential-resolved endpoint applied.
 *
 * The original object is returned untouched when the endpoint matches or none
 * was resolved, so providers with a static endpoint keep their catalogue entry.
 */
export function withResolvedEndpoint<T extends Endpoint>(model: T, resolvedBaseUrl: string | undefined): T {
	if (!resolvedBaseUrl || resolvedBaseUrl === model.baseUrl) return model;
	return { ...model, baseUrl: resolvedBaseUrl };
}
