/**
 * Bridge to the `modern-web-guidance` CLI.
 *
 * The upstream package ships `skills/modern-web-guidance/modern-web.mjs` as a
 * self-contained CLI (offline BM25 + embedding search over the guide corpus).
 * It is spawned with `process.execPath` — no shell, no npx, no network, ~300 ms
 * warm.
 *
 * Two upstream quirks are absorbed here:
 *   - output above ~9.5 KB is spooled to a temp file and only a pointer is
 *     printed, so the caller must read that file;
 *   - a bad id makes the CLI exit non-zero while it may still print usable
 *     guides, so failures are classified instead of short-circuited.
 */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, unlink } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)

/** Relative path of the CLI inside the npm package. */
const CLI_REL = path.join('skills', 'modern-web-guidance', 'modern-web.mjs')

let lastResolveError

/**
 * Resolve the CLI entry. Order: explicit config → `MWG_CLI` env → the
 * `modern-web-guidance` dependency resolved from this package.
 *
 * Positive results are cached; a miss is re-checked on every call so installing
 * the dependency later does not require a restart.
 * @param {string} [explicit]
 * @returns {string | null}
 */
export function resolveCli(explicit) {
  if (explicit) return existsSync(explicit) ? explicit : null
  const candidates = []
  if (process.env.MWG_CLI) candidates.push(process.env.MWG_CLI)
  try {
    const pkg = require.resolve('modern-web-guidance/package.json')
    candidates.push(path.join(path.dirname(pkg), CLI_REL))
  } catch (error) {
    lastResolveError = error
  }
  return candidates.find((candidate) => candidate && existsSync(candidate)) ?? null
}

/** Diagnostic message for a missing CLI. */
export function cliMissingMessage(explicit) {
  const tail = lastResolveError instanceof Error ? ` (${lastResolveError.code ?? lastResolveError.message})` : ''
  return [
    `modern-web-guidance CLI not found${tail}.`,
    explicit ? `Configured cliPath does not exist: ${explicit}` : '',
    'Fix: `pnpm add modern-web-guidance` in the DSH profile, or set `cliPath` / `MWG_CLI`.',
  ]
    .filter(Boolean)
    .join(' ')
}

function abortError() {
  const error = new Error('The operation was aborted')
  error.name = 'AbortError'
  error.code = 'ABORT_ERR'
  return error
}

/**
 * Run one CLI command.
 * @param {string} cli
 * @param {string[]} args
 * @param {{ cwd?: string, timeoutMs?: number, signal?: AbortSignal, telemetry?: boolean }} [options]
 */
export function runCli(cli, args, options = {}) {
  const { cwd, timeoutMs = 60_000, signal, telemetry = false } = options
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [cli, ...args],
      {
        cwd: cwd || process.cwd(),
        timeout: timeoutMs,
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true,
        signal,
        env: {
          ...process.env,
          ...(telemetry ? {} : { DISABLE_TELEMETRY: '1' }),
        },
      },
      (error, stdout, stderr) => {
        const out = String(stdout ?? '')
        const err = String(stderr ?? '')
        if (error) {
          // Cancellation and unusable executables are not "command results".
          if (error.code === 'ABORT_ERR' || error.name === 'AbortError') {
            reject(abortError())
            return
          }
          if (error.code === 'ENOENT' || error.code === 'EACCES' || error.code === 'EPERM') {
            reject(Object.assign(error, { stderr: err }))
            return
          }
          // `timeout` kills the child: killed, signalled, and no exit code.
          if (error.code === null && (error.killed || error.signal)) {
            reject(new Error(`modern-web-guidance ${args[0]} did not finish within ${timeoutMs} ms`))
            return
          }
        }
        resolve({ stdout: out, stderr: err, code: error?.code ?? 0, failed: Boolean(error) })
      },
    )
  })
}

/** Turn a failed CLI run into one clean, model-facing line (no stack, no paths). */
function commandError(result, fallback) {
  const text = `${result.stderr || ''}\n${result.stdout || ''}`.trim()
  const firstLine = text.split(/\r?\n/).map((line) => line.trim()).find(Boolean)
  const stripped = (firstLine || '').replace(/^Error:\s*/, '')
  // A JSON body says nothing useful as a one-line message.
  const cleaned = stripped && stripped !== '{' && stripped !== '[' ? stripped : `${fallback} (exit ${result.code})`
  return new Error(cleaned.slice(0, 400))
}

