/**
 * HTTP handlers for the four routes this plugin owns.
 *
 * The Web server hands the raw Node `request`/`response` pair over, so this
 * module owns status codes, headers, bodies and failure text. Only `node:`
 * builtins are imported: a profile-installed package cannot resolve the
 * installation's `@deepseek-ai/*` packages.
 *
 * Security model (`SEC-01`, `SEC-02`, `SEC-04`, `SEC-06`):
 *   - the routes are same-origin resources on a local, unauthenticated server,
 *     so every request passes the same kind of fence the Host `/api` route
 *     implements: a loopback/known `Host`, no `Sec-Fetch-Site: cross-site`, and
 *     an `Origin`, when present, equal to the request authority;
 *   - the image manifest is the only set of names the file route serves;
 *   - every response carries nosniff/CORP/referrer headers, and SVG (the only
 *     accepted format browsers can execute when opened top-level) also carries
 *     a sandboxing CSP.
 */
import { spawn } from 'node:child_process'
import { constants as fsConstants } from 'node:fs'
import { mkdir, open } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, relative } from 'node:path'
import {
  FILE_PREFIX,
  FOLDER_HEADER,
  FOLDER_HEADER_VALUE,
  IMAGE_CACHE_CONTROL,
  IMAGE_DOCUMENT_CSP,
  MANIFEST_CACHE_MS,
  MAX_IMAGE_BYTES,
  MAX_MANIFEST_ENTRIES,
  SECURITY_HEADERS,
  TOKEN_CACHE_MS
} from './constants.js'
import {
  ACCEPTED_EXTENSIONS,
  findManifestEntry,
  mediaTypeFor,
  readImageManifestDetailed,
  safeImageName
} from './media.js'
import { missingTotalsPayload, readTokenTotals } from './token-usage.js'

/** How long the folder-open child may take to report success before failing. */
const SPAWN_TIMEOUT_MS = 2_500

/**
 * Open flags for image reads. POSIX gets O_NOFOLLOW, so a file swapped for a
 * symlink after the manifest check cannot be followed outside the folder
 * (SEC-05); Windows has no equivalent final-component guarantee and uses a
 * plain read.
 */
const IMAGE_OPEN_FLAGS = process.platform === 'win32' ? 'r' : fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW

/**
 * Merge the headers every response carries.
 * @param extra - route-specific headers.
 */
function withSecurityHeaders(extra = {}) {
  return { ...SECURITY_HEADERS, ...extra }
}

/**
 * Write a JSON body.
 * @param response - Node response.
 * @param status - HTTP status code.
 * @param value - JSON-serialisable payload.
 * @param options - `head` for a HEAD answer, plus extra headers.
 */
function sendJson(response, status, value, options = {}) {
  const body = Buffer.from(`${JSON.stringify(value)}\n`, 'utf8')
  response.writeHead(
    status,
    withSecurityHeaders({
      'content-type': 'application/json; charset=utf-8',
      'content-length': String(body.byteLength),
      'cache-control': 'no-store',
      ...(options.headers ?? {})
    })
  )
  response.end(options.head === true ? undefined : body)
}

/**
 * Write a plain-text failure; the browser half surfaces the message verbatim.
 * @param response - Node response.
 * @param status - HTTP status code.
 * @param message - one line of human-readable text.
 * @param options - `head` for a HEAD answer, plus extra headers.
 */
function sendError(response, status, message, options = {}) {
  const body = Buffer.from(`${message}\n`, 'utf8')
  response.writeHead(
    status,
    withSecurityHeaders({
      'content-type': 'text/plain; charset=utf-8',
      'content-length': String(body.byteLength),
      'cache-control': 'no-store',
      ...(options.headers ?? {})
    })
  )
  response.end(options.head === true ? undefined : body)
}

/**
 * Log a caught value without assuming it is an `Error`.
 * @param logger - host logger.
 * @param error - caught value.
 */
function logFailure(logger, error) {
  logger?.warn?.(error instanceof Error ? error : new Error(String(error)))
}

/** The request method, defaulting to GET when absent. */
function methodOf(request) {
  return (request.method ?? 'GET').toUpperCase()
}

