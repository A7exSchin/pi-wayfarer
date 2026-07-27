/**
 * Session listing that respects where sessions actually live.
 *
 * `pi --session-dir <dir>` and `PI_CODING_AGENT_SESSION_DIR` relocate session
 * storage. `SessionManager.list()` falls back to the *default* directory when it
 * is not told otherwise, so every listing must pass the session directory of the
 * running context — otherwise we would read, and worse, write, the wrong store.
 */

import type { ExtensionContext, SessionInfo } from "@earendil-works/pi-coding-agent";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { Scope } from "./config.ts";

/**
 * `usesDefaultSessionDir()` exists on SessionManager but is outside the
 * `ReadonlySessionManager` pick that extensions receive. Feature-detect it
 * rather than casting to the full class: if a future pi drops it, we fall back
 * to the default behaviour instead of breaking.
 */
type DefaultDirAware = { usesDefaultSessionDir?: () => boolean };

/** True when sessions live somewhere other than the default location. */
export function usesCustomSessionDir(ctx: ExtensionContext): boolean {
	const manager = ctx.sessionManager as ExtensionContext["sessionManager"] & DefaultDirAware;
	return manager.usesDefaultSessionDir?.() === false;
}

/**
 * List sessions for the given scope, newest first.
 *
 * Folder scope always passes the session directory: when it equals the default
 * for this cwd, `list()` behaves exactly as before, so this is safe either way.
 * Global scope only passes it when the directory is custom — a custom directory
 * is a flat store, so "all projects" collapses to "everything in that store".
 */
export async function listSessions(ctx: ExtensionContext, scope: Scope): Promise<SessionInfo[]> {
	const dir = ctx.sessionManager.getSessionDir();

	const sessions =
		scope === "folder"
			? await SessionManager.list(ctx.cwd, dir)
			: usesCustomSessionDir(ctx)
				? await SessionManager.listAll(dir)
				: await SessionManager.listAll();

	return [...sessions].sort((a, b) => b.modified.getTime() - a.modified.getTime());
}
