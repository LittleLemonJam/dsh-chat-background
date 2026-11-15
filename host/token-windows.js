/**
 * Calendar-month and subscription-week token usage for the sidebar footer.
 *
 * Both windows are read from the optional `dsh-cost-meter` ledger at
 * `<dsh home>/storages/cost-meter/ledger.json`:
 *
 * - `days` holds per-local-day token buckets for every tracked DSH call, so the
 *   calendar month is the sum of the day keys in the current local month;
 * - `planSamples.go.weekly` holds the subscription quota samples (window start
 *   `s`, reset `r`, live token count `lt`, percent `p`), so the week follows the
 *   subscription's own reset schedule instead of ISO/calendar weeks.
 *
 * The ledger is another plugin's storage, so every field is optional and a
 * missing/changed ledger simply leaves the extra lines unavailable.
 */
import { readFile } from 'node:fs/promises'

/** Maximum ledger size worth parsing on the poll path. */
const MAX_LEDGER_BYTES = 64 * 1024 * 1024

/** Source label included in the route payload. */
export const TOKEN_WINDOW_SOURCE = 'dsh-cost-meter'

/** Token buckets tracked by the cost-meter day records. */
const DAY_TOKEN_KEYS = ['input', 'output', 'cacheRead', 'cacheWrite']

/**
 * Sum one cost-meter day record.
 * @param day - a `ledger.days[date]` record.
 * @returns the four token buckets combined.
 */
export function tokensOfDay(day) {
  if (day === null || typeof day !== 'object') return 0
  let total = 0
  for (const key of DAY_TOKEN_KEYS) {
    const amount = Number(day[key])
    if (Number.isFinite(amount) && amount > 0) total += amount
  }
  return total
}

/**
 * The local calendar month containing `now`.
 * @param now - epoch milliseconds.
 * @returns the month key and inclusive start / exclusive end.
 */
export function localMonthWindow(now) {
  const date = new Date(now)
  const year = date.getFullYear()
  const month = date.getMonth()
  const start = new Date(year, month, 1, 0, 0, 0, 0)
  const end = new Date(year, month + 1, 1, 0, 0, 0, 0)
  const pad = (value) => String(value).padStart(2, '0')
  return {
    monthKey: `${String(year)}-${pad(month + 1)}`,
    from: start.toISOString(),
    to: end.toISOString()
  }
}

/**
 * Sum the calendar-month days present in the ledger.
 * @param ledger - parsed ledger.
 * @param now - epoch milliseconds.
 * @returns the monthly window payload, or null when the ledger has no days.
 */
export function readMonthlyTokens(ledger, now) {
  const days = ledger?.days
  if (days === null || typeof days !== 'object') return null
  const window = localMonthWindow(now)
  let tokens = 0
  let daysCounted = 0
  for (const [date, day] of Object.entries(days)) {
    if (!date.startsWith(window.monthKey)) continue
    const amount = tokensOfDay(day)
    if (amount <= 0) continue
    tokens += amount
    daysCounted += 1
  }
  return { tokens, days: daysCounted, ...window, source: TOKEN_WINDOW_SOURCE }
}

/**
 * Normalize the weekly quota samples into comparable windows.
 * @param ledger - parsed ledger.
 * @returns samples with epoch boundaries, newest first.
 */
function weeklySamples(ledger) {
  const samples = ledger?.planSamples?.go?.weekly
  if (!Array.isArray(samples)) return []
  const rows = []
  for (const sample of samples) {
    if (sample === null || typeof sample !== 'object') continue
    const resetMs = Date.parse(sample.r)
    if (!Number.isFinite(resetMs)) continue
    const startMs = Number(sample.s)
    rows.push({
      at: Number(sample.t) || 0,
      startMs: Number.isFinite(startMs) ? startMs : resetMs - 7 * 24 * 60 * 60 * 1000,
      resetMs,
      tokens: Number(sample.lt),
      percent: Number(sample.p)
    })
  }
  return rows.sort((left, right) => right.at - left.at)
}

/**
 * Sum Go plan hourly buckets inside one subscription window.
 * @param ledger - parsed ledger.
 * @param startMs - inclusive window start.
 * @param endMs - exclusive window end.
 * @returns the summed tokens.
 */
function sumHourlyBuckets(ledger, startMs, endMs) {
  const buckets = ledger?.planHourBuckets?.go
  if (buckets === null || typeof buckets !== 'object') return null
  let tokens = 0
  for (const [key, value] of Object.entries(buckets)) {
    const at = Number(key)
    if (!Number.isFinite(at) || at < startMs || at >= endMs) continue
    const amount = Number(value?.tokens)
    if (Number.isFinite(amount) && amount > 0) tokens += amount
  }
  return tokens
}

/**
 * The current subscription week, preferring the sample whose window contains
 * `now` and falling back to the newest sample.
 * @param ledger - parsed ledger.
 * @param now - epoch milliseconds.
 * @returns the weekly payload, or null when no usable sample exists.
 */
export function readWeeklyTokens(ledger, now) {
  const samples = weeklySamples(ledger)
  const covering = samples.find((sample) => sample.startMs <= now && now < sample.resetMs)
  const sample = covering ?? samples[0]
  if (sample === undefined) return null
  const endMs = Math.min(now, sample.resetMs)
  let tokens = Number.isFinite(sample.tokens) && sample.tokens >= 0 ? sample.tokens : null
  if (tokens === null) tokens = sumHourlyBuckets(ledger, sample.startMs, endMs)
  return {
    tokens,
    percent: Number.isFinite(sample.percent) ? sample.percent : null,
    windowStart: new Date(sample.startMs).toISOString(),
    windowEnd: new Date(sample.resetMs).toISOString(),
    resetAt: new Date(sample.resetMs).toISOString(),
    source: TOKEN_WINDOW_SOURCE
  }
}

/**
 * Build both windows from one parsed ledger.
 * @param ledger - parsed ledger.
 * @param now - epoch milliseconds.
 * @returns monthly and weekly payloads (either may be null).
 */
export function readTokenWindowsFromLedger(ledger, now = Date.now()) {
  return {
    monthly: readMonthlyTokens(ledger, now),
    weekly: readWeeklyTokens(ledger, now)
  }
}

/**
 * Read the cost-meter ledger and build the extra token windows. The caller
 * treats a null result as "feature unavailable".
 * @param ledgerPath - absolute `ledger.json` path.
 * @param now - epoch milliseconds.
 * @returns the windows, or null when the ledger is absent/unreadable.
 */
export async function readTokenWindows(ledgerPath, now = Date.now()) {
  try {
    const info = await readFile(ledgerPath, 'utf8')
    if (Buffer.byteLength(info) > MAX_LEDGER_BYTES) return null
    const ledger = JSON.parse(info)
    return readTokenWindowsFromLedger(ledger, now)
  } catch {
    return null
  }
}
