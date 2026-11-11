# dsh-modern-web-guidance

Bring [Modern Web Guidance](https://github.com/GoogleChrome/modern-web-guidance) — Google Chrome's expert-curated web platform corpus — into [DeepSeek Harness](https://github.com/deepseek-ai) as native tools and a skill.

[中文文档](README.zh-CN.md)

```
mwg_search      →  candidate guide ids for "light dismiss dialog"
mwg_retrieve    →  the full guide, code patterns, gotchas, fallbacks
mwg_list        →  every id in the corpus
mwg_legacy_scan →  legacy patterns across a codebase
```

Everything runs **offline**: no API key, no network, no telemetry, ~310 ms per lookup.

---

## Why

Coding agents write legacy web code because the training data is mostly legacy web code: a JavaScript focus trap for a modal that `<dialog>` already handles, a `scroll` listener for a reveal that `animation-timeline: view()` does natively, a polyfill for something that has been Baseline for two years.

Modern Web Guidance is 208 retrievable guides (250 platform features) maintained by the Chrome, Edge, Firefox and MDN teams, each written as *"do it with the platform, here is the fallback you actually need"*, with real Baseline compatibility data. Upstream evaluations (2026-11-08 snapshot, unguided → guided):

| Agent / model | Pass rate |
|---|---|
| antigravity_cli (gemini-4-argon) | 58% → 94% |
| codex_cli (gpt-6.1-sol) | 54% → 82% |
| claude_code (opus-5-5) | 57% → 88% |

This project turns that corpus into first-class DSH capabilities instead of a shell-out per question.

## Install

### Option A — as a DSH plugin (recommended)

**One command** (packs this repo, installs it into your DSH profile, registers the bundle, and copies the skill):

```sh
git clone https://github.com/Aloento/dsh-modern-web-guidance.git
cd dsh-modern-web-guidance
node install.mjs --dry-run   # see exactly what will change
node install.mjs
```

**Or by hand:**

```sh
cd "$DSH_HOME/profiles/web"          # or headless
pnpm add github:Aloento/dsh-modern-web-guidance
```

then append the package to `dsh.profile.bundles` in that profile's `package.json`:

```json
{
  "dsh": { "profile": { "bundles": ["...", "dsh-modern-web-guidance"] } }
}
```

The package ships its own `cordis.patch.yml`, so no patch has to be written by hand.

### Option B — skill only

Copy [`skill/modern-web-guidance/SKILL.md`](skill/modern-web-guidance/SKILL.md) into a skill root DSH scans:

| Root | Priority |
|---|---|
| `<project>/.dsh/skills` | 100 |
| `<project>/.agents/skills` | 200 |
| `~/.dsh/skills` | 400 |
| `~/.agents/skills` | 500 |

The skill provider watches these directories, so the skill appears without a restart. Without the plugin, the skill shells out to the CLI:

```sh
npx -y modern-web-guidance@latest search "light dismiss dialog"
```

### Option C — any other agent

Upstream ships installers for Claude Code, Codex, Cursor, Gemini, Kimi, Grok and friends:

```sh
npx modern-web-guidance@latest install
```

## Usage

### The tools

| Tool | Arguments | Returns |
|---|---|---|
| `mwg_search` | `query` (2–5 words) | `[{ id, description }]`, ranked |
| `mwg_retrieve` | `ids: string[]` | verbatim guide markdown for each id, plus `missing` |
| `mwg_list` | — | every id with a one-line description |
| `mwg_legacy_scan` | `path?`, `full?` | findings grouped by guide, capped at 15; `full: true` adds the raw report |

### Query discipline

The search index is small and intent-shaped; queries that read like prompts do badly.

| You want | Search for |
|---|---|
| a confirmation step before deleting | `confirmation dialog` |
| a drawer that slides in | `navigation drawer` |
| a table usable on a phone | `responsive data table` |
| an animated list reorder | `dynamic sort animation` |
| a page-to-page transition | `view transition between pages` |
| form errors announced correctly | `accessible error announcement` |

- **2–5 words, one capability.** Not `dialog`, not `responsive table dark mode`.
- **No framework, product or file names.** Not `close React settings modal on outside click`.
- **Name the UI primitive, not the business intent.** "confirm first" → `confirmation dialog`.
- If a description matches, call `mwg_retrieve` — do not also call `mwg_list`. If the result is empty, rephrase once with the concrete noun, then proceed without guidance.

### Workflow

1. `mwg_search` before writing any UI, CSS layout/animation or client-side JS.
2. `mwg_retrieve` the matching ids, **plus** the discipline overview that applies (`html`, `css`, `forms`, `accessibility`, `color`, `performance`, `security`).
3. Implement, cross-checking the guide's patterns and fallbacks.
4. End the reply with a `### Modern Web Guidance` section: one line per guide actually applied — the id, a non-obvious choice, and a short verbatim quote of the rule.

### Codebase-wide audits

Only for open-ended modernization, never for "fix this one component". **Always pass the project root** — the tool refuses to scan the home directory by accident:

```sh
npx -y modern-web-guidance@latest legacy-scan . --json
```

Verify each finding against its `keepWhen` / `dropWhen` rubric — the scan covers the ~20% of guides that have deterministic rules.

## Configuration

```yaml
- id: modern-web-guidance
  name: dsh-modern-web-guidance
  config:
    enabled: true          # mount the plugin at all
    injectPrompt: true     # add the mwg_* routing section to the system prompt
    telemetry: false       # false → DISABLE_TELEMETRY=1 for the CLI
    cwd: ''                # CLI working directory; where .mwgrc is looked up
    cliPath: ''            # override the resolved CLI entry (env MWG_CLI works too)
    timeoutMs: 60000       # per CLI invocation
    cacheTtlMs: 300000     # search/list/retrieve cache; 0 disables
    maxRetrieveChars: 120000
```

### Experimental features

Origin Trial and volatile (single-engine, shipped in the last three months) guides are hidden from `retrieve` by default. Opt in per project with a `.mwgrc` at the project root:

```json
{ "allowOriginTrials": true, "allowVolatileFeatures": true }
```

## How it works

```
DSH agent
  │  mwg_search / mwg_retrieve / mwg_legacy_scan
  ▼
lib/index.js      cordis plugin — defineTool registrations + prompt section
  │
  ▼
lib/bridge.js     spawns `node <modern-web-guidance>/skills/.../modern-web.mjs`
  │               TTL cache · output-spool recovery · error normalisation
  ▼
modern-web-guidance (npm, 17 MB, self-contained)
  offline BM25 + embedding search over 208 guides
```

Two upstream behaviours are absorbed rather than exposed:

- **Large output is spooled.** Above ~9.5 KB the CLI writes a temp file and prints only a pointer; the bridge reads it, returns the content and deletes the file.
- **Exit codes lie.** An unknown id exits non-zero while still emitting the guides it found. Usable output wins: only a run with no guide section at all raises.

Telemetry from the upstream CLI (install counts, agent name, retrieved ids, search terms — never raw prompts) is disabled by default via `DISABLE_TELEMETRY=1`.

## Requirements

- Node.js ≥ 22
- DSH `>= 0.2.1-rc.2 < 0.4.0-0`
- Disk: ~9 MB for the guide corpus

## Troubleshooting

| Symptom | Fix |
|---|---|
| Tools never appear | Check the bundle is in `dsh.profile.bundles` and the package is in the profile's `node_modules`; restart the harness |
| `modern-web-guidance CLI not found` | `pnpm add modern-web-guidance` in the profile, or set `cliPath` / `MWG_CLI` |
| `mwg_retrieve` returns `missing` | The id was not real — re-run `mwg_search`; never invent ids |
| Empty `mwg_search` | Rephrase once with the concrete UI noun (`dialog`, `popover`, `table`, `form`) |
| Skill shows, tools do not | That is Option B — expected; the skill drives the CLI through bash |
| `pnpm` fails during install | On Windows the installer already bypasses `pnpm.cmd`; if pnpm lives elsewhere, set `PNPM_JS` |

## Uninstall

```sh
node uninstall.mjs            # drops this repo's bundle entry, package and skill copy
node uninstall.mjs --dry-run  # preview
```

A `SKILL.md` you edited after installing is left in place. Nothing else on disk is touched.

## Development

```sh
pnpm install
pnpm test          # 14 offline checks against a mock cordis context
```

Layout:

```
lib/index.js               plugin entry: config, tools, prompt section
lib/bridge.js              CLI process bridge, spool handling, error cleaning
skill/modern-web-guidance  SKILL.md for the skill-only path
cordis.patch.yml           bundle patch (inserts the plugin row)
scripts/pnpm.mjs           cross-platform pnpm invocation
install.mjs / uninstall.mjs
test/verify.mjs            offline checks
```

## Attribution and license

- **This repository** — MIT. See [LICENSE](LICENSE).
- **Upstream guides** (`modern-web-guidance`) — code under Apache-2.0, guide content under [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/), partly derived from MDN, W3C, WHATWG and IETF material. See [NOTICE](NOTICE).
- **Not affiliated with or endorsed by Google.** This is an independent integration; the corpus, the CLI and the skill text originate in `GoogleChrome/modern-web-guidance`.
- `SKILL.md` here is an adapted copy of the upstream skill, adjusted for DSH conventions (Windows runner, offline CLI path, model-facing tool names).
