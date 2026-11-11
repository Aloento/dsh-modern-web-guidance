/**
 * dsh-modern-web-guidance — exposes the Modern Web Guidance corpus
 * (GoogleChrome/modern-web-guidance) as native DSH tools.
 *
 * Upstream ships a skill plus a self-contained CLI; a skill alone forces every
 * lookup through bash. This plugin keeps the same corpus and the same protocol
 * but registers `mwg_search` / `mwg_retrieve` / `mwg_list` / `mwg_legacy_scan`
 * so a lookup is one typed tool call (~300 ms, offline, no npx, no network).
 */
import os from 'node:os'
import path from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { cliMissingMessage, legacyScan, listGuides, resolveCli, retrieveGuides, searchGuides } from './bridge.js'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'dsh-modern-web-guidance'

/** Services required by this plugin. */
export const inject = ['tools']

const DEFAULTS = {
  enabled: true,
  injectPrompt: true,
  cliPath: '',
  cwd: '',
  timeoutMs: 60_000,
  cacheTtlMs: 300_000,
  maxRetrieveChars: 120_000,
  telemetry: false,
}

/** Cordis hands `apply` either a reactive config accessor or a plain object. */
function readConfig(raw) {
  const value = raw && typeof raw.get === 'function' ? raw.get() : raw
  return { ...DEFAULTS, ...(value && typeof value === 'object' ? value : {}) }
}

/**
 * Working directory for one call: the session workspace when the harness
 * exposes it, then explicit config, then the process cwd.
 *
 * This matters: the harness process cwd is the user's home directory, so a
 * scan of "." without this would walk the whole home tree.
 */
function sessionCwd(exec, config) {
  const candidates = []
  try {
    candidates.push(exec?.agent?.meta?.cwd, exec?.agent?.cwd)
  } catch {
    // Some Agent implementations expose meta through throwing getters.
  }
  candidates.push(config.cwd, process.cwd())
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length > 0) return candidate
  }
  return process.cwd()
}

const PROMPT_SECTION = `## Modern Web Guidance（mwg_* 工具）

涉及 HTML / CSS / 浏览器端 JS 的**实现或修改**时，先查再写，不要凭记忆手搓：

1. \`mwg_search\` —— 2–5 个词、只描述**一个** Web 平台能力（\`light dismiss dialog\`、\`responsive table\`、\`dark mode\`）。查询里不要放框架名（React/Vue/Tailwind）、产品名或组件文件名；把用户意图翻译成 UI 原语（"删之前先确认" → \`confirmation dialog\`）。
2. 描述对得上就 \`mwg_retrieve\` 取全文（可一次传多个 id）；再连同它所属学科总纲（html / css / forms / accessibility / performance / security）一起取。
3. 代码写完后对照指南自检：该用的现代 API 与必要回退是否到位，同时不硬塞用户没要的特性。
4. 回复末尾加 \`### Modern Web Guidance\` 小节：每条真正用上的指南一行，给出 guide id、一句非显然实现选择的说明、以及该指南中一条规则的原话短引用；一条都没用上就一句话说明查过什么、为何不适用。

纯后端（SQL/ORM/API）、脚本与基建（CI/Docker/Actions/Python/Go）、构建工具配置（Vite/tsconfig/ESLint）**不要**用本工具。只有"全库级旧模式审计/现代化改造"才用 \`mwg_legacy_scan\`，并且**必须显式传项目路径**。`

/** Tool-facing descriptions are English: trigger reliability beats locale here. */
const DESC_SEARCH =
  'Search the Modern Web Guidance corpus (208 expert-curated guides on modern HTML/CSS/client-side JS, Baseline-aware). ' +
  'Call this BEFORE writing or changing any web UI, CSS layout/animation, or client-side JS (dialogs, popovers, tables, forms, ' +
  'dark mode, anchor positioning, container queries, view transitions, scroll-driven animation, validation, accessibility, ' +
  'scrollbars, CWV/LCP/INP, image/fetch priority, sanitization, web components, dates/timezones, built-in AI). ' +
  'Query rule: 2-5 words, ONE platform capability, no framework or product names. Returns candidate guide ids; ' +
  'if a description matches, call mwg_retrieve next instead of mwg_list. Not for backend, infra, or build tooling.'

const DESC_RETRIEVE =
  'Retrieve the full text of Modern Web Guidance guides by id (comma-joined ids allowed). ' +
  'Call after mwg_search returns matching ids; also fetch the discipline overview guide that applies ' +
  '(html, css, forms, accessibility, color, performance, security). Returns verbatim guide markdown with code patterns, ' +
  'gotchas, and required fallbacks. Unknown ids are reported as `missing`, not fatal.'

const DESC_LIST =
  'List every id in the Modern Web Guidance corpus with a one-line description. ' +
  'Use only for broad UI audits or when multiple mwg_search rephrasings returned nothing; never as a substitute for mwg_retrieve.'

