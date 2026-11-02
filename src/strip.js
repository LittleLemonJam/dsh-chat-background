/**
 * The bar under the composer card, as wide as the input card, wrapping the
 * usage row the app renders below it.
 *
 * Both anchors are found by measurement and cached: the composer is rebuilt
 * rarely, while the flush runs on every mutation frame during a stream, and a
 * full scan there would cost one `getComputedStyle` per descendant, sixty times
 * a second. The cache is dropped as soon as its node leaves the document.
 *
 * The usage row is looked up through the app's own stable hooks first
 * (`[data-composer-dock]` + `[data-composer-stat]`); the wording heuristic from
 * the first version stays as a fallback for layouts without those hooks
 * (`BG-12`).
 */
import { ACTIVE_ATTRIBUTE, STRIP_ATTRIBUTE } from './constants.js'
import { recordDiagnostics } from './diagnostics.js'
import { settings } from './settings.js'

/** @type {Element | null} */
let cachedInputCard = null

/** Where the cached input card came from: `data-composer-card`, heuristic or none. */
let cachedInputCardSource = 'none'

/** @type {Element | null} */
let cachedUsageRow = null

/** Whether the cached row was found through the stable `data-composer-stat` hooks. */
let cachedUsageRowStable = false

/** @type {ResizeObserver | null} */
let stripResizeObserver = null

/** @type {Element | null} */
let observedComposerWrapper = null

/**
 * Watch the composer wrapper's box so the bar re-measures on size changes, not
 * only on DOM edits. Re-attaches when the app rebuilds the wrapper.
 * @param wrapper - the composer wrapper element.
 */
function ensureComposerSizing(wrapper) {
  if (typeof ResizeObserver === 'undefined') return
  if (observedComposerWrapper === wrapper && stripResizeObserver !== null) return
  if (stripResizeObserver === null) stripResizeObserver = new ResizeObserver(() => renderComposerStrip())
  else stripResizeObserver.disconnect()
  stripResizeObserver.observe(wrapper)
  observedComposerWrapper = wrapper
}

/** Release the composer ResizeObserver; called from the plugin's disposal. */
export function disconnectComposerSizing() {
  if (stripResizeObserver !== null) {
    stripResizeObserver.disconnect()
    stripResizeObserver = null
    observedComposerWrapper = null
  }
  cachedInputCard = null
  cachedInputCardSource = 'none'
  cachedUsageRow = null
  cachedUsageRowStable = false
}

/**
 * The element the app paints as the input card: the largest painted box inside
 * the composer that holds the editor. Its width IS the bar's width — that is
 * what "as wide as the input bar" means — and its bottom edge is where the
 * wrapped data starts.
 * @param wrapper - the composer wrapper element.
 * @returns the input card element, or the wrapper when none is found.
 */
function findInputCard(wrapper) {
  /* The fallback (returning `wrapper`) is deliberately NOT cached: caching it
   * would make a cold-start miss permanent, because wrapper.contains(wrapper) is
   * always true (`BG-06`). */
  if (cachedInputCard !== null && cachedInputCard !== wrapper && !wrapper.contains(cachedInputCard)) {
    cachedInputCard = null
  }
  if (cachedInputCard !== null) return cachedInputCard
  /* The app marks the painted input card itself; this is the primary, stable
   * anchor and does not depend on theme opacity or hashed classes. */
  const explicit = wrapper.querySelector('[data-composer-card]')
  if (explicit !== null && explicit.getBoundingClientRect().width > 0) {
    cachedInputCard = explicit
    cachedInputCardSource = 'data-composer-card'
    return explicit
  }
  let best = null
  let bestArea = 0
  for (const candidate of wrapper.querySelectorAll('*')) {
    const hasEditor =
      candidate.matches('textarea, [contenteditable="true"], [data-composer-input]') ||
      candidate.querySelector('textarea, [contenteditable="true"], [data-composer-input]') !== null
    if (!hasEditor) continue
    const style = getComputedStyle(candidate)
    if (style.backgroundColor === 'rgba(0, 0, 0, 0)' && style.backgroundImage === 'none') continue
    const rect = candidate.getBoundingClientRect()
    const area = rect.width * rect.height
    if (rect.width === 0 || area <= bestArea) continue
    bestArea = area
    best = candidate
  }
  if (best !== null) {
    cachedInputCard = best
    cachedInputCardSource = 'heuristic'
  }
  return best ?? wrapper
}

