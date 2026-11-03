/**
 * Per-turn conversation scrims.
 *
 * The old main-column scrim painted one rectangle over the whole centre column.
 * This module paints the same veil behind every conversation *turn* instead:
 * each user prompt and its reply (the flow items sharing `data-chat-turn`) get
 * one card sized to the reading column, while the gaps between turns stay
 * wallpaper. The card is absolutely positioned inside the reading column, so it
 * never changes the conversation layout, and its width follows the drag handle
 * of the reading column automatically.
 *
 * `src/lib/turn-masks.js` owns the pure geometry; this module only measures the
 * DOM, keeps the cards in sync and cleans up.
 */
import { ACTIVE_ATTRIBUTE, READ_COLUMN_ATTRIBUTE } from './constants.js'
import { recordDiagnostics } from './diagnostics.js'
import { computeTurnCards } from './lib/turn-masks.js'

/** Stable slot of the conversation flow (the turn items live inside it). */
const FLOW_SELECTOR = '[data-slot="conversation.chat.flow"]'

/** Turn marker the host puts on every flow item. */
const ITEM_SELECTOR = '[data-chat-turn]'

const LAYER_CLASS = 'dshcb-turn-scrims'
const SCRIM_CLASS = 'dshcb-turn-scrim'

/** Preferred vertical padding of one card. */
const PADDING = 10

/** Extra upward bleed on every card. The user prompt bubble sits a couple of
 * pixels above its flow item's box (rounded corners and the row's own
 * alignment), so a card drawn at the measured top leaves the bubble's top edge
 * outside the veil. Extending the top edge a little covers it. */
const TOP_BLEED = 6

/** Smallest wallpaper gap kept between two neighbouring cards. With the
 * comfortable turn spacing below this leaves a ~14px strip of wallpaper after
 * the top bleed. */
const MIN_GAP = 20

/** Horizontal growth of one card beyond the reading column, per side. The
 * extra width becomes whitespace between the text and the card edge; 24px is
 * exactly the reading column's side clearance (where the width handles live). */
const SIDE_PADDING = 24

/** Real layout distance between two conversation turns. DSH itself uses 12px;
 * the comfortable reading layout wants a wider breath between cards. This is a
 * genuine layout change (the conversation gets taller), applied only while a
 * background is active and reverted on teardown. */
const TURN_GAP = 28

/** The host's own flow-gap variable, used by its `margin-top` rules. */
const GAP_PROPERTY = '--dsh-chat-flow-gap'

/** @type {Element | null} */
let column = null

/** @type {HTMLDivElement | null} */
let layer = null

/** @type {ResizeObserver | null} */
let resizeObserver = null

/** One pending refresh per animation frame. */
let frame = 0

/** Live card elements keyed by turn id. */
const scrims = new Map()

/** Last rendered card rectangle per turn, to keep steady state write-free. */
const applied = new Map()

/** Boundary items whose flow-gap variable we raised, with the applied value. */
const boundaries = new Map()

/** Last diagnostics payload, so frequent refreshes do not churn the snapshot. */
let lastReport = ''

/**
 * The conversation flow that actually contains turn items.
 * @returns the flow element or null.
 */
function findFlow() {
  for (const flow of document.querySelectorAll(FLOW_SELECTOR)) {
    const items = flow.querySelectorAll(ITEM_SELECTOR)
    if (items.length === 0) continue
    if (flow.getClientRects().length === 0 && getComputedStyle(flow).display !== 'contents') continue
    /* A hidden conversation view can keep a display:contents flow alive; only
     * accept the one whose turn items actually have boxes. */
    let visible = false
    for (const item of items) {
      const rect = item.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        visible = true
        break
      }
    }
    if (!visible) continue
    return flow
  }
  return null
}

/**
 * The centered reading column around the flow: the first ancestor that owns a
 * layout box and therefore can host the absolutely positioned card layer.
 * @param flow - the conversation flow.
 * @returns the column element or null.
 */
function findColumn(flow) {
  let element = flow
  while (element !== null && element !== document.body) {
    const style = getComputedStyle(element)
    if (style.position === 'fixed') return null
    if (style.display !== 'contents' && element.clientWidth > 0 && element.clientHeight > 0) return element
    element = element.parentElement
  }
  return null
}

