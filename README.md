# Wayfarer

A session navigator extension for the [pi coding agent](https://github.com/earendil-works/pi-mono).

It improves pi's session management with:

- **Content-derived titles** — sessions get a concise title generated from the
  recent conversation, instead of showing your first (sometimes throwaway)
  prompt. Titles are regenerated as the session grows and never overwrite a name
  you set yourself with `/name`.
- **A session panel** — a centred overlay listing sessions for
  the current folder (or all folders), with **stale** badges derived from each
  session's last-modified time.
- **Switch** to any session with `Enter`.
- **Summarize** the highlighted session with `s` — a compact markdown recap
  generated on demand, without leaving the panel.
- **Purge** stale sessions — in bulk with `/wf purge`, or one at a time with `d`
  in the panel. Purged sessions go to a recoverable bin, not straight to
  deletion.

> pi's TUI is single-column, so the panel is an **overlay** rendered on top of
> the transcript — not a persistent side-by-side dock (the terminal can't do a
> true split here).

## Install

Wayfarer imports pi's own runtime packages (`@earendil-works/pi-coding-agent`,
`pi-tui`, `pi-ai`) as peer dependencies — the host provides them, so there is
nothing to install.

The latest release is **v0.6.0**. Releases are git tags; there is no npm
package.

### Install a specific version (recommended)

```bash
pi install git:github.com/A7exSchin/pi-wayfarer@v0.6.0
```

The ref is **pinned**. `pi update --extensions` re-fetches that exact tag and
resets the clone to it — it will never move you to a newer release. This is the
reproducible choice, and the right one for project settings shared with a team.

To change version later — upgrade *or* downgrade — re-run install with the new
tag:

```bash
pi install git:github.com/A7exSchin/pi-wayfarer@v0.5.2   # move to another tag
```

### Always install the latest (track `main`)

```bash
pi install git:github.com/A7exSchin/pi-wayfarer
```

Omitting the ref clones the repository's default branch. Because no ref is
pinned, `pi update --extensions` resolves the clone's upstream branch and resets
to its newest commit — so you follow `main` continuously.

This includes unreleased work. Use it if you want fixes immediately and can
tolerate breakage; use a tag otherwise.

### Updating

| Command | Pinned to a tag | Tracking `main` |
|---|---|---|
| `pi update --extensions` | re-resets the clone to the **same** tag | fast-forwards to the newest `main` commit |
| `pi update git:github.com/A7exSchin/pi-wayfarer` | same, for this package only | same, for this package only |
| `pi update --all` | as above, **and** updates the pi CLI itself | as above, and updates pi |
| `pi install …@v0.6.0` | moves the pin to that tag | replaces tracking with a pin |

```bash
pi list                                          # show installed packages
pi remove git:github.com/A7exSchin/pi-wayfarer   # uninstall
```

All of these write to user settings (`~/.pi/agent/settings.json`) by default.
Add `-l` to `install`/`remove` to use project settings (`.pi/settings.json`)
instead; pi installs missing project packages automatically once the project is
trusted.

### Try it without installing

```bash
pi -e git:github.com/A7exSchin/pi-wayfarer          # latest main, this run only
pi -e git:github.com/A7exSchin/pi-wayfarer@v0.6.0   # a specific tag, this run only
```

Installs to a temporary directory and is discarded when pi exits.

### From a local clone (development)

Clone the repo, then from inside the working copy:

```bash
pi install .        # references this directory in settings (not copied)
# or, without installing, for the current run only:
pi -e .
```

After changes, run `/reload` inside pi to pick them up.

> While iterating, prefer the local install over a git pin: local paths are
> referenced, not copied, so `/reload` sees every edit. Remove the git entry
> first — package identity is the repo URL for git and the absolute path for
> local, so both would load and register `/wayfarer` twice:
>
> ```bash
> pi remove git:github.com/A7exSchin/pi-wayfarer
> pi install ~/GitLib/pi-wayfarer
> ```

### Releases

| Tag | Contents |
|---|---|
| `v0.6.0` | `,` opens a settings overlay; summary/title model and strategy persist to `wayfarer.json`; panel is centred and keeps a minimum height |
| `v0.5.2` | `c` copies an overlay; requests use the credential-resolved endpoint (fixes Copilot 421) |
| `v0.5.1` | Provider errors are reported instead of being shown as empty results |
| `v0.5.0` | `/wf purge` + `/wf restore`, recoverable bin, `d` key in the panel |
| `v0.4.0` | `/wf retitle` and `/wf retitle all`; session-directory fix |
| `v0.3.0` | Deterministic titles with confidence scoring, language packs |
| `v0.2.1` | Panel stale-row colour fix, larger overlay |
| `v0.2.0` | Command-only panel with the `/wf` alias |
| `v0.1.1` | Declared `@earendil-works/*` peer dependencies |
| `v0.1.0` | Initial release |

