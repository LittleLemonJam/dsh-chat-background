#!/usr/bin/env node
/**
 * Minimal Chrome DevTools Protocol driver for the end-to-end suites. No external
 * dependencies: it talks to a headless Edge/Chrome over HTTP + WebSocket.
 *
 * Usage:
 *   node scripts/e2e/cdp.mjs --url <url> --browser <exe> --user-data-dir <dir>
 *     --out-dir <dir> --steps <steps.json> [--window 1440x900]
 *
 * Step kinds (each item of `steps`):
 *   { "log": "text" }                          progress marker
 *   { "wait": 1500 }                           sleep milliseconds
 *   { "waitFor": "css", "timeout": 20000 }     wait until the selector matches
 *   { "seed": { "key": "value" } }             write localStorage before the real navigate
 *   { "eval": "expression" }                   evaluate and record the value
 *   { "check": "label", "expr": "expression" } must evaluate truthy
 *   { "click": "css" }                         click the first match
 *   { "clickText": "text", "tag": "button" }   click the first match by text
 *   { "selectOption": { "selector": "css", "value": "v" } }
 *   { "hoverSelector": "css" }
 *   { "shot": "name" }                         screenshot to <out-dir>/name.png
 *
 * Exit code: 0 when every check passed and no console/page error was observed,
 * 1 otherwise. The full facts land in `<out-dir>/report.json`.
 */
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

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
 * Ask the kernel for a free TCP port.
 * @returns {Promise<number>}
 */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

/**
 * Replace the instance auth token before a URL reaches an artifact. The token is
 * ephemeral and instance-local, but artifacts are meant to be shareable (`R-07`).
 * @param {string} url
 * @returns {string}
 */
function maskToken(url) {
  return String(url).replace(/token=[^&\s]+/u, 'token=…')
}

const args = parseArguments(process.argv.slice(2))
/* The orchestrator passes the tokenized URL through the environment so it does
 * not appear in the process list; `--url` stays for manual runs (`SEC-10`). */
const pageUrl = args.url ?? process.env.DSH_E2E_URL
for (const required of ['browser', 'user-data-dir', 'out-dir', 'steps']) {
  if (args[required] === undefined) {
    console.error(`missing --${required}`)
    process.exit(2)
  }
}
if (pageUrl === undefined || pageUrl === '') {
  console.error('missing --url (or DSH_E2E_URL)')
  process.exit(2)
}
const [windowWidth, windowHeight] = (args.window ?? '1440x900').split('x').map((value) => Number(value))
const script = JSON.parse(readFileSync(args.steps, 'utf8'))
const allowConsoleErrors = Array.isArray(script.allowConsoleErrors) ? script.allowConsoleErrors : []
mkdirSync(args['out-dir'], { recursive: true })

const browserPort = await freePort()
const browser = spawn(
  args.browser,
  [
    '--headless=new',
    '--disable-gpu',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--hide-scrollbars',
    `--window-size=${windowWidth},${windowHeight}`,
    `--remote-debugging-port=${browserPort}`,
    `--user-data-dir=${args['user-data-dir']}`,
    'about:blank'
  ],
  { stdio: 'ignore' }
)

/** @type {WebSocket | null} */
let socket = null
/** @type {string[]} */
const consoleErrors = []
/** @type {string[]} */
const pageErrors = []
/** @type {Array<{ label: string, ok: boolean, value: unknown }>} */
const checks = []
/** @type {string[]} */
const stepLog = []

/**
 * Fetch the DevTools HTTP endpoint until it answers.
 * @param {string} path
 * @param {RequestInit} [init]
 */
