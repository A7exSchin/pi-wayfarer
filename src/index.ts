/**
 * Wayfarer — session navigator for the pi coding agent.
 *
 * Features:
 *  - Content-derived session titles (auto, clobber-safe).
 *  - A session panel (left overlay) to browse and switch sessions for this
 *    folder (or all folders), with staleness badges derived from `modified`.
 *  - On-demand per-session summaries.
 *
 * Entry point: the `/wayfarer` command (alias `/wf`). Switching sessions
 * requires command context, which is why the panel is a command rather than a
 * keyboard shortcut — pi does not grant shortcut handlers session-switch
 * capability, and `sendUserMessage` bypasses command handling.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { config, type Scope } from "./config.ts";
import { openPanel } from "./panel.ts";
import { parseRetitleArgs } from "./retitle.ts";
import { runRetitle } from "./retitle-run.ts";
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
	const handler = async (args: string, ctx: ExtensionCommandContext): Promise<void> => {
		if (ctx.mode !== "tui") {
			ctx.ui.notify("Wayfarer requires interactive mode", "error");
			return;
		}

		// `/wf retitle [all] [flags]` — anything else opens the panel.
		const parsed = parseRetitleArgs(args);
		if (parsed) {
			if (!parsed.ok) {
				ctx.ui.notify(`${parsed.error}. Usage: /${config.commandName} retitle [all] [--global] [--force] [--dry-run] [--llm]`, "error");
				return;
			}
			await runRetitle(pi, ctx, parsed.args);
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
	};

	pi.registerCommand(config.commandName, {
		description: "Browse, switch, summarize sessions; `retitle [all]` to rename (Wayfarer)",
		handler,
	});

	for (const alias of config.aliasNames) {
		pi.registerCommand(alias, {
			description: `Alias for /${config.commandName}`,
			handler,
		});
	}
}