Tags are created by CI when `version` in `package.json` changes on `main`
(`.github/workflows/release.yml`), and follow SemVer as derived from
[Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/).

## Usage

Open the panel with the `/wayfarer` command (or its shorthand `/wf`):

| Action | How |
|--------|-----|
| Open the panel | `/wayfarer` or `/wf` |
| Navigate | `↑` / `↓` |
| Switch to selected session | `Enter` |
| Summarize selected session | `s` |
| Copy summary / plan to clipboard | `c` (in the overlay) |
| Move selected session to the bin | `d` |
| Open settings | `,` |
| Toggle folder ↔ all sessions | `t` |
| Close | `Esc` |
| Retitle the current session | `/wf retitle` |
| Retitle stored sessions | `/wf retitle all` |
| Purge stale sessions | `/wf purge` |
| Restore a purged session | `/wf restore` |
| Open settings | `,` in the panel |

### Settings

Press `,` in the panel to open the settings overlay. Changes are written to
`~/.pi/agent/wayfarer.json` (honouring `PI_CODING_AGENT_DIR`) and applied to the
running session immediately — no `/reload` needed, and they survive one.

| Setting | Values |
|---|---|
| Summary model | the session's current model, or any available `provider/model-id` |
| Title model | same; used by the `llm` and `auto` strategies |
| Title strategy | `heuristic` · `llm` · `auto` |
| Default scope | `folder` · `all` |

The two model rows open a searchable picker — cycling through dozens of models
with arrow keys would be unusable. Everything else here stays editable in
`config.ts`; the JSON is a validated overlay over those defaults, and unknown
keys or bad values are reported once and ignored rather than reverting silently.

### Purging stale sessions

```bash
/wf purge                   # sessions in this folder older than `purgeDays`
/wf purge --days 30         # override the age threshold
/wf purge --empty           # near-empty sessions, any age
/wf purge --global          # every project                        (-g)
/wf purge --dry-run         # show the plan, delete nothing        (-n)
/wf purge --force           # include sessions you named by hand   (-f)
/wf purge --permanent       # bypass the bin and delete outright
/wf restore                 # put a binned session back
```

The plan — what would go, how old, how many messages, how much disk — is always
shown before anything moves, and applying it asks for confirmation.

**Nothing is destroyed on the day you purge.** Sessions are *moved* into
`<session-dir>/.wayfarer-trash/`, which pi never lists (`SessionManager.list`
reads `*.jsonl` non-recursively, so a nested directory is invisible). A move
within one directory is an atomic rename — no copy, no half-written file. Entries
older than `purgeRetentionDays` are deleted for real at the start of the next
purge run, via the `trash` CLI when available, exactly as pi's own `/resume`
deletion does.

What a purge deliberately keeps:

| Kept | Why |
|---|---|
| The session pi has open | Deleting the file you are writing to |
| Sessions modified in the last 5 minutes | They may belong to another running pi |
| Sessions you named by hand | A name is intent (`--force` opts in) |
| Sessions another session forked from | Deleting a parent orphans its forks |

A name written by Wayfarer's own titler does **not** protect a session — it is
recognised by the `wayfarer-title` marker entry and treated as auto-generated.
Without that, running `/wf retitle all` would make every session permanently
unpurgeable.

`purgeDays` is separate from `staleDays` on purpose: the latter only drives the
panel's badge, and a visual hint makes a poor threshold for destroying data.


Titles are normally generated as you work, which leaves sessions from before you
installed Wayfarer unnamed. `retitle` fixes that after the fact:

```bash
/wf retitle                 # name the current session now, ignoring the throttle
/wf retitle --dry-run       # show what it would be named, write nothing
/wf retitle all             # unnamed sessions in this folder
/wf retitle all --global    # unnamed sessions in every project
/wf retitle all --dry-run   # show the plan, write nothing
/wf retitle all --force     # also replace names you set by hand
/wf retitle all --llm       # use titleStrategy instead of the free heuristic
```

Short forms: `-g`, `-n`, `-f`. The plan is always shown before anything is
written, and a batch run asks for confirmation.

What a batch run deliberately leaves alone:

| Skipped | Why |
|---|---|
| The session pi has open | Two `SessionManager` instances on one file would diverge |
| Sessions modified in the last 5 minutes | They may belong to another running pi |
| Sessions that already have a name | Your names are not ours to overwrite (`--force` opts in) |
| Sessions with no derivable title | Better unnamed than named "Model" |

