#!/usr/bin/env node
/**
 * Embed Modern Web Guidance into DeepSeek Harness.
 *
 *   node install.mjs --dry-run     # show every planned action, change nothing
 *   node install.mjs               # apply
 *
 * Two independent layers:
 *   1. skill  — copies `skill/modern-web-guidance/SKILL.md` into a scanned skill
 *               root; the skill provider watches it, so it is live immediately
 *   2. plugin — packs this package, installs it into the DSH profile and appends
 *               it to `dsh.profile.bundles`; the tools appear on the next config
 *               load of the running harness
 *
 * Nothing outside the chosen skill root and the chosen profile is modified, and
 * every write is idempotent. `uninstall.mjs` reverses exactly these steps.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
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
  console.log(`Usage: node install.mjs [options]

  --dry-run          print every planned action and change nothing
  --no-skill         skip the SKILL.md layer
  --no-plugin        skip the cordis plugin layer
  --profile <name>   DSH profile to install into (default: web, then headless)
  --skill-root <dir> skill root to copy into (default: ~/.agents/skills when it
                     exists, else <DSH_HOME>/skills)

Environment:
  DSH_HOME           harness home (default: ~/.dsh)
  PNPM_JS            explicit path to pnpm.js/pnpm.cjs when pnpm is not on PATH`)
  process.exit(0)
}

const dryRun = has('--dry-run')
const withSkill = !has('--no-skill')
const withPlugin = !has('--no-plugin')
const log = (message) => console.log(`${dryRun ? '[dry-run] ' : ''}${message}`)

const dshHome = () => process.env.DSH_HOME || path.join(os.homedir(), '.dsh')

function packageVersion(dir) {
  return JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')).version
}

function resolveProfile() {
  const explicit = opt('--profile')
  const root = path.join(dshHome(), 'profiles')
  const candidates = explicit
    ? [path.join(root, explicit)]
    : [path.join(root, 'web'), path.join(root, 'headless')]
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, 'package.json'))) return candidate
  }
  if (!explicit && existsSync(root)) {
    for (const entry of readdirSync(root)) {
      const candidate = path.join(root, entry)
      if (existsSync(path.join(candidate, 'package.json'))) return candidate
    }
  }
  throw new Error(`No DSH profile found under ${root}. Pass --profile <name> (DSH_HOME=${dshHome()}).`)
}

function resolveSkillRoot() {
  const explicit = opt('--skill-root')
  if (explicit) return path.resolve(explicit)
  const agents = path.join(os.homedir(), '.agents', 'skills')
  // Follow the convention already in use: a populated ~/.agents/skills wins
  // over creating a second ~/.dsh/skills root.
  if (existsSync(agents)) return agents
  return path.join(dshHome(), 'skills')
}

// ---------------------------------------------------------------- skill layer
function installSkill() {
  const root = resolveSkillRoot()
  const target = path.join(root, SKILL_NAME)
  const targetFile = path.join(target, 'SKILL.md')
  const source = path.join(HERE, 'skill', SKILL_NAME, 'SKILL.md')
  if (!existsSync(source)) throw new Error(`shipped skill is missing: ${source}`)
  log(`skill root: ${root}`)
  if (existsSync(targetFile) && readFileSync(targetFile, 'utf8') === readFileSync(source, 'utf8')) {
    log(`skill already installed and identical: ${target}`)
    return { root, changed: false }
  }
  log(`${existsSync(targetFile) ? 'update' : 'copy'} ${source} -> ${targetFile}`)
  if (!dryRun) {
    mkdirSync(target, { recursive: true })
    copyFileSync(source, targetFile)
  }
  return { root, changed: true }
}

// --------------------------------------------------------------- plugin layer
/** Remove tarballs left by earlier versions; only files this installer created. */
function pruneStaleTarballs(staging, keep) {
  if (!existsSync(staging)) return
  for (const entry of readdirSync(staging)) {
    if (entry === keep || !TARBALL.test(entry)) continue
    log(`remove stale tarball ${path.join(staging, entry)}`)
    if (!dryRun) rmSync(path.join(staging, entry), { force: true })
  }
}

