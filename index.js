/**
 * Host half of the dsh-chat-background bundle.
 *
 * Serves the user's background folder over the local Web server so the browser
 * half can list and display those images, and aggregates the all-sessions token
 * total the sidebar line shows. It deliberately imports nothing outside
 * `node:` builtins and its own `host/` modules: a profile-installed package
 * cannot resolve the installation's `@deepseek-ai/*` packages.
 *
 * The routes are registered next to the application's own `/api` route and are
 * equally reachable from a browser, so they apply their own request fence
 * (`SEC-02`). The token total prefers the documented Host services and falls
 * back to scanning the projection cache on disk.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  FILE_PREFIX,
  FOLDER_PATH,
  HEALTH_PATH,
  LIST_PATH,
  TOKEN_CACHE_MS,
  TOKEN_PATH,
  TRUSTED_HOSTS_ENV
} from './host/constants.js'
import { backgroundsDir, dshHomeDir } from './host/paths.js'
import { createHandlers } from './host/routes.js'
import { readTokenTotals, readTokenTotalsFromServices } from './host/token-usage.js'

/** This plugin owns five routes on the Web server. */
export const inject = ['webServer']

/** The installed package version, reported by the health route. */
const PACKAGE_VERSION = (() => {
  try {
    return JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version ?? 'unknown'
  } catch {
    return 'unknown'
  }
})()

/** Hostnames that always identify this machine. */
const LOOPBACK_HOSTNAMES = ['127.0.0.1', 'localhost', '[::1]', '::1']

/**
 * The hostnames the request fence accepts: loopback names, the Web server's own
 * advertised origin, and anything listed in the env override. `*` disables the
 * host check for a remote-access proxy that rewrites `Host`.
 * @param ctx - host plugin context.
 * @returns accepted hostnames, or null when the check is disabled.
 */
function resolveTrustedHosts(ctx) {
  const override = process.env[TRUSTED_HOSTS_ENV]
  if (typeof override === 'string' && override.trim() === '*') return null
  const hosts = new Set(LOOPBACK_HOSTNAMES)
  try {
    const origin = ctx.webServer?.getOrigin?.()
    if (typeof origin === 'string' && origin !== '') hosts.add(new URL(origin).hostname.toLowerCase())
  } catch {
    /* An unavailable origin just leaves the loopback list in place. */
  }
  if (typeof override === 'string') {
    for (const part of override.split(',')) {
      const name = part.trim().toLowerCase()
      if (name !== '') hosts.add(name)
    }
  }
  return hosts
}

/**
 * Build the token-total provider. Prefers the documented Host services, falls
 * back to the projection-cache files when they are not mounted.
 * @param ctx - host plugin context.
 * @param tokenDirectory - projection-cache directory used by the fallback.
 * @returns a function returning the aggregate payload or null.
 */
function createTokenProvider(ctx, tokenDirectory) {
  const serviceTotals = async () => {
    const persistence = ctx.get?.('sessionPersistence')
    const projectionCache = ctx.get?.('sessionProjectionCache')
    if (typeof persistence?.list !== 'function' || typeof projectionCache?.cachedSnapshot !== 'function') return null
    return readTokenTotalsFromServices({ persistence, projectionCache })
  }
  return async () => {
    try {
      const fromServices = await serviceTotals()
      if (fromServices !== null) return fromServices
    } catch (error) {
      ctx.logger?.warn?.(error instanceof Error ? error : new Error(String(error)))
    }
    return readTokenTotals(tokenDirectory)
  }
}

/**
 * Register the background routes; disposal removes them with the plugin.
 * @param ctx - host plugin context carrying the Web server service.
 */
export function apply(ctx) {
  const folder = backgroundsDir()
  const tokenDirectory = join(dshHomeDir(), 'storages', 'session_projcache', 'sessions')
  const handlers = createHandlers({
    folder,
    logger: ctx.logger,
    tokenCacheMs: TOKEN_CACHE_MS,
    tokenProvider: createTokenProvider(ctx, tokenDirectory),
    trustedHosts: resolveTrustedHosts(ctx),
    version: PACKAGE_VERSION
  })
  if (!existsSync(folder)) ctx.logger?.info?.(`chat-background: folder ${folder} will be created on first request`)
  ctx.effect(
    () => ctx.webServer.register({ kind: 'exact', path: LIST_PATH, handler: handlers.list }),
    'chat-background: background list route'
  )
  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: FILE_PREFIX, handler: handlers.file }),
    'chat-background: background image route'
  )
  ctx.effect(
    () => ctx.webServer.register({ kind: 'exact', path: FOLDER_PATH, handler: handlers.revealFolder }),
    'chat-background: open folder route'
  )
  ctx.effect(
    () => ctx.webServer.register({ kind: 'exact', path: TOKEN_PATH, handler: handlers.tokenTotal }),
    'chat-background: token total route'
  )
  ctx.effect(
    () => ctx.webServer.register({ kind: 'exact', path: HEALTH_PATH, handler: handlers.health }),
    'chat-background: health route'
  )
}