/**
 * Find the composer wrapper. The stable `conversation.composer.bar` slot outlet
 * is the primary hook; if a future composition stops rendering it, the card and
 * usage dock still let us locate their common ancestor.
 * @returns the wrapper element, or null when the composer is absent.
 */
function findComposerWrapper() {
  const barSlot = document.querySelector('[data-slot="conversation.composer.bar"]')
  const primary = barSlot === null ? null : barSlot.firstElementChild
  if (primary !== null) return primary
  const card = document.querySelector('[data-composer-card]')
  const dock = document.querySelector('[data-composer-dock]')
  if (card === null || dock === null) return null
  let node = dock.parentElement
  while (node !== null && !node.contains(card)) node = node.parentElement
  return node === null || node === document.body ? null : node
}

/**
 * The layout box of an element, falling back to the union of its stat pills
 * when the element itself has no box. Host slot outlets are `display: contents`
 * wrappers with a zero rect, so the stable hooks would otherwise be rejected by
 * the shape check and the language-dependent fallback would win (`R-01`).
 * @param element - candidate row element.
 * @returns its rect, or a zero rect when nothing inside it has one.
 */
function rectOf(element) {
  const own = element.getBoundingClientRect()
  if (own.width > 0 && own.height > 0) return own
  const pills = [...element.querySelectorAll('[data-composer-stat]')]
    .map((pill) => pill.getBoundingClientRect())
    .filter((rect) => rect.width > 0 && rect.height > 0)
  if (pills.length === 0) return own
  const left = Math.min(...pills.map((rect) => rect.left))
  const top = Math.min(...pills.map((rect) => rect.top))
  const right = Math.max(...pills.map((rect) => rect.right))
  const bottom = Math.max(...pills.map((rect) => rect.bottom))
  return { left, top, right, bottom, width: right - left, height: bottom - top }
}

/**
 * Shape constraints the usage row must satisfy: one short line inside the
 * composer's own vertical band.
 * @param candidate - element to test.
 * @param wrapperRect - composer wrapper rect.
 */
function isUsageRowShape(candidate, wrapperRect) {
  const rect = rectOf(candidate)
  if (rect.height === 0 || rect.height > 40) return false
  if (rect.width < 120 || rect.width > 900) return false
  /* The row belongs to the composer band: it starts at or below the wrapper's
   * top, and does not run far past the composer's bottom. */
  return rect.top >= wrapperRect.top - 2 && rect.bottom <= wrapperRect.bottom + 80
}

/**
 * The stable-hook candidates, nearest first: the pills' lowest common parent
 * (usually a `display: contents` slot outlet) and then the dock itself.
 * @param wrapper - composer wrapper element.
 * @returns candidate elements, or an empty list when the hooks are absent.
 */
function findStableUsageRowCandidates(wrapper) {
  const dock = wrapper.querySelector('[data-composer-dock]')
  if (dock === null) return []
  const pills = [...dock.querySelectorAll('[data-composer-stat]')]
  if (pills.length === 0) return []
  let row = pills[0].parentElement
  while (row !== null && row !== dock && (!pills.every((pill) => row.contains(pill)) || row.children.length > 4)) {
    row = row.parentElement
  }
  return row !== null && row !== dock ? [row, dock] : [dock]
}

/**
 * The usage row the app renders under the input card (`N 轮 M 步 · … tok/s`).
 * It has no class of its own, so it is matched by the stable hooks when
 * available and by wording and shape otherwise. Each stable candidate must pass
 * the same shape check, so an oversized outlet falls through to the dock instead
 * of dropping straight to the wording fallback (`r2-03`).
 * @param wrapper - the composer wrapper element.
 * @returns the row element, or null when it is absent.
 */