Batch runs use the **free heuristic** regardless of `titleStrategy`: `auto` over
a few hundred sessions would be a few hundred model calls from one keystroke.
`--llm` opts in explicitly.

Writes go through pi's public `SessionManager.open()` / `appendSessionInfo()`
API — no `.jsonl` files are edited by hand. Listing and writing both honour
`pi --session-dir <dir>` and `PI_CODING_AGENT_SESSION_DIR`, so pointing pi at a
copy of your sessions is a safe way to try this out:

```bash
cp -a ~/.pi/agent/sessions/--Users-you-project-- /tmp/wf-trial
cd ~/project && pi -e /path/to/pi-wayfarer --session-dir /tmp/wf-trial
```

Two caveats worth knowing: renaming cannot be undone (the old name stays in the
session history, but nothing surfaces it), and opening a pre-v3 session migrates
it, so a batch run may rewrite old session files as a side effect.

To see what would happen without starting pi at all, use the evaluator:
`npm run eval` prints the proposed title, score and reasons for every session.

The panel is a command rather than a keyboard shortcut on purpose: switching
sessions requires command context, which pi grants only to command handlers —
shortcut handlers cannot switch sessions, and `sendUserMessage` bypasses command
handling. To open the panel with a keystroke, bind pi's built-in
`app.session.resume` in `keybindings.json` for the native picker, or type `/wf`.

Auto-titling happens in the background when pi finishes responding. By default
it is **deterministic and free** — no model call — deriving a title from the
files you touched and keyphrases from your prompts (RAKE). Set `titleStrategy`
to `llm` for model-generated titles, or `auto` to use the heuristic and fall
back to the model only when the heuristic signal is weak.

## Configuration

All knobs live in [`src/config.ts`](src/config.ts):

| Setting | Default | Meaning |
|---------|---------|---------|
| `commandName` | `wayfarer` | Primary command name |
| `aliasNames` | `["wf"]` | Extra command names (shorthands) |
| `summaryKey` | `s` | Summarize selected (in panel) |
| `scopeKey` | `t` | Toggle folder ↔ all (in panel) |
| `deleteKey` | `d` | Move selected session to the bin (in panel) |
| `settingsKey` | `,` | Open the settings overlay (in panel) |
| `copyKey` | `c` | Copy the overlay's contents to the clipboard |
| `staleDays` | `7` | Older-than-this (by `modified`) → stale badge |
| `defaultScope` | `folder` | `folder` = current dir, `all` = every project |
| `purgeDays` | `90` | `/wf purge` age threshold (not the badge threshold) |
| `purgeRetentionDays` | `30` | How long the bin keeps a session before real deletion |
| `purgeMaxMessages` | `2` | What `--empty` counts as near-empty |
| `titleStrategy` | `heuristic` | `heuristic` (free) · `llm` · `auto` (heuristic, LLM fallback) |
| `language` | `"en"` | Language pack id, or a `LanguagePack` object (see below) |
| `titleConfidenceThreshold` | `2` | Score at which `auto` trusts the heuristic and skips the model |
| `titleModel` | `undefined` | `"provider/model-id"`, or current model if unset (`llm`/`auto` only) |
| `titleFirstAtTurn` | `2` | First title after N assistant turns |
| `titleRefreshEveryTurns` | `3` | Re-title cadence afterwards |
| `titleMaxChars` | `6000` | Conversation budget sent for titling |
| `maxTitleLength` | `60` | Title length cap |
| `summaryModel` | `undefined` | Falls back to `titleModel`, then current model |
| `summaryMaxChars` | `24000` | Session-text budget sent for summaries |

After editing, run `/reload` in pi (or restart).

## How it works (notes)

