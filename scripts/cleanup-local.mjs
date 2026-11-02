#!/usr/bin/env node
/**
 * Remove the leftovers of earlier local installs once the new version is
 * confirmed working. Default is a DRY RUN: it lists what it would delete.
 *
 * Scope:
 *   - `~/.dsh/profiles/<profile>/node_modules/@local/dsh-chat-background/`
 *   - profile configuration backups written by `install-local.mjs` before a
 *     migration (`package.json.bak-*`, `cordis.patch.yml.bak-*`);
 *   - the repository's `.tmp/` (E2E scratch) and `_scratch/` (local debug
 *     scripts). Keep `.tmp/e2e-artifacts/` when `--keep-artifacts` is passed.
 *
 * Usage:
 *   node scripts/cleanup-local.mjs [--profile desktop] [--dsh-home <dir>]
 *     [--keep-artifacts] [--apply]
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rm } from 'node:fs/promises'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

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

/** @param {string} path */
function sizeOf(path) {
  try {
    const stat = statSync(path)
    if (!stat.isDirectory()) return stat.size
    let total = 0
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      total += sizeOf(join(path, entry.name))
    }
    return total
  } catch {
    return 0
  }
}

/** @param {number} bytes */
function formatBytes(bytes) {
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const args = parseArguments(process.argv.slice(2))
const apply = args.apply === 'true'
const keepArtifacts = args['keep-artifacts'] === 'true'
const profileName = args.profile ?? 'desktop'
const dshHome = resolve(args['dsh-home'] ?? process.env.DSH_HOME ?? join(homedir(), '.dsh'))
const profileDir = join(dshHome, 'profiles', profileName)

/** @type {Array<{ path: string, reason: string, kind: 'dir' | 'file' }>} */
const targets = []

const legacyDir = join(profileDir, 'node_modules', '@local', 'dsh-chat-background')
if (existsSync(legacyDir)) targets.push({ path: legacyDir, reason: 'old @local package name', kind: 'dir' })

if (existsSync(profileDir)) {
  for (const name of await readdir(profileDir)) {
    if (/^package\.json\.bak-|^cordis\.patch\.yml\.bak-/u.test(name)) {
      targets.push({ path: join(profileDir, name), reason: 'profile config backup', kind: 'file' })
    }
  }
}

if (existsSync(join(ROOT, '_scratch'))) {
  targets.push({ path: join(ROOT, '_scratch'), reason: 'local debug scripts', kind: 'dir' })
}
if (existsSync(join(ROOT, '.tmp'))) {
  targets.push({ path: join(ROOT, '.tmp'), reason: 'e2e scratch', kind: 'dir' })
}

/* Report-only items. */
const lockPath = join(profileDir, 'pnpm-lock.yaml')
const legacyInLock = existsSync(lockPath) && readFileExists(lockPath).includes('@local/dsh-chat-background')

/**
 * Read a small text file, returning '' on failure.
 * @param {string} path
 */
function readFileExists(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

console.log(`profile : ${profileDir}`)
console.log(`repo    : ${ROOT}`)
console.log(`mode    : ${apply ? 'APPLY' : 'dry run (pass --apply to delete)'}`)
console.log('')
if (targets.length === 0) console.log('nothing to clean')
for (const target of targets) {
  console.log(
    `  - ${target.kind === 'dir' ? '[dir] ' : '[file]'} ${target.path}  (${formatBytes(sizeOf(target.path))}) — ${target.reason}`
  )
}
if (keepArtifacts && existsSync(join(ROOT, '.tmp', 'e2e-artifacts'))) {
  console.log('  note: .tmp/e2e-artifacts is kept (--keep-artifacts)')
}
if (legacyInLock)
  console.log(`  note: ${lockPath} still mentions @local/dsh-chat-background; let the plugin manager refresh it`)
if (!apply) {
  console.log('\ndry run only; nothing deleted')
  process.exit(0)
}

for (const target of targets) {
  if (keepArtifacts && target.path.startsWith(join(ROOT, '.tmp'))) {
    /* Delete only the scratch children, keeping e2e-artifacts. */
    for (const name of await readdir(target.path)) {
      if (name === 'e2e-artifacts') continue
      await rm(join(target.path, name), { recursive: true, force: true })
    }
    console.log(`ok   cleaned ${target.path} (kept e2e-artifacts)`)
    continue
  }
  await rm(target.path, { recursive: true, force: true })
  console.log(`ok   removed ${target.path}`)
}
console.log('\ncleanup complete')