/** Parse the JSON array emitted by `search` / `list`. */
function parseGuideList(stdout, label) {
  const text = stdout.trim()
  if (!text) return []
  try {
    const value = JSON.parse(text)
    if (!Array.isArray(value)) throw new Error('not an array')
    return value
      .filter((entry) => entry && typeof entry.id === 'string')
      .map((entry) => ({ id: entry.id, description: String(entry.description ?? '') }))
  } catch (error) {
    throw new Error(`${label} returned malformed JSON: ${error.message}`)
  }
}

/** `search <query>` → `[{ id, description }]`. */
export async function searchGuides(cli, query, options = {}) {
  const result = await runCli(cli, ['search', query], options)
  if (result.failed) throw commandError(result, 'search failed')
  const guides = parseGuideList(result.stdout, 'search')
  if (!guides.length && result.stderr.trim()) throw new Error(result.stderr.trim().split(/\r?\n/)[0])
  return guides
}

/** `list` → every guide id with its description. */
export async function listGuides(cli, options = {}) {
  const result = await runCli(cli, ['list'], options)
  if (result.failed) throw commandError(result, 'list failed')
  return parseGuideList(result.stdout, 'list')
}

const SEPARATOR = /^--- Guide for (.+?) ---$/gm
const SPILL = /saved to (.+?) to prevent CLI stdout truncation/s
const FAILED_ID = /Retrieve failed for ([^:\r\n]+):/g

/** Read the spool file the CLI writes for large output, then remove it. */
async function readSpill(text) {
  const spill = SPILL.exec(text)
  if (!spill) return null
  const spillPath = spill[1].trim()
  try {
    return await readFile(spillPath, 'utf8')
  } catch (error) {
    throw new Error(`retrieve spooled its output to ${spillPath} but it could not be read: ${error.message}`)
  } finally {
    unlink(spillPath).catch(() => {})
  }
}

/**
 * `retrieve <ids>` → `{ guides, missing }`.
 *
 * The CLI may fail on one unknown id while still emitting the guides it found
 * (into stdout or a spool file), so usable output wins over the exit status:
 * only a run that produced no guide section at all throws.
 */
export async function retrieveGuides(cli, ids, options = {}) {
  const requested = ids.map((id) => id.trim()).filter(Boolean)
  if (!requested.length) throw new Error('retrieve requires at least one guide id')

  const result = await runCli(cli, ['retrieve', requested.join(',')], options)
  const failedIds = [...`${result.stdout}\n${result.stderr}`.matchAll(FAILED_ID)]
    .map((match) => match[1].trim())
    .filter(Boolean)

  const body = (await readSpill(result.stdout)) ?? result.stdout
  const matches = [...body.matchAll(SEPARATOR)]

  if (!matches.length) {
    if (failedIds.length) {
      throw new Error(`no guide with id "${failedIds[0]}" — retrieve only ids returned by mwg_search`)
    }
    if (result.failed) throw commandError(result, 'retrieve failed')
    throw new Error('retrieve returned no guide sections')
  }

  const guides = matches.map((match, index) => {
    const start = match.index + match[0].length
    const end = index + 1 < matches.length ? matches[index + 1].index : body.length
    return { id: match[1].trim(), markdown: body.slice(start, end).trim() }
  })

  const found = new Set(guides.map((guide) => guide.id))
  const missing = requested.filter((id) => !found.has(id))
  for (const id of failedIds) if (!missing.includes(id) && !found.has(id)) missing.push(id)
  return { guides, missing }
}

/**
 * `legacy-scan [path] --json` → `{ report, raw, warning }`.
 *
 * A scan can exit non-zero after it has already printed a complete JSON report
 * (an unreadable file, a locked directory), and it can also fail before any
 * JSON exists. The report shape belongs to the CLI and is passed through
 * untouched; only unusable output raises.
 */
export async function legacyScan(cli, target, options = {}) {
  const result = await runCli(cli, ['legacy-scan', target, '--json'], options)
  const text = result.stdout.trim()

  if (text.startsWith('{')) {
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = null
    }
    if (parsed && typeof parsed === 'object' && ('totalFindings' in parsed || 'targetDir' in parsed)) {
      return {
        report: parsed,
        raw: text,
        warning: result.failed
          ? `legacy-scan exited ${result.code} after printing this report; treat the result as possibly incomplete.`
          : '',
      }
    }
    if (parsed && typeof parsed === 'object' && (parsed.error || parsed.message)) {
      throw new Error(String(parsed.error ?? parsed.message).slice(0, 400))
    }
  }

  if (result.failed) throw commandError(result, 'legacy-scan failed')
  if (!text) throw new Error('legacy-scan produced no output')
  return { report: null, raw: text, warning: '' }
}
