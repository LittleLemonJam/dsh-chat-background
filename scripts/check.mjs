#!/usr/bin/env node
/**
 * Static verification of the repository. Runs without network access and without
 * a DSH installation, so it works locally and in CI.
 *
 * Checks:
 *   1. required files exist;
 *   2. `package.json` carries the fields a DSH bundle needs;
 *   3. the bundle patch names this package;
 *   4. `locale/*.json` is valid, has matching keys and display metadata;
 *   5. `client.js` is fresh (rebuilds in memory via `scripts/build.mjs --check`),
 *      carries the banner version and registers the package id;
 *   6. the browser-half source has no leftovers of removed features and no
 *      stray `console.*` calls;
 *   7. every tracked text file is UTF-8 without BOM, uses LF and ends with a
 *      newline;
 *   8. the two language dictionaries expose the same keys.
 *
 * Exit code 1 on the first failing group, with every failure printed.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const failures = []

/**
 * Record one passing check.
 * @param {string} message
 */
function pass(message) {
  console.log(`ok   ${message}`)
}

/**
 * Record one failing check.
 * @param {string} message
 * @param {string} [detail]
 */
function fail(message, detail) {
  failures.push(message)
  console.error(`FAIL ${message}${detail === undefined ? '' : `\n     ${detail}`}`)
}

/**
 * Assert a condition.
 * @param {boolean} condition
 * @param {string} message
 * @param {string} [detail]
 */
function expect(condition, message, detail) {
  if (condition) pass(message)
  else fail(message, detail)
}

/** The committed package manifest. */
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

/* ---- 1. required files --------------------------------------------------- */

const REQUIRED = [
  'README.md',
  'README.en.md',
  'LICENSE',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'CODE_OF_CONDUCT.md',
  'SECURITY.md',
  'package.json',
  'package-lock.json',
  'cordis.patch.yml',
  'icon.svg',
  'index.js',
  'client.js',
  'locale/zh.json',
  'locale/en.json',
  'src/index.js',
  'src/diagnostics.js',
  'src/image-zoom.js',
  'host/constants.js',
  'scripts/build.mjs',
  'scripts/check.mjs',
  'scripts/check-install.mjs',
  'scripts/install-local.mjs',
  'scripts/cleanup-local.mjs',
  'scripts/e2e/run.mjs',
  'test/e2e/steps/01-smoke.json',
  'test/e2e/steps/08-security.json',
  'test/e2e/steps/06-image-zoom.json',
  'test/e2e/steps/05-rightbar.json',
  'test/e2e/steps/07-rotation.json',
  'test/e2e/steps/07b-animated-background.json',
  '.github/workflows/ci.yml',
  '.github/workflows/release.yml',
  '.github/ISSUE_TEMPLATE/bug_report.yml',
  '.github/PULL_REQUEST_TEMPLATE.md',
  '.editorconfig',
  '.gitattributes',
  '.gitignore',
  '.prettierrc.json',
  '.prettierignore'
]
for (const relativePath of REQUIRED) {
  expect(existsSync(join(ROOT, relativePath)), `required file exists: ${relativePath}`)
}

/* ---- 2. package manifest ------------------------------------------------- */