function packTarball(staging) {
  const version = packageVersion(HERE)
  const file = path.join(staging, `${PKG_NAME}-${version}.tgz`)
  log(`pnpm pack -> ${staging}  (${PKG_NAME}@${version})`)
  if (!dryRun) {
    mkdirSync(staging, { recursive: true })
    const output = runPnpm(['pack', '--pack-destination', staging], HERE)
    const lastLine = output.trim().split(/\r?\n/).filter(Boolean).pop() ?? ''
    if (!lastLine.endsWith('.tgz')) throw new Error(`pnpm pack printed no tarball name: ${lastLine}`)
    const packed = path.resolve(HERE, lastLine.trim())
    if (!existsSync(packed)) throw new Error(`pnpm pack did not produce ${packed}`)
    if (path.resolve(packed) !== path.resolve(file)) throw new Error(`pnpm pack produced ${packed}, expected ${file}`)
    pruneStaleTarballs(staging, path.basename(file))
  }
  return file
}

/** Keep a pristine copy of the profile manifest before anything touches it. */
function backupManifest(profile) {
  const manifestPath = path.join(profile, 'package.json')
  const backupPath = `${manifestPath}.bak-mwg`
  if (!existsSync(backupPath)) writeFileSync(backupPath, readFileSync(manifestPath, 'utf8'))
  return backupPath
}

function installPlugin() {
  const profile = resolveProfile()
  log(`profile: ${profile}`)
  // The tarball lives inside the profile so the recorded dependency stays
  // relative (`file:./.mwg/...`) instead of pinning an absolute build path.
  const staging = path.join(profile, '.mwg')
  const tarball = packTarball(staging)
  const relative = `./.mwg/${path.basename(tarball)}`
  log(`pnpm add file:${relative}   (cwd ${profile})`)
  if (!dryRun) {
    backupManifest(profile)
    runPnpm(['add', `file:${relative}`], profile)
  }
  return { profile, tarball }
}

function registerBundle(profile) {
  const manifestPath = path.join(profile, 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  manifest.dsh ??= {}
  manifest.dsh.profile ??= {}
  const bundles = (manifest.dsh.profile.bundles ??= [])
  if (bundles.includes(PKG_NAME)) {
    log(`bundle already registered in ${manifestPath}`)
    return false
  }
  bundles.push(PKG_NAME)
  log(`append "${PKG_NAME}" to dsh.profile.bundles in ${manifestPath}`)
  if (!dryRun) {
    backupManifest(profile)
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  }
  return true
}

// ------------------------------------------------------------------- driver
try {
  if (!withSkill && !withPlugin) throw new Error('nothing to do: both --no-skill and --no-plugin were given')

  const result = { dryRun, skill: null, plugin: null }
  if (withSkill) result.skill = installSkill()
  if (withPlugin) {
    result.plugin = installPlugin()
    result.plugin.registered = registerBundle(result.plugin.profile)
  }

  console.log('')
  if (result.skill?.changed) console.log(`✓ skill ready${dryRun ? ' (planned)' : ''} — hot-loaded, no restart needed`)
  if (result.skill && !result.skill.changed) console.log('• skill already current')
  if (result.plugin) {
    console.log(`✓ plugin installed${dryRun ? ' (planned)' : ''} at ${result.plugin.profile}`)
    console.log('  tools: mwg_search / mwg_retrieve / mwg_list / mwg_legacy_scan')
    console.log('  DSH picks a new bundle up on its next config load; restart if the tools do not show up')
  }
  if (dryRun) console.log('\nNothing was changed. Re-run without --dry-run to apply.')
} catch (error) {
  console.error(`\ninstall failed: ${error.message}`)
  process.exit(1)
}