/** Remove the card layer and forget every measured element. */
function disposeLayer() {
  resizeObserver?.disconnect()
  resizeObserver = null
  layer?.remove()
  layer = null
  if (column !== null) column.removeAttribute(READ_COLUMN_ATTRIBUTE)
  column = null
  for (const [element] of boundaries) element.style.removeProperty(GAP_PROPERTY)
  boundaries.clear()
  scrims.clear()
  applied.clear()
}

/**
 * Install (or move) the card layer inside the reading column.
 * @param nextColumn - the measured column.
 * @returns the card layer.
 */
function ensureLayer(nextColumn) {
  if (column !== nextColumn) {
    disposeLayer()
    column = nextColumn
    column.setAttribute(READ_COLUMN_ATTRIBUTE, '')
  }
  if (layer === null || !layer.isConnected) {
    layer = document.createElement('div')
    layer.className = LAYER_CLASS
    layer.setAttribute('aria-hidden', 'true')
    column.appendChild(layer)
  }
  if (resizeObserver === null && typeof ResizeObserver !== 'undefined' && column !== null) {
    resizeObserver = new ResizeObserver(() => {
      scheduleTurnMaskUpdate()
    })
    resizeObserver.observe(column)
  }
  if (layer.parentElement !== column) column.appendChild(layer)
  return layer
}

/**
 * Measure the visible flow items and merge them into one range per turn.
 * @param flow - the conversation flow.
 * @param originTop - the reading column's content origin in page coordinates.
 * @returns the turn groups, ordered top to bottom, with their first DOM item.
 */
function measureTurns(flow, originTop) {
  const turns = []
  const byKey = new Map()
  for (const item of flow.querySelectorAll(ITEM_SELECTOR)) {
    if (item.closest('[hidden]') !== null) continue
    const itemRect = item.getBoundingClientRect()
    if (itemRect.width <= 0 || itemRect.height <= 0) continue
    const turn = item.getAttribute('data-chat-turn') ?? ''
    if (turn === '') continue
    const top = itemRect.top - originTop
    const bottom = itemRect.bottom - originTop
    const existing = byKey.get(turn)
    if (existing === undefined) {
      const group = { key: turn, top, bottom, first: item }
      byKey.set(turn, group)
      turns.push(group)
    } else {
      if (top < existing.top) existing.top = top
      if (bottom > existing.bottom) existing.bottom = bottom
    }
  }
  turns.sort((left, right) => left.top - right.top)
  return turns
}

/**
 * Give every turn boundary the comfortable layout gap by writing the host's own
 * flow-gap variable on the next turn's first flow item. The host resolves
 * `margin-top: var(--dsh-chat-flow-gap, 6px)` from that element, so this raises
 * the real spacing without touching the items inside a turn. Boundaries that
 * disappear get their variable removed (the host stylesheet then supplies its
 * own 12px again).
 * @param turns - the measured turn groups.
 * @returns whether the layout was changed.
 */
function syncTurnGaps(turns) {
  const desired = new Map()
  for (let index = 1; index < turns.length; index += 1) {
    const first = turns[index].first
    if (first !== null) desired.set(first, TURN_GAP + 'px')
  }
  let changed = false
  for (const [element] of boundaries) {
    if (element.isConnected && desired.has(element)) continue
    element.style.removeProperty(GAP_PROPERTY)
    boundaries.delete(element)
    changed = true
  }
  for (const [element, value] of desired) {
    if (boundaries.get(element) === value) continue
    element.style.setProperty(GAP_PROPERTY, value)
    boundaries.set(element, value)
    changed = true
  }
  return changed
}

/**
 * Measure the flow items, derive the turn cards and sync the DOM.
 */