expect(pkg.name === 'dsh-chat-background', 'package name is dsh-chat-background', `got ${String(pkg.name)}`)
expect(/^\d+\.\d+\.\d+$/u.test(String(pkg.version)), 'package version is semver', `got ${String(pkg.version)}`)
expect(pkg.license === 'MIT', 'license is MIT', `got ${String(pkg.license)}`)
expect(typeof pkg.description === 'string' && pkg.description.length > 20, 'package description is present')
expect(typeof pkg.author === 'string' && pkg.author.length > 0, 'package author is present')
expect(typeof pkg.repository?.url === 'string' && pkg.repository.url.includes('github.com'), 'repository url is set')
expect(typeof pkg.homepage === 'string' && pkg.homepage.includes('github.com'), 'homepage is set')
expect(typeof pkg.bugs?.url === 'string' && pkg.bugs.url.includes('/issues'), 'bugs url is set')
expect(typeof pkg.icon === 'string' && existsSync(join(ROOT, pkg.icon)), 'icon file exists')
expect(
  typeof pkg.engines?.node === 'string' && typeof pkg.engines?.dsh === 'string',
  'engines.node and engines.dsh are declared'
)
expect(pkg.dsh?.manifestVersion === 1, 'dsh.manifestVersion is 1')
expect(pkg.dsh?.bundle?.patch === './cordis.patch.yml', 'dsh.bundle.patch points at cordis.patch.yml')
expect(pkg.dsh?.client?.platform === 'web', "dsh.client.platform is 'web'")
expect(Array.isArray(pkg.dsh?.client?.inject), 'dsh.client.inject is an array')
expect(pkg.main === './index.js', 'main is ./index.js', `got ${String(pkg.main)}`)
expect(pkg.exports?.['.'] === './index.js', "exports['.'] is ./index.js")
expect(pkg.exports?.['./client'] === './client.js', "exports['./client'] is ./client.js")
for (const entry of ['index.js', 'host/', 'client.js', 'cordis.patch.yml', 'locale/*.json', 'icon.svg']) {
  expect(Array.isArray(pkg.files) && pkg.files.includes(entry), `files[] includes ${entry}`)
}
expect(pkg.scripts?.build === 'node scripts/build.mjs', 'build script is wired')

/* ---- 3. bundle patch ----------------------------------------------------- */

const patch = readFileSync(join(ROOT, 'cordis.patch.yml'), 'utf8')
expect(patch.includes('- insert:'), 'bundle patch inserts a row')
expect(patch.includes('id: chat-background'), 'bundle patch row id is chat-background')
expect(patch.includes(`name: '${pkg.name}'`), 'bundle patch row names this package', patch.trim())

/* ---- 4. locale resources ------------------------------------------------- */

/** @type {{ zh: Record<string, any>, en: Record<string, any> }} */
const locale = {}
for (const language of ['zh', 'en']) {
  try {
    locale[language] = JSON.parse(readFileSync(join(ROOT, 'locale', `${language}.json`), 'utf8'))
    pass(`locale/${language}.json parses`)
  } catch (error) {
    fail(`locale/${language}.json parses`, String(error))
    locale[language] = {}
  }
  const meta = locale[language]?.meta ?? {}
  expect(typeof meta.title === 'string' && meta.title.length > 0, `locale/${language}.json has meta.title`)
  expect(
    typeof meta.description === 'string' && meta.description.length > 0,
    `locale/${language}.json has meta.description`
  )
}
expect(
  JSON.stringify(Object.keys(locale.zh).sort()) === JSON.stringify(Object.keys(locale.en).sort()),
  'locale groups match between zh and en'
)

/* ---- 5. built client ----------------------------------------------------- */

const clientPath = join(ROOT, 'client.js')
if (existsSync(clientPath)) {
  const client = readFileSync(clientPath, 'utf8')
  expect(!client.startsWith('\uFEFF'), 'client.js has no BOM')
  expect(client.startsWith('/**'), 'client.js starts with the banner')
  expect(client.includes(`v${pkg.version}`), 'client.js banner carries the package version')
  expect(!client.includes('__PACKAGE_NAME__'), 'client.js has the package id substituted')
  expect(
    client.includes(`id: "${pkg.name}"`) || client.includes(`id:"${pkg.name}"`),
    'client.js registers the package id'
  )
  expect(client.includes('window.__ModuleLoader__.load('), 'client.js calls the module loader')

  try {
    execFileSync(process.execPath, [join(ROOT, 'scripts', 'build.mjs'), '--check'], {
      cwd: ROOT,
      stdio: 'pipe'
    })
    pass('client.js is up to date with src/')
  } catch (error) {
    fail('client.js is up to date with src/', error.stdout?.toString().trim() ?? String(error))
  }
}

/* ---- 6. no removed features, no stray logging ---------------------------- */

const REMOVED_FEATURE_MARKERS = ['data-dsh-chat-metrics', 'PILL_', 'dsh-chat-background:pill']
/** @type {string[]} */
const sourceFiles = []
/**
 * Collect every file under one directory.
 * @param {string} directory
 */
