/**
 * Locate and run pnpm without relying on `pnpm.cmd` being spawnable.
 *
 * Node refuses to spawn `.cmd` files without a shell (EINVAL), and a shell
 * invocation of the corepack shim breaks `%~dp0` in some shells. So the shim is
 * resolved to the JavaScript entry it wraps and that entry is run with the
 * current `node` — identical behavior on Windows and POSIX, no shell involved.
 *
 * Overrides: `PNPM_JS` (path to pnpm.js / pnpm.cjs) or `PNPM_BIN`.
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

/** JS entry points a pnpm shim may wrap, relative to the shim's directory. */
const SHIM_ENTRIES = [
  ['node_modules', 'corepack', 'dist', 'pnpm.js'],
  ['node_modules', 'pnpm', 'bin', 'pnpm.cjs'],
  ['node_modules', 'pnpm', 'bin', 'pnpm.js'],
]

function shimDirectories() {
  const dirs = new Set()
  try {
    const finder = process.platform === 'win32' ? 'where' : 'which'
    const output = execFileSync(finder, ['pnpm'], { encoding: 'utf8' })
    for (const line of output.split(/\r?\n/)) {
      const entry = line.trim()
      if (entry) dirs.add(path.dirname(entry))
    }
  } catch {
    // pnpm not on PATH; resolvePnpm falls back to the bare name.
  }
  return [...dirs]
}

/** @returns {{ js?: string, bin?: string }} */
export function resolvePnpm() {
  const forced = process.env.PNPM_JS
  if (forced && existsSync(forced)) return { js: forced }
  if (process.env.PNPM_BIN) return { bin: process.env.PNPM_BIN }
  for (const dir of shimDirectories()) {
    for (const entry of SHIM_ENTRIES) {
      const candidate = path.join(dir, ...entry)
      if (existsSync(candidate)) return { js: candidate }
    }
  }
  return { bin: process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm' }
}

/** Run pnpm and return stdout; throws with stderr on a non-zero exit. */
export function runPnpm(args, cwd) {
  const resolved = resolvePnpm()
  if (resolved.js) {
    return String(execFileSync(process.execPath, [resolved.js, ...args], { cwd, encoding: 'utf8' }) ?? '')
  }
  try {
    return String(execFileSync(resolved.bin, args, { cwd, encoding: 'utf8' }) ?? '')
  } catch (error) {
    if (process.platform !== 'win32' || error.code !== 'EINVAL') {
      const detail = String(error.stderr ?? '').trim().split(/\r?\n/).slice(-3).join(' ')
      throw new Error(`pnpm ${args[0]} failed: ${detail || error.message}`)
    }
    const line = [resolved.bin, ...args].map((part) => `"${String(part)}"`).join(' ')
    try {
      return String(execFileSync(line, { cwd, encoding: 'utf8', shell: true }) ?? '')
    } catch (shellError) {
      const detail = String(shellError.stderr ?? '').trim().split(/\r?\n/).slice(-3).join(' ')
      throw new Error(`pnpm ${args[0]} failed: ${detail || shellError.message}`)
    }
  }
}