function refresh() {
  frame = 0
  if (!document.documentElement.hasAttribute(ACTIVE_ATTRIBUTE)) {
    disposeLayer()
    recordTurnMaskDiagnostics({ active: false })
    return
  }
  const flow = findFlow()
  const nextColumn = flow === null ? null : findColumn(flow)
  if (nextColumn === null) {
    disposeLayer()
    recordTurnMaskDiagnostics({ active: true, column: false, turns: 0 })
    return
  }
  const cardLayer = ensureLayer(nextColumn)
  const style = getComputedStyle(nextColumn)
  const paddingLeft = Number.parseFloat(style.paddingLeft) || 0
  const paddingRight = Number.parseFloat(style.paddingRight) || 0
  const borderLeft = Number.parseFloat(style.borderLeftWidth) || 0
  const borderTop = Number.parseFloat(style.borderTopWidth) || 0
  const rect = nextColumn.getBoundingClientRect()
  const scrollTop = nextColumn.scrollTop || 0
  const scrollLeft = nextColumn.scrollLeft || 0
  const originTop = rect.top + borderTop - scrollTop
  const originLeft = rect.left + borderLeft - scrollLeft
  const contentWidth = Math.max(0, nextColumn.clientWidth - paddingLeft - paddingRight)

  /* One module per conversation turn: every flow item of the turn contributes
   * its own vertical range, then the ranges are merged by turn id. Raising a
   * boundary gap changes the layout, so measure once more before the cards are
   * derived from the ranges. */
  let turns = measureTurns(flow, originTop)
  if (syncTurnGaps(turns)) turns = measureTurns(flow, originTop)
  const cards = computeTurnCards(turns, { padding: PADDING, minGap: MIN_GAP })

  /* The card is wider than the reading column by SIDE_PADDING on each side:
   * the extra width is inner whitespace, so text never touches the rounded
   * edge and the card reaches the width-handle clearance. */
  const cardLeft = paddingLeft - SIDE_PADDING
  const cardWidth = contentWidth + SIDE_PADDING * 2
  cardLayer.style.left = cardLeft + 'px'
  cardLayer.style.width = cardWidth + 'px'

  const live = new Set()
  for (const card of cards) {
    /* Extend the top edge a few pixels beyond the measured flow item so the
     * prompt bubble's own top edge (which sits slightly above the item box)
     * stays inside the veil. Keep the first card inside the reading column:
     * when the window is scrolled into the middle of a turn its measured top
     * can be negative, and the card must not paint over the session header. */
    const rawTop = Math.round(card.top) - TOP_BLEED
    const top = Math.max(0, rawTop)
    const height = Math.max(0, Math.round(card.height) + TOP_BLEED - (top - rawTop))
    const key = card.key
    live.add(key)
    let element = scrims.get(key)
    if (element === undefined) {
      element = document.createElement('div')
      element.className = SCRIM_CLASS
      element.setAttribute('data-turn', key)
      cardLayer.appendChild(element)
      scrims.set(key, element)
      applied.delete(key)
    }
    const previous = applied.get(key)
    if (previous === undefined || previous.top !== top || previous.height !== height) {
      element.style.top = top + 'px'
      element.style.height = height + 'px'
      applied.set(key, { top, height })
    }
  }
  for (const [key, element] of scrims) {
    if (live.has(key)) continue
    element.remove()
    scrims.delete(key)
    applied.delete(key)
  }
  recordTurnMaskDiagnostics({
    active: true,
    column: true,
    turns: cards.length,
    width: Math.round(cardWidth),
    textWidth: Math.round(contentWidth)
  })
}

/**
 * Publish a compact diagnostic summary (only when it actually changed).
 * @param value - the current state of this feature.
 */
function recordTurnMaskDiagnostics(value) {
  const next = JSON.stringify(value)
  if (next === lastReport) return
  lastReport = next
  recordDiagnostics({ turnMasks: value })
}

/** Schedule one refresh on the next animation frame. */
export function scheduleTurnMaskUpdate() {
  if (frame !== 0) return
  if (typeof window.requestAnimationFrame !== 'function') {
    refresh()
    return
  }
  frame = window.requestAnimationFrame(refresh)
}

/**
 * Re-measure and repaint the per-turn cards. Cheap in steady state: the pure
 * geometry decides whether anything changed and only changed rectangles write.
 */
export function updateTurnMasks() {
  if (frame !== 0) {
    window.cancelAnimationFrame(frame)
    frame = 0
  }
  refresh()
}

/** Remove every card, the layer and the column marker. */
export function teardownTurnMasks() {
  if (frame !== 0) {
    window.cancelAnimationFrame(frame)
    frame = 0
  }
  disposeLayer()
  recordTurnMaskDiagnostics({ active: false })
}
