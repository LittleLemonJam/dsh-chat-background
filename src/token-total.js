/**
 * The sidebar footer line with the all-sessions token total.
 *
 * The number is aggregated by the host half (`/chat-backgrounds/token-total`);
 * this module injects the line right above the account row, polls the route once
 * a minute, and re-inserts the node whenever a React render of the footer drops
 * it. The font size comes from the settings row through one inline custom
 * property, so the slider restyles the line without a re-render.
 */
import {
  TOKEN_NODE_ATTRIBUTE,
  TOKEN_SIZE_DEFAULT,
  TOKEN_SIZE_KEY,
  TOKEN_SIZE_MAX,
  TOKEN_SIZE_MIN,
  TOKEN_URL
} from './constants.js'
import { recordDiagnostics } from './diagnostics.js'
import { copyNow } from './i18n.js'
import { formatCompactTokens } from './lib/format.js'
import { readPercent } from './storage.js'
import { settings } from './settings.js'

/** Last response of the host aggregation, or null before the first answer. */
let tokenValue = null

/** Clear the cached value so a re-enabled plugin does not show stale data. */
export function resetTokenTotal() {
  tokenValue = null
}

/** Cached sidebar anchor; invalidated when either endpoint is detached. */
/** @type {{ parent: Element, before: Element | null } | null} */
let cachedAnchor = null

/** The line's font size in px, clamped to the slider's range. */
function readTokenSize() {
  return readPercent(TOKEN_SIZE_KEY, TOKEN_SIZE_DEFAULT, TOKEN_SIZE_MIN, TOKEN_SIZE_MAX)
}

/** Publish the font size as one inline custom property on `<html>`. */
export function applyTokenSize() {
  document.documentElement.style.setProperty('--dsh-token-size', `${readTokenSize()}px`)
}

/** Ask the host half for the all-sessions total. */
export function refreshTokenTotal() {
  return fetch(TOKEN_URL, { headers: { accept: 'application/json' } })
    .then((response) => (response.ok ? response.json() : null))
    .then((payload) => {
      if (payload !== null && typeof payload === 'object') {
        tokenValue = payload
        recordDiagnostics({
          token: {
            status: 'ok',
            total: payload.total,
            source: payload.source ?? 'unknown',
            sessions: payload.sessions,
            at: Date.now()
          }
        })
        renderTokenTotal()
      } else {
        recordDiagnostics({ token: { status: 'http-error', at: Date.now() } })
      }
      return payload
    })
    .catch((error) => {
      recordDiagnostics({ token: { status: 'network-error', error: String(error), at: Date.now() } })
      return null
    })
}

/**
 * Find where the token line goes: directly above the sidebar's account row.
 *
 * The row has no stable slot of its own, so three anchors are tried from most
 * to least specific, and each is validated by position (bottom-left of the
 * window). A future sidebar rebuild still has a chance to place the line.
 * @returns the parent and the sibling to insert before, or null.
 */
function findAccountAnchor() {
  if (
    cachedAnchor !== null &&
    cachedAnchor.parent.isConnected &&
    (cachedAnchor.before === null || cachedAnchor.before.isConnected)
  ) {
    return cachedAnchor
  }
  cachedAnchor = null
  /** @type {Array<{ parent: Element, before: Element | null }>} */
  const candidates = []
  const account = document.querySelector('[class*="settingsArea"]')
  if (account !== null && account.parentElement !== null) {
    candidates.push({ parent: account.parentElement, before: account })
  }
  const settingsSlot = document.querySelector('[data-slot="sidebar.settings"]')
  const settingsRow = settingsSlot === null ? null : settingsSlot.parentElement
  if (settingsRow !== null && settingsRow.parentElement !== null) {
    candidates.push({ parent: settingsRow.parentElement, before: settingsRow })
  }
  const foot = document.querySelector('[class*="footArea"]')
  if (foot !== null) candidates.push({ parent: foot, before: foot.lastElementChild })
  for (const candidate of candidates) {
    const rect = candidate.parent.getBoundingClientRect()
    const inSidebarFooter = rect.width > 100 && rect.left < window.innerWidth * 0.5
    const nearBottom = rect.bottom > window.innerHeight * 0.6
    if (inSidebarFooter && nearBottom) {
      cachedAnchor = candidate
      return candidate
    }
  }
  return null
}

/**
 * Keep the token line mounted directly above the sidebar's account row. The
 * node is ours, so a React re-render of the footer can drop it: this runs again
 * on every mutation flush and re-inserts it when it is missing.
 * @returns the injected element, or null when the line is hidden.
 */
