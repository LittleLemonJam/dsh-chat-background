#!/usr/bin/env node
/**
 * End-to-end orchestrator: provision an isolated DSH home, boot a disposable
 * DSH Web instance against it, run the headless-browser suites, then tear
 * everything down. The user's own `~/.dsh` profile is never touched.
 *
 * Usage:
 *   node scripts/e2e/run.mjs [--suite <name>] [--keep] [--dsh <cli>] [--browser <exe>]
 *     [--window 1440x900] [--port 0]
 *
 * Prerequisites (see docs/TESTING.md):
 *   - a local DSH installation (`DSH_CLI`, or `dsh` on PATH, or the default
 *     Windows install path);
 *   - Edge or Chrome (`DSH_E2E_BROWSER`, or a platform default).
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { dirname, join, resolve, sep } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { provision } from './provision.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const STEPS_DIR = join(ROOT, 'test', 'e2e', 'steps')
const TMP = join(ROOT, '.tmp')
const ARTIFACTS = join(TMP, 'e2e-artifacts')
const HOME = join(TMP, 'e2e-home')
const BROWSER_PROFILE = join(TMP, 'e2e-browser-profile')

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

/** @param {string} message */
function fail(message) {
  console.error(`FAIL ${message}`)
  process.exitCode = 1
}

/**
 * Resolve how to start the CLI. The Windows installer ships `dsh.cmd`, a thin
 * shim that runs the Electron binary in Node mode; spawning that binary
 * directly avoids every `cmd.exe` quoting problem with the space in
 * "E:\deepseek harness".
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
      /* `cliJs` lives inside `app.asar`, so it is not a real path on disk; the
       * Electron binary resolves it through the archive. */
      if (existsSync(exe)) return { kind: 'electron', exe, cliJs }
    }
  }
  return { kind: 'direct', command: candidate }
}

/**
 * Spawn the CLI with the given arguments.
 * @param {ReturnType<typeof resolveInvocation>} invocation
 * @param {string[]} cliArgs
 * @param {import('node:child_process').SpawnOptions} options
 */
function spawnInvocation(invocation, cliArgs, options) {
  if (invocation.kind === 'electron') {
    return spawn(invocation.exe, ['--expose-internals', invocation.cliJs, ...cliArgs], {
      ...options,
      env: { ...options.env, ELECTRON_RUN_AS_NODE: '1' }
    })
  }
  return spawn(invocation.command, cliArgs, options)
}

/**
 * Whether a candidate answers `<command> --version`.
 * @param {string} candidate
 */
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

/**
 * Locate the DSH CLI to boot. Override with `--dsh` or `DSH_CLI`.
 * @param {Record<string, string>} args
 * @returns {ReturnType<typeof resolveInvocation> | null}
 */
function resolveDsh(args) {
  const candidates = [args.dsh, process.env.DSH_CLI, null, 'dsh'].filter(
    (value) => typeof value === 'string' && value !== ''
  )
  for (const candidate of candidates) {
    if (!candidate.includes('/') && !candidate.includes('\\')) {
      const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', [candidate], { encoding: 'utf8' })
      const found = String(probe.stdout ?? '')
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .find((line) => line !== '')
      if (found !== undefined && commandWorks(found)) return resolveInvocation(found)
      continue
    }
    if (existsSync(candidate) && commandWorks(candidate)) return resolveInvocation(candidate)
  }
  return null
}

/**
 * Locate a Chromium-based browser. Override with `--browser` or `DSH_E2E_BROWSER`.
 * @param {Record<string, string>} args
 * @returns {string | null}
 */
function resolveBrowser(args) {
  const candidates = [
    args.browser,
    process.env.DSH_E2E_BROWSER,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    'google-chrome',
    'chromium',
    'chromium-browser',
    'microsoft-edge'
  ].filter((value) => typeof value === 'string' && value !== '')
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
    if (!candidate.includes('\\') && !candidate.includes('/')) {
      const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', [candidate], {
        encoding: 'utf8'
      })
      const found = String(probe.stdout ?? '')
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .find((line) => line !== '')
      if (found !== undefined) return found
    }
  }
  return null
}

/** @returns {Promise<number>} */
function freePort() {
  return new Promise((resolvePromise, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      server.close(() => resolvePromise(port))
    })
  })
}

/**
 * Start the disposable DSH Web instance and wait for its tokenized URL.
 * @param {{ cli: string, port: number, home: string }} options
 * @returns {Promise<{ url: string, child: import('node:child_process').ChildProcess, stop: () => void }>}
 */
async function startInstance({ cli, port, home }) {
  /* The disposable instance inherits the caller's environment except for the
   * variables that would let it escape the sandbox: a user-set background folder
   * and the test URL of another run (`SEC-10`). */
  const env = { ...process.env, DSH_HOME: home }
  delete env.DSH_BACKGROUNDS_DIR
  delete env.DSH_CHAT_BACKGROUND_ALLOWED_HOSTS
  delete env.DSH_E2E_URL
  const child = spawnInvocation(cli, ['--profile', 'e2e', '--port', String(port), '--no-open'], {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let output = ''
  const url = await new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`DSH did not print its Web URL within 120s.\n${output.slice(-4000)}`))
    }, 120_000)
    const onData = (chunk) => {
      output += String(chunk)
      const match = /http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+/u.exec(output)
      if (match !== null) {
        clearTimeout(timer)
        resolvePromise(match[0])
      }
    }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`DSH exited early with code ${String(code)}.\n${output.slice(-4000)}`))
    })
  })
  await writeFile(join(TMP, 'e2e-dsh.log'), maskToken(output), 'utf8').catch(() => {})
  const stop = () => {
    if (child.pid === undefined) return
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' })
    } else {
      try {
        process.kill(-child.pid, 'SIGTERM')
      } catch {
        child.kill()
      }
    }
  }
  /* Give the HTTP socket and the client bundles a moment to settle. */
  await sleep(1500)
  return { url, child, stop }
}

