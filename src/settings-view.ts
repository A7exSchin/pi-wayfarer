/**
 * The `/wf` settings overlay.
 *
 * Built on pi's `SettingsList`: plain values cycle in place, and the two model
 * rows open a searchable `SelectList` submenu — cycling through dozens of models
 * with the arrow keys would be unusable.
 *
 * Every change is written to the settings file immediately and applied to the
 * live config, so it takes effect without a reload and survives one.
 */

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { getSelectListTheme, getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import { type SelectItem, SelectList, type SettingItem, SettingsList, truncateToWidth } from "@earendil-works/pi-tui";
import { config } from "./config.ts";
import { applySettings, saveSettings, settingsFromConfig, type WayfarerSettings } from "./settings.ts";

/** Theme surface we rely on, matching the markdown overlay. */
interface ViewTheme {
	fg(color: string, text: string): string;
	bold(text: string): string;
}

/** Shown for a model setting that follows the session's current model. */
const SESSION_MODEL = "(session model)";

const MAX_VISIBLE = 10;
const SUBMENU_VISIBLE = 12;

/** Available models as "provider/model-id", with the session-model option first. */
function modelChoices(ctx: ExtensionCommandContext): SelectItem[] {
	const models = ctx.modelRegistry
		.getAvailable()
		.map((model) => ({ value: `${model.provider}/${model.id}`, label: `${model.provider}/${model.id}`, description: model.name }))
		.sort((a, b) => a.value.localeCompare(b.value));

	return [{ value: SESSION_MODEL, label: SESSION_MODEL, description: "Use whichever model the session is using" }, ...models];
}

/** `undefined` means "follow the session model". */
function toStored(value: string): string | undefined {
	return value === SESSION_MODEL ? undefined : value;
}

function toDisplay(value: string | undefined): string {
	return value ?? SESSION_MODEL;
}

/**
 * Show the settings overlay. Resolves when the user closes it; any change has
 * already been saved by then.
 */
export async function showSettings(ctx: ExtensionCommandContext): Promise<void> {
	const settings: WayfarerSettings = settingsFromConfig(config);
	const choices = modelChoices(ctx);

	const modelSubmenu = (currentValue: string, done: (selected?: string) => void) => {
		const list = new SelectList(choices, SUBMENU_VISIBLE, getSelectListTheme());
		const index = choices.findIndex((choice) => choice.value === currentValue);
		if (index >= 0) list.setSelectedIndex(index);
		list.onSelect = (item) => done(item.value);
		list.onCancel = () => done(undefined);
		return list;
	};

	const items: SettingItem[] = [
		{
			id: "summaryModel",
			label: "Summary model",
			description: "Model used by the session summary",
			currentValue: toDisplay(settings.summaryModel),
			submenu: modelSubmenu,
		},
		{
			id: "titleModel",
			label: "Title model",
			description: "Model used when titling with the llm or auto strategy",
			currentValue: toDisplay(settings.titleModel),
			submenu: modelSubmenu,
		},
		{
			id: "titleStrategy",
			label: "Title strategy",
			description: "heuristic: free and deterministic · llm: always ask the model · auto: ask only when the heuristic is weak",
			currentValue: settings.titleStrategy ?? config.titleStrategy,
			values: ["heuristic", "llm", "auto"],
		},
		{
			id: "defaultScope",
			label: "Default scope",
			description: "Which sessions the panel lists when it opens",
			currentValue: settings.defaultScope ?? config.defaultScope,
			values: ["folder", "all"],
		},
	];

	await ctx.ui.custom<void>(
		(tui, theme, _keybindings, done) => {
			const viewTheme = theme as unknown as ViewTheme;
			const list = new SettingsList(
				items,
				MAX_VISIBLE,
				getSettingsListTheme(),
				(id, newValue) => {
					switch (id) {
						case "summaryModel":
							settings.summaryModel = toStored(newValue);
							break;
						case "titleModel":
							settings.titleModel = toStored(newValue);
							break;
						case "titleStrategy":
							settings.titleStrategy = newValue as WayfarerSettings["titleStrategy"];
							break;
						case "defaultScope":
							settings.defaultScope = newValue as WayfarerSettings["defaultScope"];
							break;
						default:
							return;
					}

					list.updateValue(id, newValue);
					applySettings(config, settings);
					try {
						saveSettings(settings);
					} catch (error) {
						ctx.ui.notify(
							`Could not save settings: ${error instanceof Error ? error.message : String(error)}`,
							"error",
						);
					}
					tui.requestRender();
				},
				() => done(),
		);

			return {
				// Frame the list like every other overlay: rule + title + rule, then the
				// SettingsList body (which ends in its own hint line), then a closing rule.
				render: (width) => {
					const rule = viewTheme.fg("border", "─".repeat(width));
					const title = truncateToWidth(viewTheme.fg("accent", viewTheme.bold("Wayfarer · settings")), width);
					return [rule, title, rule, ...list.render(width), rule];
				},
				handleInput: (data) => {
					list.handleInput(data);
					tui.requestRender();
				},
				invalidate: () => list.invalidate(),
			};
		},
		{ overlay: true, overlayOptions: { anchor: "center", width: "60%", minWidth: 44, maxHeight: "80%" } },
	);
}
