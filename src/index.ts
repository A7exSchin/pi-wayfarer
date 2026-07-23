/**
 * Wayfarer — session navigator for the pi coding agent.
 *
 * Features:
 *  - Content-derived session titles (auto, clobber-safe).
 *  - A toggleable left overlay to browse and switch sessions for this folder
 *    (or all folders), with staleness badges derived from `modified`.
 *  - On-demand per-session summaries.
 *
 * Entry points:
 *  - `/wayfarer` command opens the panel (needs command context to switch).
 *  - The toggle shortcut launches the same command via sendUserMessage, which
 *    pi resolves as an extension command without adding a user turn.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { config, type Scope } from "./config.ts";
import { openPanel } from "./panel.ts";
import { showSummary } from "./summary.ts";
import { maybeGenerateTitle, restoreTitleState } from "./titles.ts";

export default function (pi: ExtensionAPI) {
	// --- Auto titles ---------------------------------------------------------
	pi.on("session_start", async (_event, ctx) => {
		restoreTitleState(pi, ctx);
	});

	pi.on("agent_settled", async (_event, ctx) => {
		await maybeGenerateTitle(pi, ctx);
	});

	// --- Panel command -------------------------------------------------------
	pi.registerCommand(config.commandName, {
		description: "Browse, switch, and summarize sessions (Wayfarer)",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("Wayfarer requires interactive mode", "error");
				return;
			}

			let index = 0;
			let scope: Scope = config.defaultScope;

			for (;;) {
				const result = await openPanel(ctx, { initialIndex: index, scope });

				if (result.type === "close") return;

				if (result.type === "switch") {
					const target = result.session.path;
					if (target === ctx.sessionManager.getSessionFile()) {
						ctx.ui.notify("Already in this session", "info");
						return;
					}
					const label = result.session.name?.trim() || "session";
					await ctx.switchSession(target, {
						withSession: async (replacementCtx) => {
							replacementCtx.ui.notify(`Switched to ${label}`, "info");
						},
					});
					return;
				}

				// result.type === "summarize": show it, then reopen the panel where we left off.
				index = result.index;
				scope = result.scope;
				await showSummary(ctx, result.session);
			}
		},
	});

	// --- Toggle shortcut -----------------------------------------------------
	pi.registerShortcut(config.toggleKey, {
		description: "Toggle the Wayfarer session panel",
		handler: (_ctx) => {
			// Shortcut handlers get ExtensionContext (no switchSession), so we route
			// through the command, which runs with full command context.
			pi.sendUserMessage(`/${config.commandName}`);
		},
	});
}