function findUsageRow(wrapper) {
  if (cachedUsageRow !== null && !cachedUsageRow.isConnected) cachedUsageRow = null
  /* A cache found through the stable hooks must be dropped when the pills go
   * away: the container stays connected, but the row is gone (rescan on the
   * next flush). */
  if (
    cachedUsageRow !== null &&
    cachedUsageRowStable &&
    cachedUsageRow.querySelector('[data-composer-stat]') === null
  ) {
    cachedUsageRow = null
  }
  if (cachedUsageRow !== null) return cachedUsageRow
  const wrapperRect = wrapper.getBoundingClientRect()

  for (const candidate of findStableUsageRowCandidates(wrapper)) {
    if (!isUsageRowShape(candidate, wrapperRect)) continue
    cachedUsageRow = candidate
    cachedUsageRowStable = true
    return candidate
  }

  /* Fallback: match the app's wording. Kept for layouts where the stable hooks
   * are unavailable; it is language-dependent, which is why it is no longer the
   * primary path. */
  const counts = /\d+\s*轮[\s\S]{0,14}?步|tok\/s/u
  const metric = /tok\/s|缓存命中|上下文/u
  let best = null
  let bestTop = Number.NEGATIVE_INFINITY
  for (const candidate of wrapper.querySelectorAll('div, span, p, section, footer')) {
    if (candidate.children.length < 2 || candidate.children.length > 4) continue
    const text = (candidate.textContent ?? '').trim()
    if (text.length === 0 || text.length > 80) continue
    if (text.includes('\n')) continue
    if (!counts.test(text) || !metric.test(text)) continue
    if (!isUsageRowShape(candidate, wrapperRect)) continue
    const childTexts = [...candidate.children]
      .map((child) => (child.textContent ?? '').trim())
      .filter((value) => value !== '')
    if (childTexts.length < 2 || childTexts.includes(text)) continue
    const rect = candidate.getBoundingClientRect()
    if (rect.top > bestTop) {
      bestTop = rect.top
      best = candidate
    }
  }
  cachedUsageRow = best
  cachedUsageRowStable = false
  return best
}

/**
 * Keep the bar mounted inside the composer wrapper, behind its content and
 * above the background image. Geometry is measured from two anchors — the input
 * card (left/width) and the usage row (top/bottom) — so the bar stays flush with
 * the input however the data area changes, and the wrapper gets `isolation` so
 * the negative layer cannot slip behind the app's own surfaces. Nothing here
 * touches layout: the bar is absolutely positioned.
 * @returns the bar element, or null when it is not shown.
 */
export function renderComposerStrip() {
  const existing = document.querySelector(`[${STRIP_ATTRIBUTE}]`)
  const active = document.documentElement.hasAttribute(ACTIVE_ATTRIBUTE)
  const wrapper = findComposerWrapper()
  if (!settings().switches.strip.read() || !active || wrapper === null) {
    if (existing !== null) existing.remove()
    recordDiagnostics({
      strip: { visible: false, wrapper: wrapper !== null, active, enabled: settings().switches.strip.read() }
    })
    return null
  }
  ensureComposerSizing(wrapper)
  const row = findUsageRow(wrapper)
  if (row === null) {
    if (existing !== null) existing.remove()
    recordDiagnostics({ strip: { visible: false, wrapper: true, reason: 'no usage row' } })
    return null
  }
  const card = findInputCard(wrapper)
  const wrapperRect = wrapper.getBoundingClientRect()
  const cardRect = card.getBoundingClientRect()
  const rowRect = rectOf(row)
  let element = existing
  if (element === null) {
    element = document.createElement('div')
    element.setAttribute(STRIP_ATTRIBUTE, '')
    element.setAttribute('aria-hidden', 'true')
  }
  if (element.parentElement !== wrapper) wrapper.appendChild(element)
  const top = Math.max(cardRect.bottom, rowRect.top - 4) - wrapperRect.top
  const height = rowRect.bottom + 4 - wrapperRect.top - top
  const nextLeft = `${Math.round(cardRect.left - wrapperRect.left)}px`
  const nextTop = `${Math.round(top)}px`
  const nextWidth = `${Math.round(cardRect.width)}px`
  const nextHeight = `${Math.round(Math.max(height, 0))}px`
  /* Skip style writes when the measured geometry is unchanged: during a
   * stream every mutation frame calls this, and layout did not necessarily
   * move (`BG-09`). */
  if (element.style.left !== nextLeft) element.style.left = nextLeft
  if (element.style.top !== nextTop) element.style.top = nextTop
  if (element.style.width !== nextWidth) element.style.width = nextWidth
  if (element.style.height !== nextHeight) element.style.height = nextHeight
  recordDiagnostics({
    strip: {
      visible: true,
      width: Math.round(cardRect.width),
      height: Math.round(Math.max(height, 0)),
      inputCard: cachedInputCardSource,
      usageRow: cachedUsageRowStable ? 'stable-hooks' : 'wording-fallback'
    }
  })
  return element
}
