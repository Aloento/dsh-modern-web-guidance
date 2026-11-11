#!/usr/bin/env node
/**
 * Reverse install.mjs — removes only what the installer added.
 *
 *   node uninstall.mjs --dry-run
 *   node uninstall.mjs
 *
 * A skill file that no longer matches the shipped copy is left alone (it was
 * edited after install). The bundle entry is dropped from `dsh.profile.bundles`,
 * the package is removed from the profile, and the staged tarballs are deleted.
 */
import { existsSync, readFileSync, readdirSync, rmSync, rmdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runPnpm } from './scripts/pnpm.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PKG_NAME = 'dsh-modern-web-guidance'
const SKILL_NAME = 'modern-web-guidance'
const TARBALL = new RegExp(`^${PKG_NAME}-\\d+\\.\\d+\\.\\d+(?:-[\\w.]+)?\\.tgz$`)

const argv = process.argv.slice(2)
const has = (flag) => argv.includes(flag)
const opt = (flag, fallback) => {
  const index = argv.indexOf(flag)
  const value = index >= 0 ? argv[index + 1] : undefined
  return value && !value.startsWith('--') ? value : fallback
}

if (has('-h') || has('--help')) {
  console.log(`Usage: node uninstall.mjs [options]

  --dry-run          print every planned action and change nothing
  --no-skill         keep the SKILL.md layer
  --no-plugin        keep the cordis plugin layer
  --profile <name>   DSH profile to clean (default: web, then headless)
  --skill-root <dir> skill root that holds modern-web-guidance

Environment:
  DSH_HOME           harness home (default: ~/.dsh)`)
  process.exit(0)
}

const dryRun = has('--dry-run')
const withSkill = !has('--no-skill')
const withPlugin = !has('--no-plugin')
const log = (message) => console.log(`${dryRun ? '[dry-run] ' : ''}${message}`)

const dshHome = () => process.env.DSH_HOME || path.join(os.homedir(), '.dsh')

function profileDir() {
  const explicit = opt('--profile')
  const root = path.join(dshHome(), 'profiles')
  if (explicit) return path.join(root, explicit)
  for (const name of ['web', 'headless']) {
    if (existsSync(path.join(root, name, 'package.json'))) return path.join(root, name)
  }
  if (existsSync(root)) {
    for (const entry of readdirSync(root)) {
      const candidate = path.join(root, entry)
      if (existsSync(path.join(candidate, 'package.json'))) return candidate
    }
  }
  throw new Error(`No DSH profile found under ${root}; pass --profile <name>.`)
}

function skillDir() {
  const explicit = opt('--skill-root')
  if (explicit) return path.join(path.resolve(explicit), SKILL_NAME)
  const agents = path.join(os.homedir(), '.agents', 'skills', SKILL_NAME)
  if (existsSync(agents)) return agents
  return path.join(dshHome(), 'skills', SKILL_NAME)
}

function removeSkill() {
  const target = skillDir()
  const installed = path.join(target, 'SKILL.md')
  if (!existsSync(installed)) {
    console.log('• skill not installed')
    return
  }
  const shipped = path.join(HERE, 'skill', SKILL_NAME, 'SKILL.md')
  const same = existsSync(shipped) && readFileSync(installed, 'utf8') === readFileSync(shipped, 'utf8')
  if (!same) {
    console.log(`• kept ${target}: SKILL.md was modified after install, not removing it`)
    return
  }
  log(`remove ${target}`)
  if (!dryRun) rmSync(target, { recursive: true, force: true })
}

function removePlugin() {
  const profile = profileDir()
  const manifestPath = path.join(profile, 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const bundles = manifest?.dsh?.profile?.bundles ?? []
  if (bundles.includes(PKG_NAME)) {
    manifest.dsh.profile.bundles = bundles.filter((entry) => entry !== PKG_NAME)
    log(`drop "${PKG_NAME}" from dsh.profile.bundles in ${manifestPath}`)
    if (!dryRun) writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  } else {
    console.log('• bundle not registered')
  }

  log(`pnpm remove ${PKG_NAME}   (cwd ${profile})`)
  if (!dryRun) {
    try {
      runPnpm(['remove', PKG_NAME], profile)
    } catch (error) {
      // Not a dependency (installed by hand, or already removed) — keep going.
      console.log(`  (pnpm remove skipped: ${String(error.message).split(/\r?\n/)[0]})`)
    }
  }

  const staging = path.join(profile, '.mwg')
  if (existsSync(staging)) {
    for (const entry of readdirSync(staging)) {
      if (!TARBALL.test(entry)) continue
      log(`remove staged tarball ${path.join(staging, entry)}`)
      if (!dryRun) rmSync(path.join(staging, entry), { force: true })
    }
    if (!dryRun && readdirSync(staging).length === 0) rmdirSync(staging)
  }
}

try {
  if (!withSkill && !withPlugin) throw new Error('nothing to do: both --no-skill and --no-plugin were given')
  if (withSkill) removeSkill()
  if (withPlugin) removePlugin()
  console.log('')
  console.log(`✓ done${dryRun ? ' (planned)' : ''} — the tools disappear on the next config load of the harness`)
} catch (error) {
  console.error(`\nuninstall failed: ${error.message}`)
  process.exit(1)
}
