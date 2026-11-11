/**
 * Offline verification for the plugin: mounts `apply` against a mock Cordis
 * context, then executes every registered tool against the real CLI.
 *
 *   node test/verify.mjs            # run all checks
 *   node test/verify.mjs --json     # machine-readable summary
 */
import os from 'node:os'
import * as plugin from '../lib/index.js'

const jsonOut = process.argv.includes('--json')
const checks = []
function check(name, ok, detail) {
  checks.push({ name, ok, detail })
}

const registered = new Map()
const sections = []

function subContext(deps) {
  const sub = { tools: {}, systemPrompt: {} }
  for (const dep of deps) {
    if (dep === 'tools') {
      sub.tools.register = (definition) => {
        registered.set(definition.name, definition)
        return () => registered.delete(definition.name)
      }
    }
    if (dep === 'systemPrompt') {
      sub.systemPrompt.section = (options) => {
        sections.push(options)
        return () => {}
      }
    }
  }
  return sub
}

const ctx = {
  inject(deps, callback) {
    callback(subContext(deps))
  },
}

plugin.apply(ctx, { enabled: true })

check('plugin exports a name', plugin.name === 'dsh-modern-web-guidance', plugin.name)
check('plugin injects tools', Array.isArray(plugin.inject) && plugin.inject.includes('tools'))
check('registers 4 tools', registered.size === 4, [...registered.keys()].join(', '))
check('injects one prompt section', sections.length === 1 && sections[0].name === 'modern-web-guidance', sections[0]?.name)

const exec = async (name, args, runContext = { signal: undefined, agent: { meta: { cwd: process.cwd() } } }) => {
  const definition = registered.get(name)
  if (!definition) throw new Error(`tool ${name} is not registered`)
  const value = await definition.execute(args, runContext)
  const content = definition.output.render(args, value)
  const text = content.map((block) => block.text ?? '').join('\n')
  return { value, text }
}

const report = {}

try {
  const { value, text } = await exec('mwg_search', { query: 'light dismiss dialog' })
  report.search = { count: value.matches.length, first: value.matches[0]?.id, sample: text.slice(0, 160) }
  check('mwg_search returns matches', value.matches.length > 0 && value.matches.some((m) => m.id === 'light-dismiss-a-dialog'), report.search.first)
} catch (error) {
  check('mwg_search returns matches', false, error.message)
}

try {
  const { value, text } = await exec('mwg_retrieve', { ids: ['light-dismiss-a-dialog'] })
  report.retrieve = { guides: value.guides.map((g) => g.id), chars: text.length, hasClosedBy: text.includes('closedby') }
  check('mwg_retrieve returns the guide body', value.guides.length === 1 && text.includes('closedby'), `${text.length} chars`)
} catch (error) {
  check('mwg_retrieve returns the guide body', false, error.message)
}

try {
  const { value, text } = await exec('mwg_retrieve', { ids: ['dialog', 'css-layout'] })
  report.multiRetrieve = { guides: value.guides.map((g) => g.id), chars: text.length, truncated: text.startsWith('[partially truncated]') }
  check(
    'mwg_retrieve handles CLI spool-to-file (>9.5 KB)',
    value.guides.length === 2 && !text.startsWith('[partially truncated]'),
    `${value.guides.map((g) => g.id).join('+')} / ${text.length} chars`,
  )
} catch (error) {
  check('mwg_retrieve handles CLI spool-to-file (>9.5 KB)', false, error.message)
}

try {
  const { value, text } = await exec('mwg_retrieve', { ids: ['dialog', 'no-such-guide'] })
  const ok = value.guides.length === 1 && value.missing.includes('no-such-guide') && text.includes('Unknown guide id')
  report.mixedIds = { guides: value.guides.map((g) => g.id), missing: value.missing }
  check('mwg_retrieve keeps valid guides when one id is unknown', ok, `${value.guides.length} guide(s), missing ${value.missing.join(',')}`)
} catch (error) {
  check('mwg_retrieve keeps valid guides when one id is unknown', false, error.message)
}

try {
  await exec('mwg_retrieve', { ids: ['no-such-guide'] })
  check('mwg_retrieve rejects unknown ids cleanly', false, 'no error thrown')
} catch (error) {
  const clean = /no guide with id/.test(error.message) && !/\n\s+at /.test(error.message) && !/[A-Za-z]:\\/.test(error.message)
  check('mwg_retrieve rejects unknown ids cleanly', clean, error.message.slice(0, 140))
}