async function httpJson(path, init) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${browserPort}${path}`, init)
      if (response.ok) return await response.json()
    } catch {
      /* The browser is still starting. */
    }
    await sleep(250)
  }
  throw new Error(`devtools endpoint ${path} never became ready`)
}

try {
  await httpJson('/json/version')
  let page
  try {
    page = await httpJson('/json/new?about:blank', { method: 'PUT' })
  } catch {
    const targets = await httpJson('/json/list')
    page = targets.find((target) => target.type === 'page')
    if (page === undefined) throw new Error('devtools exposed no page target')
  }

  socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })

  let nextId = 0
  const pending = new Map()
  let sessionId

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.id !== undefined && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) reject(new Error(JSON.stringify(message.error)))
      else resolve(message.result)
      return
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      consoleErrors.push(message.params.args.map((arg) => arg.value ?? arg.description).join(' '))
    }
    if (message.method === 'Runtime.exceptionThrown') {
      pageErrors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text)
    }
  })

  /** Send one CDP command. */
  function send(method, params = {}) {
    const id = (nextId += 1)
    const payload = { id, method, params }
    if (sessionId !== undefined) payload.sessionId = sessionId
    socket.send(JSON.stringify(payload))
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
  }

  /** Evaluate one expression in the page. */
  async function evaluate(expression) {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails !== undefined) {
      return { error: result.exceptionDetails.exception?.description ?? result.exceptionDetails.text }
    }
    return { value: result.result.value }
  }

  /** Capture one screenshot. */
  async function screenshot(name) {
    const result = await send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(join(args['out-dir'], `${name}.png`), Buffer.from(result.data, 'base64'))
  }

  const attached = await send('Target.attachToTarget', { targetId: page.id, flatten: true })
  sessionId = attached.sessionId
  await send('Page.enable')
  await send('Runtime.enable')

  if (script.seed !== undefined) {
    /* Seed on the authenticated document: a 404 or the token exchange would not
     * commit an origin where localStorage is writable. */
    await send('Page.navigate', { url: pageUrl })
    await sleep(5000)
    for (const [key, value] of Object.entries(script.seed)) {
      const seeded = await evaluate(
        `(() => { try { window.localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(value)}); return window.localStorage.getItem(${JSON.stringify(key)}); } catch (error) { return 'error: ' + String(error); } })()`
      )
      stepLog.push(`SEED ${key} -> ${JSON.stringify(seeded.value ?? seeded.error)}`)
    }
  }

  await send('Page.navigate', { url: pageUrl })

  for (const step of script.steps ?? []) {
    if (step.log !== undefined) {
      stepLog.push(`LOG ${step.log}`)
      continue
    }
    if (step.wait !== undefined) {
      await sleep(step.wait)
      continue
    }
    if (step.navigate !== undefined) {
      /* A relative URL is resolved against the current page, so a suite can
       * follow an in-app link (for example an image URL) without knowing the
       * instance origin. */
      const target = String(step.navigate).startsWith('http')
        ? String(step.navigate)
        : new URL(String(step.navigate), pageUrl.replace(/\/?\?.*$/u, '/')).href
      await send('Page.navigate', { url: target })
      await sleep(step.waitAfter ?? 1500)
      stepLog.push(`NAVIGATE ${target.replace(/token=[^&\s]+/u, 'token=…')}`)
      continue
    }
    if (step.waitFor !== undefined) {
      const deadline = Date.now() + (step.timeout ?? 20_000)
      let found = false
      while (Date.now() < deadline) {
        const probe = await evaluate(`document.querySelector(${JSON.stringify(step.waitFor)}) !== null`)
        if (probe.value === true) {
          found = true
          break
        }
        await sleep(300)
      }
      stepLog.push(`WAITFOR ${step.waitFor} -> ${String(found)}`)
      continue
    }
    if (step.shot !== undefined) {
      await screenshot(step.shot)
      stepLog.push(`SHOT ${step.shot}`)
      continue
    }
    if (step.click !== undefined) {
      const result = await evaluate(
        `(() => { const el = document.querySelector(${JSON.stringify(step.click)}); if (el === null) return 'missing'; el.click(); return 'clicked'; })()`
      )
      stepLog.push(`CLICK ${step.click} -> ${String(result.value ?? result.error)}`)
      continue
    }
    if (step.clickText !== undefined) {
      const tag = step.tag ?? '*'
      const expression = `(() => {
        const wanted = ${JSON.stringify(step.clickText)};
        const nodes = [...document.querySelectorAll(${JSON.stringify(tag)})];
        const hit = nodes.find((el) => (el.textContent ?? '').trim() === wanted) ?? nodes.find((el) => (el.textContent ?? '').includes(wanted));
        if (hit === undefined) return 'missing: ' + nodes.length + ' nodes';
        hit.click();
        return 'clicked';
      })()`
      const result = await evaluate(expression)
      stepLog.push(`CLICKTEXT ${step.clickText} -> ${String(result.value ?? result.error)}`)
      continue
    }
    if (step.selectOption !== undefined) {
      const expression = `(() => {
        const el = document.querySelector(${JSON.stringify(step.selectOption.selector)});
        if (el === null) return 'missing';
        const wanted = ${JSON.stringify(step.selectOption.value)};
        if (![...el.options].some((option) => option.value === wanted)) return 'no option ' + wanted;
        const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
        setter.call(el, wanted);
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return 'selected';
      })()`
      const result = await evaluate(expression)
      stepLog.push(`SELECT ${step.selectOption.value} -> ${String(result.value ?? result.error)}`)
      continue
    }
    if (step.hoverSelector !== undefined) {
      const box = await evaluate(
        `(() => { const el = document.querySelector(${JSON.stringify(step.hoverSelector)}); if (el === null) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`
      )
      if (box.value === null || box.value === undefined) {
        stepLog.push(`HOVER ${step.hoverSelector} -> missing`)
        continue
      }
      await send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: box.value.x,
        y: box.value.y,
        button: 'none',
        buttons: 0
      })
      stepLog.push(`HOVER ${step.hoverSelector} -> ${box.value.x},${box.value.y}`)
      continue
    }
    if (step.eval !== undefined) {
      const result = await evaluate(step.eval)
      stepLog.push(`EVAL ${step.eval.slice(0, 70)} -> ${JSON.stringify(result.value ?? result.error)}`)
      continue
    }
    if (step.check !== undefined) {
      const result = await evaluate(step.expr)
      const ok = result.value === true
      checks.push({ label: step.check, ok, value: result.value ?? result.error })
      stepLog.push(
        `CHECK ${step.check} -> ${String(ok)}${ok ? '' : ` (${JSON.stringify(result.value ?? result.error)})`}`
      )
      continue
    }
    stepLog.push(`UNKNOWN STEP ${JSON.stringify(step)}`)
  }

  const facts = await evaluate(`(() => {
    const strip = document.querySelector('[data-dsh-chat-strip]');
    const token = document.querySelector('[data-dsh-token-total]');
    const progress = document.querySelector('.dshcb-progress-row');
    const rows = [...document.querySelectorAll('[data-slot="chat-background.item"] .dshcb-row')];
    const themeBody = document.body;
    return {
      title: document.title,
      htmlLang: document.documentElement.lang,
      marker: document.documentElement.getAttribute('data-dsh-chat-background'),
      sidebarMarker: document.documentElement.hasAttribute('data-dsh-chat-background-sidebar'),
      backgroundImage: document.documentElement.style.getPropertyValue('--dsh-chat-background-image'),
      scrim: document.documentElement.style.getPropertyValue('--dsh-chat-background-scrim'),
      veil: document.documentElement.style.getPropertyValue('--dsh-chat-background-sidebar-veil'),
      darkTheme: themeBody !== null && themeBody.hasAttribute('data-ds-dark-theme'),
      stripPresent: strip !== null,
      stripRect: strip === null ? null : (() => { const r = strip.getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }; })(),
      tokenPresent: token !== null,
      tokenText: token === null ? null : token.innerText,
      progressPresent: progress !== null,
      progressText: progress === null ? null : progress.innerText,
      settingsRowTitles: rows.map((row) => row.innerText.split('\\n')[0]),
      storedKeys: Object.keys(localStorage).filter((key) => key.startsWith('dsh-chat-background:')).sort()
    };
  })()`)

  const report = {
    url: maskToken(pageUrl),
    window: { width: windowWidth, height: windowHeight },
    ok: checks.every((check) => check.ok) && consoleErrors.length === 0 && pageErrors.length === 0,
    checks,
    steps: stepLog,
    facts: facts.value ?? facts.error,
    consoleErrors,
    pageErrors
  }
  writeFileSync(join(args['out-dir'], 'report.json'), `${JSON.stringify(report, null, 2)}\n`)

  const unexpectedConsoleErrors = consoleErrors.filter(
    (error) => !allowConsoleErrors.some((pattern) => error.includes(pattern))
  )
  const failed = report.checks.filter((check) => !check.ok)
  console.log(
    JSON.stringify(
      {
        suite: script.name ?? args.steps,
        checks: `${String(checks.length - failed.length)}/${String(checks.length)}`,
        failed: failed.map((check) => check.label),
        consoleErrors: unexpectedConsoleErrors.length,
        pageErrors: pageErrors.length,
        facts: report.facts
      },
      null,
      2
    )
  )
  process.exitCode = failed.length === 0 && unexpectedConsoleErrors.length === 0 && pageErrors.length === 0 ? 0 : 1
} catch (error) {
  console.error(`cdp driver failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  try {
    socket?.close()
  } catch {
    /* Closing an already-closed socket is fine. */
  }
  try {
    browser.kill()
  } catch {
    /* The browser may already be gone. */
  }
}
