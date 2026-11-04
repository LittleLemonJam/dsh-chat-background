#!/usr/bin/env node
/**
 * Check whether the version in package.json has cleared the pnpm release-age
 * observation window DSH inherits from its bundled pnpm, and optionally try the
 * same unpinned install the plugin manager performs.
 *
 * DSH's plugin manager runs `pnpm add` inside the profile. pnpm 11 defaults
 * `minimumReleaseAge` to 1440 minutes (24 hours): while the newest version is
 * younger than that, an unpinned `pnpm add <name>` resolves to the newest older
 * version instead. An exact `name@version` request is not held back, and a
 * profile can opt a version out with `minimumReleaseAgeExclude`.
 *
 * Usage:
 *   node scripts/release-check.mjs [--install] [--keep] [--json]
 *
 *   --install  create a disposable DSH home/profile and run
 *              `dsh plugin --profile releasecheck add <package>` (needs DSH_CLI
 *              or `dsh` on PATH); reports the version pnpm actually installed.
 *   --keep     keep the disposable home for inspection.
 *   --json     print one JSON object instead of the human summary.
 *
 * Exit code: 0 when the observation window has passed (and, with --install, the
 * latest version was installed); 1 otherwise; 2 for usage/setup failures.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TMP = join(ROOT, '.tmp')
const HOME = join(TMP, 'release-check-home')
const PROFILE = 'releasecheck'

/** pnpm's default minimumReleaseAge: 1440 minutes. */
const MIN_RELEASE_AGE_MS = 24 * 60 * 60 * 1000

const args = new Set(process.argv.slice(2))
const wantInstall = args.has('--install')
const keep = args.has('--keep')
const asJson = args.has('--json')

/**
 * Resolve the DSH CLI, including the Windows `.cmd` shim that points at the
 * Electron binary (spawning that binary directly avoids cmd quoting problems).
 * @param {string} candidate - executable or `.cmd` path.
 * @returns {{ kind: 'electron', exe: string, cliJs: string } | { kind: 'direct', command: string }}
 */
function resolveInvocation(candidate) {
  if (process.platform === 'win32' && candidate.toLowerCase().endsWith('.cmd') && existsSync(candidate)) {
    const content = readFileSync(candidate, 'utf8')
    const match = /"([^"]+\.exe)"\s+--expose-internals\s+"([^"]+\.js)"/u.exec(content)
    if (match !== null) {
      const base = dirname(candidate) + sep
      const exe = resolve(match[1].replaceAll('%~dp0', base))
      const cliJs = resolve(match[2].replaceAll('%~dp0', base))
      if (existsSync(exe)) return { kind: 'electron', exe, cliJs }
    }
  }
  return { kind: 'direct', command: candidate }
}

/** @param {string} candidate */
function commandWorks(candidate) {
  try {
    const invocation = resolveInvocation(candidate)
    const result =
      invocation.kind === 'electron'
        ? spawnSync(invocation.exe, ['--expose-internals', invocation.cliJs, '--version'], {
            encoding: 'utf8',
            timeout: 30_000,
            env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
          })
        : spawnSync(invocation.command, ['--version'], { encoding: 'utf8', timeout: 30_000 })
    return result.status === 0 && String(result.stdout ?? '').trim() !== ''
  } catch {
    return false
  }
}

/** @param {string} candidate */
function resolveCli(candidate) {
  const invocation = resolveInvocation(candidate)
  return { invocation, works: commandWorks(candidate) }
}

/**
 * Run the CLI with the disposable home.
 * @param {{ kind: string, exe?: string, cliJs?: string, command?: string }} invocation
 * @param {string[]} cliArgs
 * @param {string} home
 */
function spawnCli(invocation, cliArgs, home) {
  const env = { ...process.env, DSH_HOME: home }
  if (invocation.kind === 'electron') {
    return spawn(invocation.exe, ['--expose-internals', invocation.cliJs, ...cliArgs], {
      cwd: ROOT,
      env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'pipe', 'pipe']
    })
  }
  return spawn(invocation.command, cliArgs, { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] })
}

/** @param {number} milliseconds */
function formatDuration(milliseconds) {
  const minutes = Math.round(milliseconds / 60_000)
  if (minutes < 120) return `${String(minutes)}m`
  return `${(minutes / 60).toFixed(1)}h`
}