const DESC_SCAN =
  'Scan a project directory for legacy web platform patterns (deterministic rules over ~20% of the guidance corpus) and return ' +
  'findings grouped by guide with keepWhen/dropWhen rubrics. Only for open-ended, codebase-wide modernization audits - not for ' +
  'adding, fixing, or reviewing one specific feature or component. Always pass `path`: the project root, never the home directory.'

/** Render helper: `- id: description` lines, truncated per line. */
function bulletLines(entries, width = 200) {
  return entries
    .map((entry) => {
      const text = (entry.description || '').replace(/\s+/g, ' ').trim()
      return `- ${entry.id}: ${text.length > width ? text.slice(0, width - 1) + '…' : text}`
    })
    .join('\n')
}

/** Flatten a legacy-scan report into a compact, capped model-facing value. */
function summarizeScan(report, target) {
  const guides = Array.isArray(report?.guides) ? report.guides : []
  const totals = guides.map((guide) => ({
    guideId: String(guide.guideId ?? ''),
    count: Number(guide.count ?? 0),
    rules: Array.isArray(guide.rules) ? guide.rules.length : 0,
  }))
  const findings = []
  for (const guide of guides) {
    for (const rule of Array.isArray(guide.rules) ? guide.rules : []) {
      for (const finding of Array.isArray(rule.findings) ? rule.findings : []) {
        findings.push({
          guideId: String(guide.guideId ?? ''),
          file: String(finding.file ?? ''),
          line: Number(finding.line ?? 0),
          message: String(finding.message ?? ''),
        })
      }
    }
  }
  return {
    target: String(report?.targetDir ?? target),
    totalFindings: Number(report?.totalFindings ?? findings.length),
    guides: totals,
    findings,
    note: String(report?.note ?? ''),
  }
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {unknown} rawConfig
 */
export function apply(ctx, rawConfig) {
  const config = readConfig(rawConfig)
  if (!config.enabled) return

  const cache = new Map()

  /** Resolve the CLI or fail with an actionable message. */
  function requireCli() {
    const resolved = resolveCli(config.cliPath || undefined)
    if (!resolved) throw new Error(cliMissingMessage(config.cliPath || undefined))
    return resolved
  }

  /** Per-call options; `cwd` follows the session workspace so `.mwgrc` is found. */
  function optionsFor(exec) {
    return {
      cwd: sessionCwd(exec, config),
      timeoutMs: config.timeoutMs,
      telemetry: config.telemetry,
      signal: exec?.signal,
    }
  }

  /** TTL cache for pure lookups; a miss costs a process spawn. */
  async function cached(key, produce) {
    const ttl = Number(config.cacheTtlMs) || 0
    if (ttl > 0) {
      const hit = cache.get(key)
      if (hit && Date.now() - hit.at < ttl) return hit.value
    }
    const value = await produce()
    if (ttl > 0) {
      cache.set(key, { at: Date.now(), value })
      if (cache.size > 200) cache.delete(cache.keys().next().value)
    }
    return value
  }

  ctx.inject(['tools'], (sctx) => {
    sctx.tools.register(
      defineTool({
        name: 'mwg_search',
        description: DESC_SEARCH,
        parameters: {
          query: { type: 'string', required: true, description: '2-5 words naming one web platform capability or UI pattern' },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              query: { type: 'string' },
              matches: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: { id: { type: 'string' }, description: { type: 'string' } },
                },
              },
            },
          },
          render(_args, value) {
            if (!value.matches.length) {
              return [
                {
                  type: 'text',
                  text:
                    `No guide matched "${value.query}". Rephrase once with the concrete HTML/CSS/UI noun ` +
                    '(dialog, modal, popover, table, form, scrollbar) or proceed without guidance; do not call mwg_list for a single feature.',
                },
              ]
            }
            return [
              {
                type: 'text',
                text: `Guides for "${value.query}" — call mwg_retrieve with the ids that match:\n${bulletLines(value.matches)}`,
              },
            ]
          },
        },
        async execute(args, exec) {
          const query = String(args.query ?? '').trim()
          if (!query) throw new Error('query must not be empty')
          const matches = await cached(`search:${query}`, () => searchGuides(requireCli(), query, optionsFor(exec)))
          return { query, matches }
        },
      }),
    )

    sctx.tools.register(
      defineTool({
        name: 'mwg_retrieve',
        description: DESC_RETRIEVE,
        parameters: {
          ids: {
            type: 'array',
            required: true,
            items: { type: 'string' },
            description: 'Guide ids returned by mwg_search; include the discipline overview guide when relevant',
          },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              guides: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: { id: { type: 'string' }, markdown: { type: 'string' } },
                },
              },
              missing: { type: 'array', items: { type: 'string' } },
            },
          },
          render(_args, value) {
            const budget = Number(config.maxRetrieveChars) || 0
            let remaining = budget
            const parts = []
            let truncated = false
            for (const guide of value.guides) {
              const block = `--- ${guide.id} ---\n\n${guide.markdown}`
              if (budget > 0 && block.length > remaining) {
                truncated = true
                parts.push(`--- ${guide.id} ---\n\n[omitted: output budget ${budget} chars reached; retrieve this id alone]`)
                continue
              }
              remaining -= block.length
              parts.push(block)
            }
            if (value.missing.length) {
              parts.push(`Unknown guide id(s): ${value.missing.join(', ')}. Re-run mwg_search; do not invent ids.`)
            }
            const text = parts.join('\n\n')
            return [
              {
                type: 'text',
                text:
                  (truncated ? '[partially truncated]\n' : '') +
                  'Guidance corpus content (follow it; cite the specific rule you applied):\n\n' +
                  text,
              },
            ]
          },
        },
        async execute(args, exec) {
          const ids = (Array.isArray(args.ids) ? args.ids : [args.ids])
            .map((id) => String(id ?? '').trim())
            .filter(Boolean)
          if (!ids.length) throw new Error('ids must contain at least one guide id')
          const options = optionsFor(exec)
          const result = await cached(`retrieve:${options.cwd}:${ids.join(',')}`, () =>
            retrieveGuides(requireCli(), ids, options),
          )
          return { guides: result.guides, missing: result.missing }
        },
      }),
    )

    sctx.tools.register(
      defineTool({
        name: 'mwg_list',
        description: DESC_LIST,
        parameters: {},
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              count: { type: 'number' },
              guides: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: { id: { type: 'string' }, description: { type: 'string' } },
                },
              },
            },
          },
          render(_args, value) {
            return [
              {
                type: 'text',
                text: `${value.count} guides available:\n${bulletLines(value.guides, 120)}`,
              },
            ]
          },
        },
        async execute(_args, exec) {
          const guides = await cached('list', () => listGuides(requireCli(), optionsFor(exec)))
          return { count: guides.length, guides }
        },
      }),
    )

    sctx.tools.register(
      defineTool({
        name: 'mwg_legacy_scan',
        description: DESC_SCAN,
        parameters: {
          path: {
            type: 'string',
            description: 'Project directory to scan, relative to the session workspace or absolute. Pass the project root.',
          },
          full: { type: 'boolean', description: 'Return the complete raw scan report instead of the capped summary' },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              target: { type: 'string' },
              totalFindings: { type: 'number' },
              guides: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    guideId: { type: 'string' },
                    count: { type: 'number' },
                    rules: { type: 'number' },
                  },
                },
              },
              findings: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    guideId: { type: 'string' },
                    file: { type: 'string' },
                    line: { type: 'number' },
                    message: { type: 'string' },
                  },
                },
              },
              omittedFindings: { type: 'number' },
              note: { type: 'string' },
              report: { type: 'string' },
            },
          },
          render(_args, value) {
            if (!value.totalFindings) {
              return [
                {
                  type: 'text',
                  text: `Legacy scan of ${value.target}: no findings. ${value.note}`.trim(),
                },
              ]
            }
            const lines = [
              `Legacy scan of ${value.target}: ${value.totalFindings} finding(s) across ${value.guides.length} guide(s).`,
              'Verify each against its keepWhen/dropWhen rubric before editing, and note that legacy-scan covers only the ~20% of guides with deterministic rules.',
              '',
              ...value.guides.map((guide) => `- ${guide.guideId}: ${guide.count} finding(s)`),
            ]
            if (value.findings.length) {
              lines.push('', 'Top findings:')
              for (const finding of value.findings) {
                lines.push(`- [${finding.guideId}] ${finding.file}:${finding.line} — ${finding.message}`)
              }
            }
            if (value.omittedFindings > 0) {
              lines.push('', `(${value.omittedFindings} more omitted; call again with full: true for the raw report.)`)
            }
            if (value.report) lines.push('', '```json', value.report, '```')
            return [{ type: 'text', text: lines.join('\n') }]
          },
        },
        async execute(args, exec) {
          const options = optionsFor(exec)
          const requested = String(args.path ?? '').trim()
          const target = requested ? path.resolve(options.cwd, requested) : options.cwd

          // The harness process cwd is the user's home directory: scanning it by
          // accident costs minutes and returns noise from unrelated installs.
          if (!requested && path.resolve(target) === path.resolve(os.homedir())) {
            throw new Error(
              'mwg_legacy_scan needs an explicit path: the session workspace is the home directory, ' +
                'and scanning it would walk every unrelated file on this machine. Pass the project root, e.g. path: "C:/code/my-app".',
            )
          }

          const result = await legacyScan(requireCli(), target, options)
          const summary = summarizeScan(result.report, target)
          const full = args.full === true
          const cap = full ? Number.POSITIVE_INFINITY : 15
          const findings = summary.findings.slice(0, cap)
          return {
            target: summary.target,
            totalFindings: summary.totalFindings,
            guides: summary.guides,
            findings,
            omittedFindings: Math.max(0, summary.findings.length - findings.length),
            note: [summary.note, result.warning].filter(Boolean).join(' '),
            ...(full ? { report: result.raw.slice(0, Number(config.maxRetrieveChars) || 120_000) } : {}),
          }
        },
      }),
    )
  })

  if (config.injectPrompt) {
    ctx.inject(['systemPrompt'], (sctx) => {
      sctx.systemPrompt.section({ name: 'modern-web-guidance', order: 480, text: PROMPT_SECTION })
    })
  }
}