- Titles: on `agent_settled`, throttled by assistant-turn count.
  - `heuristic` (default): deterministic RAKE keyphrases from user prompts +
    weighted file basenames from `write`/`edit`/`read` tool calls; no model call.
    Candidate phrases are delimited by stopwords *and* punctuation/line breaks,
    so a phrase never straddles a sentence or message boundary. Hex identifiers
    (`66cd5b598c`) and `snake_case` names pasted from code or logs are dropped,
    as is conversational filler ("sounds good", "perfect").
  - Phrases are ranked by `rakeScore / len^0.5 * (1 + log2(recurrence))`, not by
    the raw RAKE score. RAKE sums word scores, so long rare phrases win by
    construction — on a 43-session corpus the raw top phrase was of maximal
    length in 40 of 43. Length damping plus recurrence weighting raised
    independent file-name corroboration from 9% to 14% of sessions and turned
    titles like `6f1bd239 7a26 4b48 870f` into `Receiver Supports Hdcp 2.2`.
  - `llm` / `auto`: model call via `setSessionName()`; `auto` only calls the
    model when the heuristic result scores below `titleConfidenceThreshold`.
  - Confidence is an additive score, and every contribution is reported in
    `reasons` so the decision (which controls spend in `auto` mode) is auditable:

    | Contribution | Δ |
    |---|---|
    | phrase recurs across ≥3 / ≥6 distinct user messages | +1 / +2 |
    | phrase names one of the 3 most-touched files | +2 |
    | top phrase outranks the runner-up by ≥1.5× | +1 |
    | phrase consists only of generic action verbs | −2 |
    | fewer than 12 content tokens in the whole session | −2 |

    Phrase *length* is deliberately not rewarded: it fired on 40 of 43 real
    sessions, making it a constant offset rather than evidence. The recurrence
    bars are high because ranking already maximises recurrence.
  - A `custom` session entry records our last auto-title so a human-set `/name`
    is detected and never clobbered, surviving reloads.
- Panel: `SessionManager.list(cwd, sessionDir)` / `listAll()` for the two scopes;
  the session directory comes from the running context, so a custom
  `--session-dir` is respected. Staleness is derived from `SessionInfo.modified`.
  Selection returns to the command handler, which owns `switchSession`.
- Purge: sessions are renamed into `<session-dir>/.wayfarer-trash/` with an
  append-only `manifest.jsonl` recording origin, name and timestamp, so
  `/wf restore` can put them back exactly. Real deletion happens only when an
  entry outlives `purgeRetentionDays`.
- Summary: uses `SessionInfo.allMessagesText` (already collected for the
  picker), so it never re-opens the session file.
- Overlays: summaries, plans and errors all render through one scrollable
  markdown view. `c` copies the **source** markdown via pi's `copyToClipboard`,
  which falls back to OSC 52 over SSH — so what you paste is unwrapped and free
  of ANSI codes.

## Adding a language

The titler is language-neutral — the tokenizer handles any Unicode script — but
the word lists are not. Everything language-specific lives in `src/lang/` as
plain data:

```typescript
// src/lang/de.ts
import type { LanguagePack } from "./types.ts";

export const german: LanguagePack = {
  id: "de",
  name: "Deutsch",
  stopwords: ["der", "die", "das", "und", "bitte", "jetzt", "passt", /* … */],
  genericActions: ["mach", "machen", "ändere", "prüfe", "zeige", /* … */],
  minorWords: ["der", "die", "das", "von", "zu", /* … */],
};
```

Register it and select it:

```typescript
import { registerLanguage } from "./lang/index.ts";
import { german } from "./lang/de.ts";

registerLanguage(german);        // call once at load time
config.language = "de";          // or: config.language = german
```

`config.language` accepts a registered id *or* a pack object directly, so a
third party can supply a language without touching the registry. An unknown id
is reported once per session via a TUI notification and titling falls back to
English — it is never silently ignored.

What each list does:

| Field | Effect |
|---|---|
| `stopwords` | Delimit RAKE candidate phrases; a phrase never contains one. Include conversational filler ("ok", "sounds", "perfect") — phrases are ranked by recurrence, and filler recurs constantly |
| `genericActions` | Verbs that describe an action but never a topic. Allowed in a title, but a phrase made only of them is penalised and they never count towards recurrence |
| `minorWords` | Left lowercase by title casing unless they lead. Only has an effect for words that are *not* also stopwords (`via`, `per`, `vs`) |

Check your pack against real sessions:

```bash
node test/evaluate-sessions.ts --language de
```

## Tests

```bash
npm test          # unit tests (titler, language packs, retitle, purge, bin)
npm run eval      # replay your own sessions through the titler, read-only
```

TypeScript is stripped at load, so there is no build step and no dev
dependencies. `npm run eval` reads `~/.pi/agent/sessions/**/*.jsonl` and prints,
per session, the title the heuristic would produce, its confidence score and
reasons, plus the aggregate `auto` fallback rate — use it to pick
`titleConfidenceThreshold` for your own usage instead of trusting the default.

```
node test/evaluate-sessions.ts --threshold 3 --dir /path/to/sessions --quiet
```

## Type checking

The `@earendil-works/*` packages are peer dependencies resolved at runtime from
the host pi install and are not vendored here. To type-check locally, install a
matching pi as a dev dependency (`npm install -D @earendil-works/pi-coding-agent`)
or map the packages via `tsconfig` `paths`.

## License

MIT