/** @param {string} name */
async function readRegistryMetadata(name) {
  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`, {
    headers: { accept: 'application/json' }
  })
  if (!response.ok) throw new Error(`registry answered HTTP ${String(response.status)}`)
  return response.json()
}

/**
 * Create a minimal disposable profile that can run `dsh plugin add`.
 * @param {string} home - DSH_HOME to write into.
 */
async function provisionHome(home) {
  await rm(home, { recursive: true, force: true })
  const profileDir = join(home, 'profiles', PROFILE)
  await mkdir(profileDir, { recursive: true })
  await writeFile(
    join(profileDir, 'package.json'),
    `${JSON.stringify(
      {
        name: 'dsh-profile-releasecheck',
        private: true,
        dependencies: {},
        dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } }
      },
      null,
      2
    )}\n`
  )
  await writeFile(join(profileDir, 'cordis.yml'), '[]\n')
  await writeFile(
    join(profileDir, 'pnpm-workspace.yaml'),
    'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n'
  )
  return profileDir
}

/**
 * Run the unpinned install the plugin manager performs and read back the
 * version pnpm actually placed in the profile.
 * @param {{ name: string, version: string }} packageInfo
 */
async function tryInstall(packageInfo) {
  const cli = process.env.DSH_CLI ?? 'dsh'
  const { invocation, works } = resolveCli(cli)
  if (!works) throw new Error(`DSH CLI not found: ${cli} (set DSH_CLI)`)
  const profileDir = await provisionHome(HOME)
  const child = spawnCli(invocation, ['plugin', '--profile', PROFILE, 'add', packageInfo.name], HOME)
  let output = ''
  const code = await new Promise((resolvePromise) => {
    child.stdout?.on('data', (chunk) => {
      output += String(chunk)
    })
    child.stderr?.on('data', (chunk) => {
      output += String(chunk)
    })
    child.once('error', (error) => {
      output += String(error)
      resolvePromise(1)
    })
    child.once('exit', (exitCode) => {
      resolvePromise(exitCode ?? 1)
    })
  })
  let installed = null
  try {
    installed = JSON.parse(
      readFileSync(join(profileDir, 'node_modules', packageInfo.name, 'package.json'), 'utf8')
    ).version
  } catch {
    /* not installed */
  }
  return { code, installed, output: output.slice(-4000), profileDir }
}

async function main() {
  const packageInfo = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  const name = packageInfo.name
  const version = packageInfo.version
  const metadata = await readRegistryMetadata(name)
  const publishedAt = metadata.time?.[version]
  if (typeof publishedAt !== 'string') {
    throw new Error(`${name}@${version} is not published (registry has no time entry)`)
  }
  const publishedMs = Date.parse(publishedAt)
  const ageMs = Date.now() - publishedMs
  const dueMs = publishedMs + MIN_RELEASE_AGE_MS
  const passed = ageMs >= MIN_RELEASE_AGE_MS
  const summary = {
    name,
    version,
    publishedAt: new Date(publishedMs).toISOString(),
    age: formatDuration(ageMs),
    observation: '24h',
    dueAt: new Date(dueMs).toISOString(),
    passed,
    install: null
  }
  if (wantInstall) {
    const install = await tryInstall({ name, version })
    summary.install = {
      installed: install.installed,
      latestInstalled: install.installed === version,
      exitCode: install.code,
      output: install.output
    }
    if (!keep) await rm(HOME, { recursive: true, force: true })
  }
  if (asJson) {
    console.log(JSON.stringify(summary, null, 2))
  } else {
    console.log(`${name}@${version}`)
    console.log(`published: ${summary.publishedAt}`)
    console.log(`age: ${summary.age} (observation window: 24h)`)
    console.log(`due: ${summary.dueAt}${passed ? ' (passed)' : ` (${formatDuration(dueMs - Date.now())} left)`}`)
    if (summary.install !== null) {
      console.log(
        summary.install.installed === version
          ? `unpinned install: ${summary.install.installed} (latest)`
          : `unpinned install: ${String(summary.install.installed)} (expected ${version})`
      )
    }
  }
  const installOk = summary.install === null || summary.install.latestInstalled
  process.exitCode = passed && installOk ? 0 : 1
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 2
})
