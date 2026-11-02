#!/usr/bin/env node
/**
 * Verify that this package is correctly installed in a DSH profile.
 *
 * Read-only: it inspects the profile manifest, the bundle patch, the installed
 * package version and its runtime files, and optionally probes the running Web
 * instance's plugin route. Use it after installing or migrating the plugin, and
 * again after restarting DSH.
 *
 * Usage:
 *   node scripts/check-install.mjs [--profile desktop] [--dsh-home <dir>]
 *     [--url http://127.0.0.1:<port>] [--source <package dir>]
 *
 * Exit code: 0 when every check passes, 1 otherwise.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Read the plugin's health route from a running instance.
 * @param {string | undefined} url - instance base URL.
 * @returns the payload, a failure object, or null when no URL was given.
 */
async function fetchHealth(url) {
  if (url === undefined || url === 'true' || url === '') return null
  try {
    const response = await fetch(`${String(url).replace(/\/$/u, '')}/chat-backgrounds/health`, {
      signal: AbortSignal.timeout(5000)
    })
    if (!response.ok) return { ok: false, status: response.status }
    return await response.json()
  } catch (error) {
    return { ok: false, error: String(error) }
  }
}

/**
 * Parse `--name value` arguments.
 * @param {string[]} argv
 * @returns {Record<string, string>}
 */
function parseArguments(argv) {
  const values = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) continue
    const next = argv[index + 1]
    if (next === undefined || next.startsWith('--')) {
      values[token.slice(2)] = 'true'
      continue
    }
    values[token.slice(2)] = next
    index += 1
  }
  return values
}

/**
 * Read JSON with a readable failure.
 * @param {string} path
 */
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(`cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** @type {{ failures: string[] }} */
const state = { failures: [] }

/**
 * Record one check.
 * @param {boolean} condition
 * @param {string} message
 * @param {string} [detail]
 */
function check(condition, message, detail) {
  if (condition) {
    console.log(`ok   ${message}`)
    return
  }
  state.failures.push(message)
  console.error(`FAIL ${message}${detail === undefined ? '' : `\n     ${detail}`}`)
}

const args = parseArguments(process.argv.slice(2))
const profileName = args.profile ?? 'desktop'
const dshHome = resolve(args['dsh-home'] ?? process.env.DSH_HOME ?? join(homedir(), '.dsh'))
const profileDir = join(dshHome, 'profiles', profileName)
const source = resolve(args.source ?? ROOT)
const pkg = readJson(join(source, 'package.json'))
const packageName = String(pkg.name)
const expectedVersion = String(pkg.version)

console.log(`profile : ${profileDir}`)
console.log(`package : ${packageName} v${expectedVersion}`)

if (!existsSync(join(profileDir, 'package.json'))) {
  console.error('FAIL profile does not exist')
  process.exit(1)
}

const manifest = readJson(join(profileDir, 'package.json'))
const dependency = manifest.dependencies?.[packageName]
check(
  typeof dependency === 'string' && dependency.startsWith('file:'),
  `dependencies declares ${packageName}`,
  dependency === undefined ? 'missing dependency' : `got ${String(dependency)}`
)
check(
  Array.isArray(manifest.dsh?.profile?.bundles) && manifest.dsh.profile.bundles.includes(packageName),
  'dsh.profile.bundles lists the plugin',
  JSON.stringify(manifest.dsh?.profile?.bundles ?? null)
)

const patchPath = join(profileDir, 'cordis.patch.yml')
const patch = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : ''
check(patch.includes('id: chat-background'), 'cordis.patch.yml has the chat-background row')
check(patch.includes(`name: '${packageName}'`), 'cordis.patch.yml row names this package', patch.trim())

const installedDir = join(profileDir, 'node_modules', packageName)
const installedManifestPath = join(installedDir, 'package.json')
check(existsSync(installedManifestPath), 'installed package exists', installedDir)
let installedVersion = null
if (existsSync(installedManifestPath)) {
  installedVersion = String(readJson(installedManifestPath).version)
  check(
    installedVersion === expectedVersion,
    `installed version is ${expectedVersion}`,
    `got ${String(installedVersion)}`
  )
}
for (const entry of ['index.js', 'client.js', 'host/routes.js', 'cordis.patch.yml', 'locale/zh.json', 'icon.svg']) {
  check(existsSync(join(installedDir, entry)), `installed file exists: ${entry}`)
}

/* The installed copy must be byte-identical to this checkout: a partial copy is
 * the most common cause of "the fix did not take effect". */
const RUNTIME_FILES = [
  'index.js',
  'client.js',
  'host/constants.js',
  'host/media.js',
  'host/paths.js',
  'host/routes.js',
  'host/token-usage.js',
  'cordis.patch.yml',
  'locale/zh.json',
  'locale/en.json',
  'icon.svg'
]
let mismatched = 0
for (const entry of RUNTIME_FILES) {
  const local = join(source, entry)
  const installed = join(installedDir, entry)
  if (!existsSync(local) || !existsSync(installed)) {
    mismatched += 1
    continue
  }
  if (
    createHash('sha256').update(readFileSync(local)).digest('hex') !==
    createHash('sha256').update(readFileSync(installed)).digest('hex')
  ) {
    mismatched += 1
    console.error(`FAIL installed copy differs from source: ${entry}`)
  }
}
check(mismatched === 0, 'installed files are byte-identical to the checkout', `${String(mismatched)} differ`)

/* The health route is the cheapest way to prove the host half of this exact
 * version is mounted; `/list` only proves some version is mounted. */
const health = await fetchHealth(args.url)
if (health !== null) {
  check(health.ok === true, 'health route reports ok', JSON.stringify(health).slice(0, 200))
  check(
    health.version === expectedVersion,
    `running host half reports version ${expectedVersion}`,
    `got ${String(health.version)}`
  )
}

const legacyDir = join(profileDir, 'node_modules', '@local', 'dsh-chat-background')
if (existsSync(legacyDir)) {
  console.log(
    'note  legacy @local/dsh-chat-background directory is still present; safe to delete once the new version works'
  )
}

const url = args.url
if (url !== undefined && url !== 'true') {
  try {
    const response = await fetch(`${String(url).replace(/\/$/u, '')}/chat-backgrounds/list`, {
      signal: AbortSignal.timeout(5000)
    })
    check(
      response.status === 200,
      'running instance answers GET /chat-backgrounds/list with 200',
      `got ${String(response.status)}`
    )
    if (response.status === 200) {
      const payload = await response.json()
      check(
        typeof payload.folder === 'string' && Array.isArray(payload.images),
        'list payload has folder and images',
        JSON.stringify(payload).slice(0, 200)
      )
    }
  } catch (error) {
    check(false, 'running instance answers GET /chat-backgrounds/list', String(error))
  }
}

if (state.failures.length > 0) {
  console.error(`\n${String(state.failures.length)} check(s) failed`)
  process.exit(1)
}
console.log('\ninstall looks correct')