/** @param {string} suiteFile */
async function runSuite({ suiteFile, url, browser }) {
  const outDir = join(ARTIFACTS, suiteFile.replace(/\.json$/u, ''))
  /* Replace this suite's directory so a failed rerun cannot leave an older PASS
   * report behind while the summary says failed (`r2-02`). */
  await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })
  const result = spawnSync(
    process.execPath,
    [
      join(ROOT, 'scripts', 'e2e', 'cdp.mjs'),
      '--browser',
      browser,
      '--user-data-dir',
      BROWSER_PROFILE,
      '--out-dir',
      outDir,
      '--steps',
      join(STEPS_DIR, suiteFile),
      '--window',
      args.window ?? '1440x900'
    ],
    /* The tokenized URL travels in the environment rather than argv, so it does
     * not appear in the local process list (`SEC-10`). */
    { cwd: ROOT, encoding: 'utf8', timeout: 300_000, env: { ...process.env, DSH_E2E_URL: url } }
  )
  return { suite: suiteFile, outDir, status: result.status, stdout: result.stdout, stderr: result.stderr }
}

/**
 * Replace the instance auth token so logs and summaries stay shareable (`R-07`).
 * @param {string} text
 * @returns {string}
 */
function maskToken(text) {
  return String(text).replaceAll(/token=[^&\s]+/gu, 'token=…')
}

const args = parseArguments(process.argv.slice(2))
const keep = args.keep === 'true'
const dsh = resolveDsh(args)
const browser = resolveBrowser(args)

if (dsh === null) fail('could not locate the DSH CLI; pass --dsh <path> or set DSH_CLI')
if (browser === null) fail('could not locate Edge/Chrome; pass --browser <exe> or set DSH_E2E_BROWSER')
if (process.exitCode === 1) process.exit(process.exitCode)

await mkdir(TMP, { recursive: true })
/* Keep earlier artifacts so a full run leaves a complete evidence set for the
 * review/release record (`R-14`); each suite overwrites its own directory. */
await rm(BROWSER_PROFILE, { recursive: true, force: true })

const only = args.suite ?? null
const suites = readdirSync(STEPS_DIR)
  .filter((file) => file.endsWith('.json'))
  .filter((file) => (only === null ? !file.startsWith('00-') : file === only || file.replace(/\.json$/u, '') === only))
  .sort()
if (suites.length === 0) {
  fail(`no suites found${only === null ? '' : ` for ${only}`}`)
  process.exit(process.exitCode ?? 1)
}

/** @type {{ provisioned: Awaited<ReturnType<typeof provision>>, instance: Awaited<ReturnType<typeof startInstance>> | null }} */
const state = { provisioned: null, instance: null }
let exitCode = 0
let cleaned = false

/** Stop the disposable instance and remove the temporary trees. */
async function cleanupTemps() {
  if (cleaned) return
  cleaned = true
  state.instance?.stop()
  await sleep(800)
  if (!keep) {
    await rm(HOME, { recursive: true, force: true })
    await rm(BROWSER_PROFILE, { recursive: true, force: true })
  }
}

/* A Ctrl+C must not leave a DSH instance or a headless browser running (`SEC-10`). */
const onSignal = () => {
  state.instance?.stop()
  process.exit(130)
}
process.once('SIGINT', onSignal)
process.once('SIGTERM', onSignal)

try {
  state.provisioned = await provision({ home: HOME })
  /* A freshly probed port can still race another process; retry a couple of
   * times instead of failing the whole run. */
  for (let attempt = 1; ; attempt += 1) {
    const port = args.port !== undefined && args.port !== '0' ? Number(args.port) : await freePort()
    try {
      state.instance = await startInstance({ cli: dsh, port, home: HOME })
      break
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (attempt < 3 && /EADDRINUSE|address already in use/iu.test(message)) {
        await sleep(800)
        continue
      }
      throw error
    }
  }
  console.log(`ok   DSH ready at ${state.instance.url.replace(/token=[^\s]+/u, 'token=…')}`)

  const results = []
  for (const suite of suites) {
    process.stdout.write(`\n== ${suite}\n`)
    const result = await runSuite({ suiteFile: suite, url: state.instance.url, browser })
    results.push(result)
    if (result.status !== 0) {
      exitCode = 1
      process.stdout.write(`${result.stdout ?? ''}${result.stderr ?? ''}`)
      console.error(`FAIL ${suite} (see ${result.outDir})`)
    } else {
      console.log(`ok   ${suite} (${result.outDir})`)
    }
  }
  await writeFile(
    join(ARTIFACTS, 'summary.json'),
    `${JSON.stringify(
      results.map((result) => ({ suite: result.suite, status: result.status, outDir: result.outDir })),
      null,
      2
    )}\n`
  )
  console.log(`\nartifacts: ${ARTIFACTS}`)
} catch (error) {
  exitCode = 1
  fail(error instanceof Error ? error.message : String(error))
} finally {
  process.removeListener('SIGINT', onSignal)
  process.removeListener('SIGTERM', onSignal)
  await cleanupTemps()
}
process.exit(exitCode)