/**
 * Reject a method the route does not answer.
 * @returns whether the caller may continue.
 */
function allowMethod(request, response, methods) {
  const method = methodOf(request)
  if (methods.includes(method)) return true
  sendError(response, 405, 'method not allowed', { headers: { allow: methods.join(', ') } })
  return false
}

/**
 * The request pathname, or null when the URL cannot be parsed.
 * @param request - Node request.
 */
function requestPath(request) {
  try {
    return new URL(request.url ?? '/', 'http://localhost').pathname
  } catch {
    return null
  }
}

/**
 * Whether an `If-None-Match` header names the given entity tag. Weak prefixes
 * and comma-separated lists are accepted, per RFC 9110.
 * @param request - Node request.
 * @param etag - strong entity tag, quotes included.
 */
function isNotModified(request, etag) {
  const header = request.headers['if-none-match']
  if (typeof header !== 'string' || header === '') return false
  return header
    .split(',')
    .map((tag) => tag.trim())
    .some((tag) => tag.replace(/^W\//iu, '') === etag)
}

/**
 * The requester's `Host`, parsed. The browser always sends it from the URL,
 * which is why it is the anchor of the DNS-rebinding fence (`SEC-02`).
 * @param request - Node request.
 * @returns the parsed authority, or null when missing/malformed.
 */
function requestAuthority(request) {
  const raw = request.headers.host
  if (typeof raw !== 'string' || raw === '') return null
  try {
    const url = new URL(`http://${raw}`)
    return { host: url.host, hostname: url.hostname.toLowerCase() }
  } catch {
    return null
  }
}

/**
 * Whether a browser request is marked as same-origin (or as no-cors `none`,
 * which a direct address-bar navigation sends). Requests without the header are
 * accepted so older clients keep working; the header is defence in depth on top
 * of the Host/Origin fence.
 * @param request - Node request.
 * @returns whether the Fetch metadata allows the side effect.
 */
function hasSameOriginFetch(request) {
  const site = request.headers['sec-fetch-site']
  return typeof site !== 'string' || site === 'same-origin' || site === 'none'
}

/**
 * Whether the request comes from the application's own browser context.
 * @param request - Node request.
 * @param trustedHosts - accepted host names, or null to disable the host check.
 */
function isTrustedRequest(request, trustedHosts) {
  const authority = requestAuthority(request)
  if (authority === null) return false
  if (trustedHosts !== null && !trustedHosts.has(authority.hostname)) return false
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers.origin
  if (typeof origin === 'string' && origin !== '') {
    if (origin === 'null') return false
    try {
      if (new URL(origin).host !== authority.host) return false
    } catch {
      return false
    }
  }
  return true
}

/**
 * The folder path as shown to the user: the home directory is abbreviated, so
 * responses do not leak the OS user name and full directory layout (`SEC-03`).
 * @param folder - absolute folder path.
 */
function displayFolder(folder) {
  const home = homedir()
  if (folder === home) return '~'
  const separator = process.platform === 'win32' ? '\\' : '/'
  if (folder.startsWith(`${home}${separator}`)) return `~${folder.slice(home.length)}`
  return folder
}

/**
 * Reveal a directory in the platform file manager.
 *
 * Resolves once the file manager process actually spawned (or after a short
 * grace period on platforms that report no spawn event) and rejects when it
 * cannot start, so the route can answer honestly (`SEC-07`).
 * @param dir - absolute directory path.
 * @param logger - host logger.
 */
function openInFileManager(dir, logger) {
  const command = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open'
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(command, [dir], { detached: true, stdio: 'ignore' })
    } catch (error) {
      reject(error)
      return
    }
    let settled = false
    /** @param {Error | undefined} error */
    const finish = (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error !== undefined) reject(error)
      else resolve()
    }
    const timer = setTimeout(() => {
      child.kill()
      finish(new Error(`file manager did not succeed: ${command}`))
    }, SPAWN_TIMEOUT_MS)
    child.once('error', (error) => {
      logFailure(logger, error)
      finish(error)
    })
    if (process.platform === 'win32') {
      /* explorer.exe keeps running; a successful spawn is the best signal. */
      child.once('spawn', () => {
        child.unref()
        finish()
      })
    } else {
      /* open / xdg-open exit quickly and report failure through the exit code. */
      child.once('exit', (code) => {
        if (code === 0) finish()
        else finish(new Error(`file manager exited with code ${String(code)}: ${command}`))
      })
    }
  })
}