export function renderTokenTotal() {
  const copy = copyNow()
  const existing = document.querySelector(`[${TOKEN_NODE_ATTRIBUTE}]`)
  if (!settings().switches.token.read()) {
    if (existing !== null) existing.remove()
    return null
  }
  const anchor = findAccountAnchor()
  if (anchor === null) {
    if (existing !== null) existing.remove()
    return null
  }
  let element = existing
  if (element === null) {
    element = document.createElement('div')
    element.className = 'dshcb-token-total'
    element.setAttribute(TOKEN_NODE_ATTRIBUTE, '')
    /* The value arrives asynchronously and changes once a minute; announce it
     * politely instead of silently mutating text (`BG-21`). */
    element.setAttribute('aria-live', 'polite')
  }
  if (element.parentElement !== anchor.parent || element.nextElementSibling !== anchor.before) {
    anchor.parent.insertBefore(element, anchor.before)
  }
  const line = (name) => {
    let row = element.querySelector(`[data-token-line="${name}"]`)
    if (row === null) {
      row = document.createElement('div')
      row.className = 'dshcb-token-line'
      row.setAttribute('data-token-line', name)
      element.append(row)
    }
    return row
  }
  const totalRow = line('total')
  const monthRow = line('month')
  const weekRow = line('week')
  /* Align the text with the account row content edge (the avatar) rather than
   * the row's outer box; the row's own padding differs per platform. */
  const account =
    anchor.parent.querySelector('[data-slot="settings.launcher"] button') ??
    anchor.parent.querySelector('button[aria-label="账号菜单"]') ??
    anchor.parent.querySelector('button[aria-label="Account menu"]')
  if (account !== null) {
    const accountPadding = Number.parseFloat(getComputedStyle(account).paddingLeft) || 0
    const target = account.getBoundingClientRect().left + accountPadding
    const left = element.getBoundingClientRect().left
    if (target > 0 && left > 0) {
      const nextPadding = String(Math.max(0, Math.round(target - left))) + 'px'
      if (element.style.paddingLeft !== nextPadding) element.style.paddingLeft = nextPadding
    }
  }
  const total = tokenValue !== null && typeof tokenValue.total === 'number' ? tokenValue.total : null
  const missing = tokenValue !== null && tokenValue.missing === true
  totalRow.textContent = copy.tokenLabel + (total === null ? '…' : missing ? '—' : formatCompactTokens(total))
  if (tokenValue !== null) {
    totalRow.title = copy.tokenHint
      .replaceAll('{exact}', String(tokenValue.total))
      .replaceAll('{sessions}', String(tokenValue.countedSessions ?? 0))
      .replaceAll('{all}', String(tokenValue.sessions ?? 0))
  }
  const windowHint = (payload, template) => {
    if (payload === null || typeof payload !== 'object' || typeof payload.tokens !== 'number') {
      return copy.tokenWindowUnavailable
    }
    return template
      .replaceAll('{exact}', String(payload.tokens))
      .replaceAll('{from}', shortDate(payload.windowStart ?? payload.from))
      .replaceAll('{to}', shortDate(payload.windowEnd ?? payload.to))
      .replaceAll('{reset}', shortDateTime(payload.resetAt ?? payload.windowEnd))
  }
  const monthly = tokenValue?.monthly ?? null
  const monthlyTokens = monthly !== null && typeof monthly.tokens === 'number' ? monthly.tokens : null
  monthRow.textContent = copy.tokenMonthLabel + (monthlyTokens === null ? '—' : formatCompactTokens(monthlyTokens))
  monthRow.title = windowHint(monthly, copy.tokenMonthHint)
  const weekly = tokenValue?.weekly ?? null
  const weeklyTokens = weekly !== null && typeof weekly.tokens === 'number' ? weekly.tokens : null
  weekRow.textContent = copy.tokenWeekLabel + (weeklyTokens === null ? '—' : formatCompactTokens(weeklyTokens))
  weekRow.title = windowHint(weekly, copy.tokenWeekHint)
  return element
}

/**
 * Short local date for tooltips.
 * @param value - ISO timestamp.
 * @returns a readable date, or the original value when unparsable.
 */
function shortDate(value) {
  if (typeof value !== 'string') return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit' })
}

/**
 * Short local date-time for the weekly reset tooltip.
 * @param value - ISO timestamp.
 * @returns a readable date-time, or the original value when unparsable.
 */
function shortDateTime(value) {
  if (typeof value !== 'string') return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}
