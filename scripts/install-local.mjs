#!/usr/bin/env node
/**
 * Install (or migrate) this plugin into a local DSH profile, without touching
 * anything outside that profile.
 *
 * Default is a DRY RUN: it prints every change it would make. Pass `--apply` to
 * write. The profile's `package.json` and `cordis.patch.yml` are backed up next
 * to themselves before any write.
 *
 * The script is mainly for two cases:
 *   1. first local installation from this workspace (no npm publish needed);
 *   2. migrating an older hand-installed copy from the legacy name
 *      `@local/dsh-chat-background` to the published name `dsh-chat-background`.
 *
 * Usage:
 *   node scripts/install-local.mjs [--profile desktop] [--dsh-home <dir>]
 *     [--source <package dir>] [--apply]
 *
 * After `--apply`, fully quit and reopen the DSH desktop app so the host half
 * loads from the new package path.
 */
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Runtime entries copied into the profile; mirrors the `files` field. */
const PACKAGE_ENTRIES = ['package.json', 'index.js', 'host', 'client.js', 'cordis.patch.yml', 'locale', 'icon.svg']

/** Bundle row id this plugin owns. */
const ENTRY_ID = 'chat-background'

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
 * Read JSON with a helpful failure message.
 * @param {string} path
 */
async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    throw new Error(`cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

const args = parseArguments(process.argv.slice(2))
const apply = args.apply === 'true'
const profileName = args.profile ?? 'desktop'
const source = resolve(args.source ?? ROOT)
const dshHome = resolve(args['dsh-home'] ?? process.env.DSH_HOME ?? join(homedir(), '.dsh'))
const profileDir = join(dshHome, 'profiles', profileName)

if (!existsSync(profileDir)) {
  console.error(`FAIL profile not found: ${profileDir}`)
  console.error('     pass --profile <name> or --dsh-home <dir>')
  process.exit(1)
}
if (!existsSync(join(source, 'package.json')) || !existsSync(join(source, 'client.js'))) {
  console.error(`FAIL ${source} does not look like the plugin package (package.json/client.js missing)`)
  process.exit(1)
}

const pkg = await readJson(join(source, 'package.json'))
const packageName = String(pkg.name)
const targetDir = join(profileDir, 'node_modules', packageName)
const manifestPath = join(profileDir, 'package.json')
const patchPath = join(profileDir, 'cordis.patch.yml')
const manifest = await readJson(manifestPath)
const patch = await readFile(patchPath, 'utf8')

/* ---- plan ---------------------------------------------------------------- */

/** @type {string[]} */
const changes = []

const dependencies = { ...(manifest.dependencies ?? {}) }
for (const legacy of ['@local/dsh-chat-background']) {
  if (legacy in dependencies) {
    delete dependencies[legacy]
    changes.push(`dependencies: remove legacy ${legacy}`)
  }
}
dependencies[packageName] = `file:./node_modules/${packageName}`
changes.push(`dependencies: set ${packageName} -> file:./node_modules/${packageName}`)

const bundles = Array.isArray(manifest.dsh?.profile?.bundles) ? [...manifest.dsh.profile.bundles] : []
const legacyIndex = bundles.findIndex((name) => name === '@local/dsh-chat-background')
if (legacyIndex >= 0) {
  bundles[legacyIndex] = packageName
  changes.push(`dsh.profile.bundles: replace @local/dsh-chat-background with ${packageName}`)
} else if (!bundles.includes(packageName)) {
  bundles.push(packageName)
  changes.push(`dsh.profile.bundles: append ${packageName}`)
}

const insertPattern = new RegExp(`(- id:\\s*${ENTRY_ID}\\s*\\n\\s*name:\\s*)'?[^'\\n]+'?`, 'u')
let nextPatch = patch
if (insertPattern.test(patch)) {
  nextPatch = patch.replace(insertPattern, `$1'${packageName}'`)
  if (nextPatch !== patch) changes.push(`cordis.patch.yml: insert row ${ENTRY_ID} -> ${packageName}`)
} else {
  const block = `- insert:\n    - id: ${ENTRY_ID}\n      name: '${packageName}'\n`
  nextPatch = `${patch.trimEnd()}\n\n${block}`
  changes.push(`cordis.patch.yml: append insert row ${ENTRY_ID} -> ${packageName}`)
}