/**
 * Build the shared route handlers for one folder.
 * @param options - resolved folder, logger, token provider, request fence and limits.
 * @returns the route handlers keyed by route.
 */
export function createHandlers({
  folder,
  logger,
  tokenDirectory,
  tokenProvider = null,
  tokenCacheMs = TOKEN_CACHE_MS,
  manifestCacheMs = MANIFEST_CACHE_MS,
  trustedHosts = null,
  maxImageBytes = MAX_IMAGE_BYTES,
  version = 'unknown'
}) {
  const readTokenPayload = tokenProvider ?? (async () => readTokenTotals(tokenDirectory))

  /* The scan reads every session's projection, so its result is reused for a
   * short window while the browser polls. A missing cache is cached as a zero
   * payload too, so an early page load does not rescan on every request. */
  let tokenCache = { at: 0, payload: null }

  /* `list` and `files` share one short-lived directory listing: the manifest is
   * the file route's allow-list, and the settings row asks for it right before
   * the browser fetches the chosen image. */
  let manifestCache = { at: 0, entries: [], truncated: false }

  async function listManifest() {
    if (manifestCache.at !== 0 && Date.now() - manifestCache.at <= manifestCacheMs) return manifestCache
    const { entries, truncated } = await readImageManifestDetailed(folder)
    manifestCache = { at: Date.now(), entries, truncated }
    return manifestCache
  }

  /**
   * Apply the request fence.
   * @returns whether the handler may continue.
   */
  function guard(request, response, head = false) {
    if (isTrustedRequest(request, trustedHosts)) return true
    sendError(response, 403, 'untrusted request origin', { head })
    return false
  }

  async function list(request, response) {
    const head = methodOf(request) === 'HEAD'
    if (!guard(request, response, head)) return
    if (!allowMethod(request, response, ['GET', 'HEAD'])) return
    try {
      await mkdir(folder, { recursive: true })
      const manifest = await listManifest()
      sendJson(
        response,
        200,
        {
          folder: displayFolder(folder),
          accepted: ACCEPTED_EXTENSIONS,
          images: manifest.entries,
          truncated: manifest.truncated
        },
        { head }
      )
    } catch (error) {
      logFailure(logger, error)
      sendError(response, 500, 'background folder could not be read', { head })
    }
  }

  async function tokenTotal(request, response) {
    const head = methodOf(request) === 'HEAD'
    if (!guard(request, response, head)) return
    if (!allowMethod(request, response, ['GET', 'HEAD'])) return
    try {
      const fresh = tokenCache.payload !== null && Date.now() - tokenCache.at <= tokenCacheMs
      if (!fresh) {
        const value = await readTokenPayload()
        tokenCache = { at: Date.now(), payload: value ?? missingTotalsPayload() }
      }
      sendJson(response, 200, tokenCache.payload, { head })
    } catch (error) {
      logFailure(logger, error)
      sendError(response, 500, 'token usage could not be read', { head })
    }
  }

  async function health(request, response) {
    const head = methodOf(request) === 'HEAD'
    if (!guard(request, response, head)) return
    if (!allowMethod(request, response, ['GET', 'HEAD'])) return
    sendJson(
      response,
      200,
      {
        ok: true,
        version,
        folder: displayFolder(folder),
        accepted: ACCEPTED_EXTENSIONS,
        limits: { maxImageBytes, maxManifestEntries: MAX_MANIFEST_ENTRIES, manifestCacheMs, tokenCacheMs },
        fence: trustedHosts === null ? 'off' : 'on'
      },
      { head }
    )
  }

  async function file(request, response) {
    const head = methodOf(request) === 'HEAD'
    if (!guard(request, response, head)) return
    if (!allowMethod(request, response, ['GET', 'HEAD'])) return
    const pathname = requestPath(request)
    const wanted =
      pathname !== null && pathname.startsWith(`${FILE_PREFIX}/`) ? pathname.slice(FILE_PREFIX.length + 1) : ''
    let name
    try {
      name = safeImageName(decodeURIComponent(wanted))
    } catch {
      /* A malformed percent-encoding is just an unknown image. */
      name = undefined
    }
    if (name === undefined) {
      sendError(response, 404, 'unknown background image', { head })
      return
    }
    let entry
    try {
      entry = findManifestEntry((await listManifest()).entries, name)
    } catch (error) {
      logFailure(logger, error)
      sendError(response, 500, 'background folder could not be read', { head })
      return
    }
    if (entry === undefined) {
      /* The manifest is the access-control list: unlisted names, including
       * Windows 8.3 aliases and hidden files, are not served (`SEC-04`). */
      sendError(response, 404, 'unknown background image', { head })
      return
    }
    const target = join(folder, entry.name)
    /* `entry.name` is a listed single segment; keep the containment assertion
     * explicit because this is the only path-shaped input. */
    if (relative(folder, target) !== entry.name) {
      sendError(response, 404, 'unknown background image', { head })
      return
    }
    let handle
    try {
      handle = await open(target, IMAGE_OPEN_FLAGS)
    } catch {
      sendError(response, 404, 'unknown background image', { head })
      return
    }
    let info
    try {
      info = await handle.stat()
    } catch (error) {
      await handle.close().catch(() => {})
      logFailure(logger, error)
      sendError(response, 404, 'unknown background image', { head })
      return
    }
    if (!info.isFile()) {
      await handle.close().catch(() => {})
      sendError(response, 404, 'unknown background image', { head })
      return
    }
    if (info.size > maxImageBytes) {
      await handle.close().catch(() => {})
      sendError(response, 413, 'background image is too large', { head })
      return
    }
    const mediaType = mediaTypeFor(entry.name)
    const etag = `"${info.size.toString(36)}-${Math.floor(info.mtimeMs).toString(36)}"`
    const headers = withSecurityHeaders({
      'content-type': mediaType,
      'content-length': String(info.size),
      etag,
      'cache-control': IMAGE_CACHE_CONTROL
    })
    if (mediaType === 'image/svg+xml') headers['content-security-policy'] = IMAGE_DOCUMENT_CSP
    if (isNotModified(request, etag)) {
      await handle.close().catch(() => {})
      response.writeHead(304, headers)
      response.end()
      return
    }
    if (head) {
      await handle.close().catch(() => {})
      response.writeHead(200, headers)
      response.end()
      return
    }
    response.writeHead(200, headers)
    const stream = handle.createReadStream()
    stream.once('error', (error) => {
      logFailure(logger, error)
      response.destroy()
    })
    /* A browser that navigates away mid-download leaves the read stream open
     * unless the response close is forwarded to it. */
    response.once('close', () => stream.destroy())
    stream.pipe(response)
  }

  async function revealFolder(request, response) {
    if (!guard(request, response)) return
    if (!allowMethod(request, response, ['POST'])) return
    /* The route is public and has a visible side effect; a cross-site request
     * cannot attach this header without a CORS preflight, which this server
     * does not answer (`BG-10`), and same-origin browser requests additionally
     * carry `Sec-Fetch-Site` (`SEC-02`). */
    if (request.headers[FOLDER_HEADER] !== FOLDER_HEADER_VALUE) {
      sendError(response, 403, 'missing chat-background request header')
      return
    }
    if (!hasSameOriginFetch(request)) {
      sendError(response, 403, 'untrusted request origin')
      return
    }
    try {
      await mkdir(folder, { recursive: true })
      await openInFileManager(folder, logger)
      sendJson(response, 200, { folder: displayFolder(folder), opened: true })
    } catch (error) {
      logFailure(logger, error)
      sendError(response, 500, 'background folder could not be opened')
    }
  }

  return { list, file, revealFolder, tokenTotal, health }
}