function collect(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = join(directory, entry.name)
    if (entry.isDirectory()) collect(full)
    else if (entry.isFile() && (extname(entry.name) === '.js' || extname(entry.name) === '.mjs')) {
      sourceFiles.push(full)
    }
  }
}
collect(join(ROOT, 'src'))
collect(join(ROOT, 'host'))
sourceFiles.push(join(ROOT, 'index.js'))
for (const marker of REMOVED_FEATURE_MARKERS) {
  const hit = sourceFiles.find((file) => readFileSync(file, 'utf8').includes(marker))
  expect(
    hit === undefined,
    `removed feature marker is gone: ${marker}`,
    hit === undefined ? undefined : relative(ROOT, hit)
  )
}
const logging = sourceFiles.find((file) =>
  /\bconsole\.(?:log|debug|info|warn|error)\(/u.test(readFileSync(file, 'utf8'))
)
expect(logging === undefined, 'browser/host source has no console logging', logging && relative(ROOT, logging))

/* ---- 7. text file hygiene ------------------------------------------------ */

const TEXT_EXTENSIONS = new Set(['.js', '.mjs', '.json', '.md', '.yml', '.yaml', '.txt', '.svg', '.css', '.html'])
const IGNORED_DIRECTORIES = new Set(['node_modules', '.git', '_scratch', '.tmp', 'coverage', 'assets'])
/** @type {string[]} */
let tracked = []
try {
  tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
} catch {
  /* No git (e.g. a source archive): walk the tree instead of silently
   * skipping the hygiene check (`R-08`). */
  /** @param {string} directory */
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (IGNORED_DIRECTORIES.has(entry.name)) continue
      const absolute = join(directory, entry.name)
      if (entry.isDirectory()) walk(absolute)
      else if (entry.isFile()) tracked.push(relative(ROOT, absolute).split(sep).join('/'))
    }
  }
  walk(ROOT)
  pass(`text hygiene source: directory walk (${String(tracked.length)} files, git unavailable)`)
}
for (const relativePath of tracked) {
  const absolute = join(ROOT, relativePath)
  if (!existsSync(absolute) || !statSync(absolute).isFile()) continue
  const parts = relativePath.split('/')
  if (parts.some((part) => IGNORED_DIRECTORIES.has(part))) continue
  if (!TEXT_EXTENSIONS.has(extname(relativePath).toLowerCase())) continue
  const bytes = readFileSync(absolute)
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    fail(`no BOM: ${relativePath}`)
    continue
  }
  const text = bytes.toString('utf8')
  if (text.includes('\r\n')) {
    fail(`LF line endings: ${relativePath}`)
    continue
  }
  if (!text.endsWith('\n')) {
    fail(`final newline: ${relativePath}`)
  }
}
if (
  failures.filter(
    (failure) => failure.startsWith('no BOM') || failure.startsWith('LF ') || failure.startsWith('final ')
  ).length === 0
) {
  pass(`text hygiene (${String(tracked.length)} tracked files): UTF-8, LF, final newline`)
}

/* ---- 8. dictionary parity ------------------------------------------------ */

try {
  const dictionaries = await import(new URL('../src/i18n.js', import.meta.url).href)
  const zhKeys = Object.keys(dictionaries.zh).sort()
  const enKeys = Object.keys(dictionaries.en).sort()
  expect(
    JSON.stringify(zhKeys) === JSON.stringify(enKeys),
    `i18n keys match (${String(zhKeys.length)} keys)`,
    JSON.stringify({
      onlyZh: zhKeys.filter((key) => !enKeys.includes(key)),
      onlyEn: enKeys.filter((key) => !zhKeys.includes(key))
    })
  )
} catch (error) {
  fail('i18n dictionary parity', String(error))
}

/* ---- result -------------------------------------------------------------- */

if (failures.length > 0) {
  console.error(`\n${String(failures.length)} check(s) failed`)
  process.exit(1)
}
console.log('\nall checks passed')