try {
  const { value, text } = await exec('mwg_list', {})
  report.list = { count: value.count, sample: text.slice(0, 120) }
  check('mwg_list returns the corpus', value.count > 200, `${value.count} guides`)
} catch (error) {
  check('mwg_list returns the corpus', false, error.message)
}

try {
  const { value, text } = await exec('mwg_legacy_scan', { path: 'test/fixtures/legacy' })
  report.scan = { target: value.target, totalFindings: value.totalFindings, guides: value.guides.length, chars: text.length }
  check(
    'mwg_legacy_scan summarises findings',
    value.totalFindings > 0 && value.guides.length > 0 && value.findings.length > 0 && value.report === undefined && text.length < 4000,
    `${value.totalFindings} findings, ${text.length} chars`,
  )
} catch (error) {
  check('mwg_legacy_scan summarises findings', false, error.message)
}

try {
  const { value } = await exec('mwg_legacy_scan', { path: 'test/fixtures/legacy', full: true })
  check('mwg_legacy_scan full:true carries the raw report', typeof value.report === 'string' && value.report.startsWith('{'), `${value.report?.length ?? 0} chars`)
} catch (error) {
  check('mwg_legacy_scan full:true carries the raw report', false, error.message)
}

try {
  await exec('mwg_legacy_scan', {}, { signal: undefined, agent: { meta: { cwd: os.homedir() } } })
  check('mwg_legacy_scan refuses to scan the home directory by default', false, 'no error thrown')
} catch (error) {
  check('mwg_legacy_scan refuses to scan the home directory by default', /explicit path/.test(error.message), error.message.slice(0, 90))
}

// --- configuration surface -------------------------------------------------
{
  const isolated = { tools: new Map(), sections: [] }
  const isolatedCtx = {
    inject(deps, callback) {
      callback({
        tools: { register: (definition) => { isolated.tools.set(definition.name, definition); return () => {} } },
        systemPrompt: { section: (options) => { isolated.sections.push(options); return () => {} } },
      })
    },
  }
  plugin.apply(isolatedCtx, { enabled: false })
  check('enabled: false registers nothing', isolated.tools.size === 0 && isolated.sections.length === 0, `${isolated.tools.size} tools`)

  const noPrompt = { tools: new Map(), sections: [] }
  const noPromptCtx = {
    inject(deps, callback) {
      callback({
        tools: { register: (definition) => { noPrompt.tools.set(definition.name, definition); return () => {} } },
        systemPrompt: { section: (options) => { noPrompt.sections.push(options); return () => {} } },
      })
    },
  }
  plugin.apply(noPromptCtx, { injectPrompt: false })
  check('injectPrompt: false skips the prompt section', noPrompt.tools.size === 4 && noPrompt.sections.length === 0, `${noPrompt.tools.size} tools`)
}

{
  const broken = new Map()
  const brokenCtx = {
    inject(deps, callback) {
      callback({
        tools: { register: (definition) => { broken.set(definition.name, definition); return () => {} } },
        systemPrompt: { section: () => () => {} },
      })
    },
  }
  plugin.apply(brokenCtx, { cliPath: 'C:/definitely/not/here/modern-web.mjs' })
  try {
    await broken.get('mwg_search').execute({ query: 'dialog' }, {})
    check('missing CLI yields an actionable error', false, 'no error thrown')
  } catch (error) {
    check(
      'missing CLI yields an actionable error',
      /modern-web-guidance CLI not found/.test(error.message) && !/[A-Za-z]:\\/.test(error.message),
      error.message.slice(0, 110),
    )
  }
}

const failed = checks.filter((entry) => !entry.ok)
if (jsonOut) {
  console.log(JSON.stringify({ ok: failed.length === 0, checks, report }, null, 2))
} else {
  for (const entry of checks) console.log(`${entry.ok ? 'PASS' : 'FAIL'}  ${entry.name}${entry.detail ? `  [${entry.detail}]` : ''}`)
  console.log(failed.length ? `\n${failed.length} check(s) failed` : '\nAll checks passed')
}
process.exit(failed.length ? 1 : 0)