changes.push(`copy ${PACKAGE_ENTRIES.join(', ')} -> ${targetDir}`)

/* ---- report / apply ------------------------------------------------------ */

console.log(`profile : ${profileDir}`)
console.log(`source  : ${source}`)
console.log(`package : ${packageName} v${String(pkg.version)}`)
console.log(`mode    : ${apply ? 'APPLY' : 'dry run (pass --apply to write)'}`)
for (const change of changes) console.log(`  - ${change}`)

if (!apply) {
  console.log('\ndry run only; nothing written')
  process.exit(0)
}

const stamp = new Date().toISOString().replaceAll(/[:.]/gu, '-')

/* Refuse to write unless the target really looks like a DSH profile and this
 * checkout really is the package the manifest expects; a wrong `--dsh-home`
 * should not silently rewrite an unrelated package.json (`SEC-09`). */
if (manifest.dsh?.profile === undefined) {
  console.error(`FAIL ${manifestPath} has no dsh.profile block; refuse to modify it`)
  process.exit(1)
}
if (typeof packageName !== 'string' || !/^[@a-z0-9][@a-z0-9/._-]*$/u.test(packageName)) {
  console.error(`FAIL source package name is not a sane npm name: ${String(packageName)}`)
  process.exit(1)
}

/* One writer at a time: two concurrent installer runs would interleave the
 * manifest and the copied files. */
const installLockPath = join(profileDir, '.dsh-chat-background-install.lock')
try {
  await writeFile(installLockPath, `${String(process.pid)}\n`, { flag: 'wx' })
} catch {
  console.error(`FAIL another install is in progress (${installLockPath}); remove the file if it is stale`)
  process.exit(1)
}

let succeeded = false
try {
  await cp(manifestPath, `${manifestPath}.bak-${stamp}`)
  await cp(patchPath, `${patchPath}.bak-${stamp}`)

  await mkdir(targetDir, { recursive: true })
  for (const entry of PACKAGE_ENTRIES) {
    await rm(join(targetDir, entry), { recursive: true, force: true })
    await cp(join(source, entry), join(targetDir, entry), { recursive: true })
  }

  await writeFile(
    manifestPath,
    `${JSON.stringify({ ...manifest, dependencies, dsh: { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles } } }, null, 2)}\n`,
    'utf8'
  )
  await writeFile(patchPath, nextPatch, 'utf8')
  succeeded = true
} catch (error) {
  /* Put the two profile files back; the installed package directory may be
   * partially copied but is inert without the manifest entry. */
  try {
    await cp(`${manifestPath}.bak-${stamp}`, manifestPath)
    await cp(`${patchPath}.bak-${stamp}`, patchPath)
  } catch {
    console.error(`rollback failed; restore manually from ${manifestPath}.bak-${stamp}`)
  }
  console.error(`FAIL install failed and was rolled back: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  await rm(installLockPath, { force: true }).catch(() => {})
}
if (!succeeded) process.exit(1)

/* A stale pnpm lock referencing the legacy name is not fatal for a `file:`
 * dependency, but say so instead of leaving a silent inconsistency. */
const pnpmLockPath = join(profileDir, 'pnpm-lock.yaml')
if (existsSync(pnpmLockPath)) {
  const lock = await readFile(pnpmLockPath, 'utf8')
  if (lock.includes('@local/dsh-chat-background')) {
    console.log('\nnote: pnpm-lock.yaml still mentions @local/dsh-chat-background; the plugin manager can refresh it')
  }
}

console.log(`\nok   installed ${packageName} -> ${targetDir}`)
console.log('     backup:', `${manifestPath}.bak-${stamp}`, 'and', `${patchPath}.bak-${stamp}`)
console.log('     now FULLY QUIT and reopen the DSH desktop app (host half loads at boot)')
if (existsSync(join(profileDir, 'node_modules', '@local', 'dsh-chat-background'))) {
  console.log('     legacy @local/dsh-chat-background directory still exists; remove it after the new version works')
}
