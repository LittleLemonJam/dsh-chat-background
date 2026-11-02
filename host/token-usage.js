/**
 * All-sessions token aggregation.
 *
 * Two data sources, preferred first:
 *
 *  1. the documented Host services `sessionPersistence.list()` plus
 *     `sessionProjectionCache.cachedSnapshot(header, ['tokenUsage'])`. They
 *     return the cached `tokenUsage` projection value directly, are independent
 *     of the projection cache's on-disk layout, and work with any storage
 *     backend (`SEC` / implementation review: the disk layout is an
 *     implementation detail and may change between DSH versions);
 *  2. the original straight scan of
 *     `<dsh home>/storages/session_projcache/sessions/*.json`, used when those
 *     services are not mounted (older composition, headless profile).
 *
 * The browser half cannot read the host, so it asks through
 * `/chat-backgrounds/token-total`.
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { MAX_TOKEN_FILES } from './constants.js'

/** The four token buckets every provider records, in display order. */
export const TOKEN_KEYS = ['uncachedInputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens']

/** The projection key the token meter registers. */
const TOKEN_PROJECTION_KEY = 'tokenUsage'

/** One projection file is expected to stay small; skip anything pathological. */
export const MAX_PROJECTION_BYTES = 8 * 1024 * 1024

/** Parallel file reads; enough to keep the scan quick without a file-handle storm. */
const READ_CONCURRENCY = 8

/** Zero-filled bucket object. */
export function emptyTotals() {
  return Object.fromEntries(TOKEN_KEYS.map((key) => [key, 0]))
}

/**
 * Run an async worker over a list with a fixed concurrency.
 * @param items - input values.
 * @param limit - maximum concurrent workers.
 * @param worker - async mapper.
 * @returns results in input order.
 */
async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length)
  let cursor = 0
  const run = async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await worker(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run))
  return results
}

/**
 * Fold one projection value into the accumulator.
 * @param value - `tokenUsage` projection value (the four buckets) or an unknown.
 * @param totals - accumulator mutated in place.
 * @returns whether any bucket contributed.
 */
function foldTokenValue(value, totals) {
  if (value === null || typeof value !== 'object') return false
  let contributed = false
  for (const key of TOKEN_KEYS) {
    const amount = Number(value[key])
    if (Number.isFinite(amount) && amount > 0) {
      totals[key] += amount
      contributed = true
    }
  }
  return contributed
}

/**
 * Sum token usage through the documented Host services.
 *
 * `cachedSnapshot` is documented as "as stale as the last durable checkpoint but
 * never wrong", which matches what the on-disk scan would see.
 * @param options - the two Host services.
 * @returns the summed buckets plus session counts, or null when nothing is readable.
 */
export async function readTokenTotalsFromServices({ persistence, projectionCache }) {
  const sessions = await persistence.list()
  if (!Array.isArray(sessions)) return null
  const totals = emptyTotals()
  let countedSessions = 0
  for (const session of sessions) {
    let snapshot
    try {
      snapshot = projectionCache.cachedSnapshot(session?.header, [TOKEN_PROJECTION_KEY])
    } catch {
      continue
    }
    const value = snapshot?.values?.[TOKEN_PROJECTION_KEY]
    if (foldTokenValue(value, totals)) countedSessions += 1
  }
  const total = TOKEN_KEYS.reduce((sum, key) => sum + totals[key], 0)
  return { total, ...totals, sessions: sessions.length, countedSessions, scannedAt: Date.now(), source: 'services' }
}

/**
 * Read one projection file and return its token contribution.
 * @param directory - projection-cache directory.
 * @param name - file name.
 * @returns the four buckets when the file contributes, otherwise null.
 */
async function readProjectionContribution(directory, name) {
  try {
    const info = await stat(join(directory, name))
    if (!info.isFile() || info.size > MAX_PROJECTION_BYTES) return null
    const parsed = JSON.parse(await readFile(join(directory, name), 'utf8'))
    const value = parsed?.record?.rows?.tokenUsage?.val?.totals
    const contribution = emptyTotals()
    return foldTokenValue(value, contribution) ? contribution : null
  } catch {
    /* A half-written or foreign file simply does not contribute. */
    return null
  }
}

/**
 * Sum token usage by scanning the cached projection files directly. This is the
 * fallback for compositions without the two Host services; the file count is
 * capped so a pathological cache cannot stall the request (`SEC-08`).
 * @param directory - absolute projection-cache directory.
 * @returns the summed buckets plus session counts, or null when the cache is absent.
 */
export async function readTokenTotals(directory) {
  let names
  try {
    names = await readdir(directory)
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
  const projections = names.filter((name) => name.endsWith('.json')).slice(0, MAX_TOKEN_FILES)
  const contributions = await mapWithConcurrency(projections, READ_CONCURRENCY, (name) =>
    readProjectionContribution(directory, name)
  )
  const totals = emptyTotals()
  let countedSessions = 0
  for (const contribution of contributions) {
    if (contribution === null) continue
    countedSessions += 1
    for (const key of TOKEN_KEYS) totals[key] += contribution[key]
  }
  const total = TOKEN_KEYS.reduce((sum, key) => sum + totals[key], 0)
  return { total, ...totals, sessions: projections.length, countedSessions, scannedAt: Date.now(), source: 'files' }
}

/**
 * The payload served while no projection cache exists yet.
 * @returns an all-zero payload flagged `missing`.
 */
export function missingTotalsPayload() {
  return {
    total: 0,
    ...emptyTotals(),
    sessions: 0,
    countedSessions: 0,
    scannedAt: Date.now(),
    missing: true,
    source: 'none'
  }
}
