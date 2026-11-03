/**
 * Applying the selected image, the sidebar switch and both sliders to the
 * document, plus the mutation-flush scheduler every injected element follows.
 *
 * The transparency rules live in `styles.js`; this module only publishes the
 * per-document variables, marks the measured opaque containers and keeps the
 * static "measured painter" rules in sync so a rebuilt conversation container
 * is transparent before its first paint (no white flash on session switches).
 *
 * Steady state is write-free: a state snapshot (`applied`) and the measured
 * painter set decide whether a flush has anything to do, so a streaming session
 * does not rewrite inline styles sixty times a second (`BG-09`).
 */
import {
  ACTIVE_ATTRIBUTE,
  BACKGROUND_LAYER_ATTRIBUTE,
  DYNAMIC_TAG_ID,
  FILE_URL,
  INLINE_PROPERTIES,
  LIFT_ATTRIBUTE,
  FRAME_ANIMATING_ATTRIBUTE,
  LAYOUT_FRAME_ATTRIBUTE,
  NO_ANIMATION_ATTRIBUTE,
  MAIN_COLUMN_ATTRIBUTE,
  RIGHT_COLUMN_ATTRIBUTE,
  RIGHT_PANEL_ATTRIBUTE,
  RIGHT_FULLSCREEN_ATTRIBUTE,
  RIGHT_PANEL_FULL_ATTRIBUTE,
  SCRIM_DEFAULT,
  SCRIM_KEY,
  SCRIM_LEFT_KEY,
  SCRIM_MAIN_KEY,
  SCRIM_MAX,
  SCRIM_MIN,
  SCRIM_RIGHT_KEY,
  SIDEBAR_COLUMN_ATTRIBUTE,
  STRIP_ATTRIBUTE,
  TOKEN_NODE_ATTRIBUTE,
  VEIL_DEFAULT,
  VEIL_KEY,
  VEIL_MAX,
  VEIL_MIN
} from './constants.js'
import { recordDiagnostics } from './diagnostics.js'
import { isFullscreenPanel } from './lib/layout.js'
import { cssColorToHex } from './lib/color.js'
import { renderComposerStrip } from './strip.js'
import { renderTokenTotal } from './token-total.js'
import { readPercent, readSelection } from './storage.js'
import { teardownTurnMasks, updateTurnMasks } from './turn-masks.js'

/**
 * Ensure the fixed background layer exists. An element background animates
 * GIF/WebP/APNG reliably; the root element background is frozen by Chromium.
 */
function ensureBackgroundLayer(name) {
  if (document.body === null || name === null) return null
  let layer = document.querySelector('[' + BACKGROUND_LAYER_ATTRIBUTE + ']')
  if (layer === null || layer.tagName !== 'IMG') {
    layer?.remove()
    layer = document.createElement('img')
    layer.className = 'dshcb-background-layer'
    layer.setAttribute(BACKGROUND_LAYER_ATTRIBUTE, '')
    layer.setAttribute('aria-hidden', 'true')
    layer.setAttribute('alt', '')
    layer.setAttribute('decoding', 'async')
    layer.setAttribute('draggable', 'false')
    document.body.appendChild(layer)
  }
  const src = FILE_URL + encodeURIComponent(name)
  if (layer.getAttribute('src') !== src) layer.setAttribute('src', src)
  return layer
}

/** Remove the background layer, if present. */
function removeBackgroundLayer() {
  for (const element of document.querySelectorAll('[' + BACKGROUND_LAYER_ATTRIBUTE + ']')) element.remove()
}

/** The base-surface token the theme service publishes on `body`. */
const THEME_BASE_TOKEN = '--dsw-alias-bg-base'

/**
 * Fallback theme detection for a composition that publishes dark tokens without
 * the `data-ds-dark-theme` marker: the base surface's relative luminance decides.
 * @returns whether the base surface is dark, or null when it cannot be read.
 */
function baseSurfaceIsDark() {
  try {
    const scope = document.body ?? document.documentElement
    const hex = cssColorToHex(getComputedStyle(scope).getPropertyValue(THEME_BASE_TOKEN))
    if (hex === null) return null
    const channel = (start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255
    const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
    return luminance < 0.45
  } catch {
    return null
  }
}

/** Whether the app currently uses its dark theme (the marker lives on body). */
export function isDark() {
  if (document.body === null) return false
  if (document.body.hasAttribute('data-ds-dark-theme')) return true
  return baseSurfaceIsDark() === true
}

/**
 * One region scrim, falling back to the matching 1.4.x key while the user has
 * not moved the new slider yet.
 * @param key - per-region storage key.
 * @param legacyKey - 1.4.x key used as fallback.
 * @param legacyDefault - 1.4.x default percentage.
 * @returns the clamped percentage.
 */
function readRegionScrim(key, legacyKey, legacyDefault) {
  const legacy = readPercent(legacyKey, legacyDefault, VEIL_MIN, VEIL_MAX)
  return readPercent(key, legacy, SCRIM_MIN, SCRIM_MAX)
}

/** Left sidebar scrim percentage. */
export function readLeftScrim() {
  return readRegionScrim(SCRIM_LEFT_KEY, VEIL_KEY, VEIL_DEFAULT)
}

/** Main conversation column scrim percentage. */
export function readMainScrim() {
  return readRegionScrim(SCRIM_MAIN_KEY, SCRIM_KEY, SCRIM_DEFAULT)
}

/** Right sidebar scrim percentage. */
export function readRightScrim() {
  return readRegionScrim(SCRIM_RIGHT_KEY, VEIL_KEY, VEIL_DEFAULT)
}

/**
 * A theme-aware translucent layer at the given percent.
 * @param alpha - opacity in percent.
 */
function layer(alpha) {
  const rgb = isDark() ? '9,11,15' : '250,250,250'
  const value = (alpha / 100).toFixed(3)
  return `linear-gradient(rgba(${rgb},${value}), rgba(${rgb},${value}))`
}

/**
 * Escape one class name for use inside an attribute selector. Quoting keeps
 * generated class names safe regardless of their characters.
 * @param name - class token.
 * @returns the quoted attribute payload.
 */
function cssString(name) {
  return `"${String(name).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

/** Whether a computed colour is opaque enough to hide the image. */
function isOpaque(color) {
  if (color === '' || color === 'transparent') return false
  const match = /^rgba?\(([^)]+)\)$/iu.exec(color)
  if (match === null) return color !== 'transparent'
  const parts = match[1].split(',').map((part) => Number(part.trim()))
  return parts.length < 4 || parts[3] > 0.05
}

/* ---- measured painters --------------------------------------------------- */

/** Elements carrying the lift marker; a Set keeps the per-frame check cheap. */
const painterMarks = new Set()

/** Last conversation anchor and painted container, reused until detached. */
let cachedAnchor = null
let cachedContainer = null

/** The conversation anchor (`display: contents` slot wrapper). */
function conversationAnchor() {
  if (cachedAnchor !== null && cachedAnchor.isConnected) return cachedAnchor
  cachedAnchor = document.querySelector('[data-slot="main.conversation"]')
  if (cachedAnchor === null) cachedAnchor = document.querySelector('[data-slot="main"]')
  return cachedAnchor
}

/** The painted element inside the conversation anchor. */
function conversationContainer() {
  const anchor = conversationAnchor()
  if (anchor === null) return null
  if (
    cachedContainer !== null &&
    cachedContainer.isConnected &&
    (cachedContainer === anchor || anchor.contains(cachedContainer))
  ) {
    return cachedContainer
  }
  cachedContainer = anchor.firstElementChild ?? anchor
  return cachedContainer
}

/** The elements currently marked as painters, pruned of detached nodes. */
export function markedPainters() {
  for (const element of [...painterMarks]) {
    if (!element.isConnected) painterMarks.delete(element)
  }
  return [...painterMarks]
}

/** Drop every painter mark. */
export function clearPainters() {
  for (const element of painterMarks) element.removeAttribute(LIFT_ATTRIBUTE)
  painterMarks.clear()
}

/**
 * Mark one layout column found through its stable slot outlet.
 * @param attribute - marker attribute.
 * @param slotName - slot outlet inside the column.
 */
function markColumn(attribute, slotName) {
  const outlet = document.querySelector(`[data-slot="${slotName}"]`)
  const column = outlet === null ? null : outlet.parentElement
  if (column !== null && !column.hasAttribute(attribute)) column.setAttribute(attribute, '')
}

/** Remove one column marker, if any. */
function clearColumn(attribute) {
  for (const element of document.querySelectorAll(`[${attribute}]`)) element.removeAttribute(attribute)
}

/**
 * Mark the layout column that owns the sidebar slot. The renderer's slot outlet
 * is a `display: contents` wrapper, so its parent is the painted column; the
 * stylesheet keys the sidebar rules on this attribute instead of the hashed
 * CSS-module class, which keeps working across DSH builds and stops the broad
 * `[class*="root"]` selector from clearing other plugins' panels (`R2 F2`).
 */
export function markSidebarColumn() {
  const outlet = document.querySelector('[data-slot="sidebar"]')
  const column = outlet === null ? null : outlet.parentElement
  if (column !== null) column.setAttribute(SIDEBAR_COLUMN_ATTRIBUTE, '')
}

/** Mark the main conversation column. */
export function markMainColumn() {
  markColumn(MAIN_COLUMN_ATTRIBUTE, 'main')
}

/** Mark the right sidebar column. */
export function markRightColumn() {
  markColumn(RIGHT_COLUMN_ATTRIBUTE, 'rightbar')
}

/**
 * Short grace window that keeps the fullscreen layer painted while the panel
 * grows/shrinks; measured geometry later takes over. Esc and shortcuts clear it
 * naturally, so a missed exit click cannot leave the layout hidden (`R13-01`).
 */
let fullscreenGraceUntil = 0

/** Pending re-check after the grace window. */
let fullscreenTimer = 0

/** Was the app showing its own exit-fullscreen control on the last pass? */

/** True from an exit click until the app stops advertising its exit control. */
let fullscreenSuppressed = false

/** Timer that removes the short no-animation marker. */
let noAnimationTimer = 0

/**
 * The app marks its fullscreen preview by relabelling the panel button to
 * "退出全屏 / Exit fullscreen". Watching that label survives panel re-renders,
 * portals and Escape/shortcuts, unlike looking for one exact panel element.
 * @returns whether the app currently shows its exit-fullscreen control.
 */
function hasExitFullscreenControl() {
  return document.querySelector('button[aria-label="退出全屏"], button[aria-label="Exit fullscreen"]') !== null
}

/** Schedule one background re-check after the fullscreen grace window. */
function scheduleFullscreenRecheck() {
  if (fullscreenTimer !== 0) return
  const delay = Math.max(60, fullscreenGraceUntil - Date.now() + 20)
  fullscreenTimer = window.setTimeout(() => {
    fullscreenTimer = 0
    applyBackground(readSelection())
  }, delay)
}

/** Pending timer that removes the frame animation marker. */
let frameAnimTimer = 0

/** @type {ResizeObserver | null} */
let panelObserver = null

/** @type {Element | null} */
let observedPanel = null

/**
 * Watch the right panel's box so entering/leaving its fullscreen preview updates
 * the marker even when the app changes only inline styles.
 * @param panel - the marked panel.
 */
function observeRightPanel(panel) {
  if (typeof ResizeObserver === 'undefined' || observedPanel === panel) return
  panelObserver?.disconnect()
  observedPanel = panel
  panelObserver = new ResizeObserver(() => {
    flushBackground()
  })
  panelObserver.observe(panel)
}

/** Remove every fullscreen marker and offset variable immediately. */
function clearFullscreenLayer() {
  const root = document.documentElement
  root.removeAttribute(RIGHT_FULLSCREEN_ATTRIBUTE)
  root.style.removeProperty('--dsh-chat-background-full-left')
  root.style.removeProperty('--dsh-chat-background-full-width')
  for (const element of document.querySelectorAll(`[${RIGHT_PANEL_FULL_ATTRIBUTE}]`)) {
    element.removeAttribute(RIGHT_PANEL_FULL_ATTRIBUTE)
  }
  fullscreenGraceUntil = 0
}

/**
 * Disable the app's own fullscreen transition for a short window so entering
 * and leaving fullscreen is one instant step, as requested (`R16-01`).
 */
function silenceTransitions() {
  const root = document.documentElement
  root.setAttribute(NO_ANIMATION_ATTRIBUTE, '')
  if (noAnimationTimer !== 0) window.clearTimeout(noAnimationTimer)
  noAnimationTimer = window.setTimeout(() => {
    noAnimationTimer = 0
    root.removeAttribute(NO_ANIMATION_ATTRIBUTE)
  }, 450)
}

/**
 * Handle an exit click: hide the overlay and the app's animation immediately.
 * The app may keep its "exit fullscreen" label for a few frames; suppress that
 * label until it disappears so it cannot re-show the layer (`R16-01`).
 */
function suppressFullscreenForExit() {
  fullscreenSuppressed = true
  clearFullscreenLayer()
  silenceTransitions()
  applyBackground(readSelection())
}

/**
 * Mark the right sidebar panel. It is the element that expands to a
 * full-window preview when the user presses the panel fullscreen button;
 * painting the background image + right scrim on it keeps the conversation
 * underneath from showing through in that mode (and looks identical in the
 * normal, column-sized state).
 */
export function markRightPanel() {
  if (observedPanel !== null && !observedPanel.isConnected) {
    panelObserver?.disconnect()
    panelObserver = null
    observedPanel = null
  }
  const outlet = document.querySelector('[data-slot="rightbar"]')
  const column = outlet === null ? null : outlet.parentElement
  const panel = outlet === null ? null : outlet.querySelector('[class*="panel"]')
  const root = document.documentElement
  const labelFull = hasExitFullscreenControl()
  if (!labelFull) fullscreenSuppressed = false
  if (labelFull) fullscreenGraceUntil = Math.max(fullscreenGraceUntil, Date.now() + 300)
  let measured = false
  if (panel !== null) {
    const box = panel.getBoundingClientRect()
    measured = isFullscreenPanel(
      { width: box.width, height: box.height, left: box.left, top: box.top },
      { width: window.innerWidth, height: window.innerHeight }
    )
  }
  const full = !fullscreenSuppressed && (labelFull || measured || Date.now() < fullscreenGraceUntil)
  if (full) {
    if (!root.hasAttribute(RIGHT_FULLSCREEN_ATTRIBUTE)) root.setAttribute(RIGHT_FULLSCREEN_ATTRIBUTE, '')
  } else {
    root.removeAttribute(RIGHT_FULLSCREEN_ATTRIBUTE)
    fullscreenGraceUntil = 0
  }
  if (full && !labelFull) scheduleFullscreenRecheck()
  if (panel === null) return
  if (!panel.hasAttribute(RIGHT_PANEL_ATTRIBUTE)) panel.setAttribute(RIGHT_PANEL_ATTRIBUTE, '')
  const setFull = (element) => {
    if (full && !element.hasAttribute(RIGHT_PANEL_FULL_ATTRIBUTE)) element.setAttribute(RIGHT_PANEL_FULL_ATTRIBUTE, '')
    else if (!full && element.hasAttribute(RIGHT_PANEL_FULL_ATTRIBUTE))
      element.removeAttribute(RIGHT_PANEL_FULL_ATTRIBUTE)
  }
  setFull(panel)
  if (column !== null) setFull(column)
  if (full) {
    const leftOutlet = document.querySelector('[data-slot="sidebar"]')
    const leftColumn = leftOutlet === null ? null : leftOutlet.parentElement
    const leftWidth = leftColumn === null ? 0 : leftColumn.getBoundingClientRect().width
    const columnLeft = column === null ? 0 : column.getBoundingClientRect().left
    const offset = Math.round(leftWidth - columnLeft)
    const width = Math.round(window.innerWidth - leftWidth)
    root.style.setProperty('--dsh-chat-background-full-left', offset + 'px')
    root.style.setProperty('--dsh-chat-background-full-width', width + 'px')
  } else if (!full) {
    root.style.removeProperty('--dsh-chat-background-full-left')
    root.style.removeProperty('--dsh-chat-background-full-width')
  }
  observeRightPanel(panel)
}

/**
 * Animate the layout grid for one right-sidebar open/collapse gesture. A short
 * marker window is used instead of a permanent transition so dragging the
 * sidebar edge stays 1:1 with the pointer.
 */
export function animateLayoutFrame() {
  const outlet = document.querySelector('[data-slot="main"]')
  const column = outlet === null ? null : outlet.parentElement
  const frame = column === null ? null : column.parentElement
  if (frame === null) return
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  if (!reduced) frame.setAttribute(FRAME_ANIMATING_ATTRIBUTE, '')
  if (frameAnimTimer !== 0) window.clearTimeout(frameAnimTimer)
  frameAnimTimer = window.setTimeout(() => {
    frameAnimTimer = 0
    frame.removeAttribute(FRAME_ANIMATING_ATTRIBUTE)
  }, 340)
}

/**
 * Remember the user's fullscreen intent immediately on click, and animate the
 * grid on open/collapse clicks. Click capture runs before the app handles the
 * button, so the background/scrim and the layout switch together.
 * @returns an uninstall function.
 */
export function installRightbarGestures() {
  let labelFull = hasExitFullscreenControl()
  const observer = new MutationObserver(() => {
    const next = hasExitFullscreenControl()
    if (next === labelFull) return
    labelFull = next
    flushBackground()
  })
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['aria-label']
  })
  const handler = (event) => {
    const target = event.target instanceof Element ? event.target.closest('button[aria-label]') : null
    if (target === null) return
    const label = target.getAttribute('aria-label') ?? ''
    if (/打开右侧边栏|收起右侧边栏|open right sidebar|collapse right sidebar/i.test(label)) {
      animateLayoutFrame()
      return
    }
    /* Only the right panel owns the fullscreen preview; a similarly named
     * button elsewhere must never hide the main layout. */
    if (target.closest('[data-slot="rightbar"]') === null) return
    if (/退出全屏|exit fullscreen/i.test(label)) {
      suppressFullscreenForExit()
      return
    }
    if (/^全屏$|^fullscreen$/i.test(label)) {
      if (document.querySelector('[data-dsh-chat-background-right-panel]') === null) return
      fullscreenSuppressed = false
      silenceTransitions()
      fullscreenGraceUntil = Date.now() + 700
      if (fullscreenTimer !== 0) window.clearTimeout(fullscreenTimer)
      fullscreenTimer = window.setTimeout(() => {
        fullscreenTimer = 0
        applyBackground(readSelection())
      }, 720)
      applyBackground(readSelection())
    }
  }
  document.addEventListener('click', handler, { capture: true })
  return () => {
    document.removeEventListener('click', handler, { capture: true })
    observer.disconnect()
    fullscreenSuppressed = false
    if (noAnimationTimer !== 0) window.clearTimeout(noAnimationTimer)
    noAnimationTimer = 0
    document.documentElement.removeAttribute(NO_ANIMATION_ATTRIBUTE)
    if (frameAnimTimer !== 0) window.clearTimeout(frameAnimTimer)
    frameAnimTimer = 0
    if (fullscreenTimer !== 0) window.clearTimeout(fullscreenTimer)
    fullscreenTimer = 0
    fullscreenGraceUntil = 0
  }
}

/**
 * Mark the layout frame (the grid that owns the three columns).
 */
export function markLayoutFrame() {
  const outlet = document.querySelector('[data-slot="main"]')
  const column = outlet === null ? null : outlet.parentElement
  const frame = column === null ? null : column.parentElement
  if (frame !== null && !frame.hasAttribute(LAYOUT_FRAME_ATTRIBUTE)) frame.setAttribute(LAYOUT_FRAME_ATTRIBUTE, '')
}

/** Mark all three scrim regions; the slots are stable app contracts. */
function markRegionColumns() {
  markSidebarColumn()
  markMainColumn()
  markRightColumn()
  markRightPanel()
  markLayoutFrame()
}

/** Drop every region marker. */
function clearRegionColumns() {
  clearColumn(SIDEBAR_COLUMN_ATTRIBUTE)
  clearColumn(MAIN_COLUMN_ATTRIBUTE)
  clearColumn(RIGHT_COLUMN_ATTRIBUTE)
  clearColumn(RIGHT_PANEL_ATTRIBUTE)
  clearColumn(RIGHT_PANEL_FULL_ATTRIBUTE)
  clearColumn(LAYOUT_FRAME_ATTRIBUTE)
}

/**
 * Nudge the preload's Windows caption-color observer.
 *
 * The desktop preload computes the native title-bar overlay colour from a
 * hidden probe span and only re-sends it when it sees a `lang`/theme/body-style
 * mutation. Toggling a body custom property gives it that mutation, so the
 * overlay can become transparent while a background is shown (`R8-04`).
 * @param active - whether a background image is applied.
 */
function nudgeNativeTitlebar(active) {
  if (document.body === null) return
  document.body.style.setProperty('--dsh-chat-background-native', active ? '1' : '0')
}

/**
 * Publish the measured painters as static rules. The painted container is
 * rebuilt on every session switch, so a rule that only matches after the
 * measurement pass would show the opaque base surface for one frame; a rule
 * keyed on the measured class names is in place before the new element paints.
 * Unmatched rules cost nothing at runtime.
 * @param elements - currently measured opaque containers.
 */
export function syncDynamicRules(elements) {
  if (typeof document === 'undefined') return
  let tag = document.querySelector(`style[data-plugin-css=${cssString(DYNAMIC_TAG_ID)}]`)
  if (tag === null) {
    tag = document.createElement('style')
    tag.dataset.plugin = 'dsh-chat-background'
    tag.dataset.pluginCss = DYNAMIC_TAG_ID
    document.head.appendChild(tag)
  }
  const selectors = []
  for (const element of elements) {
    if (element === document.body || element === document.documentElement) {
      selectors.push(element === document.body ? 'body' : 'html')
      continue
    }
    const tokens = [...element.classList].filter((token) => token !== '')
    for (const token of tokens) selectors.push(`html[data-dsh-chat-background] [class~=${cssString(token)}]`)
  }
  const next = selectors.length === 0 ? '' : `${selectors.join(',\n')} { background-color: transparent !important; }`
  if (tag.textContent !== next) tag.textContent = next
}

/**
 * Measure which containers paint the conversation area's base surface and mark
 * them so the stylesheet can clear them. Discovery is by measurement, so it
 * survives a rebuild that renames the hashed classes.
 * @returns the opaque containers, from the conversation element upwards.
 */
function markPainters() {
  const anchor = conversationAnchor()
  if (anchor === null) return []
  const start = anchor.firstElementChild ?? anchor
  const candidates = []
  for (let element = start; element !== null && element !== document.documentElement; element = element.parentElement) {
    if (isOpaque(window.getComputedStyle(element).backgroundColor)) candidates.push(element)
  }
  for (const element of candidates) {
    if (painterMarks.has(element)) continue
    painterMarks.add(element)
    element.setAttribute(LIFT_ATTRIBUTE, '')
  }
  /* Only the lowest opaque container gets the static rule: it is the column
   * that gets rebuilt on a session switch, and everything above it may also
   * contain the sidebar column. */
  if (candidates.length > 0) syncDynamicRules([candidates[0]])
  return candidates
}

/* ---- application --------------------------------------------------------- */

/** Last value written for each document-level setting. */
let applied = { selection: undefined, dark: null, scrimLeft: null, scrimMain: null, scrimRight: null }

/** Slot count at the last measurement; -1 forces the next one. */
let markSignature = -1

/** Conversation container that measurement last covered. */
let markContainer = null

/** One pending re-apply per animation frame. */
let flushHandle = 0

/** Whether the pending handle is a `setTimeout` (no rAF in this environment). */
let flushIsTimeout = false

/**
 * Apply the selection and the three independent region scrims to the document.
 * Does nothing when neither the stored state nor the measured DOM changed, so
 * it can run on every relevant DOM mutation.
 * @param selection - image file name, or null/'' for the plain theme.
 */
export function applyBackground(selection) {
  const root = document.documentElement
  const next = selection === null || selection === '' ? null : selection
  const dark = isDark()
  const scrimLeft = readLeftScrim()
  const scrimMain = readMainScrim()
  const scrimRight = readRightScrim()
  const signature = document.querySelectorAll('[data-slot]').length
  const container = conversationContainer()
  const painters = markedPainters()
  const needsPaint = signature !== markSignature || container !== markContainer || painters.length === 0
  const sameVars =
    applied.selection === next &&
    applied.dark === dark &&
    applied.scrimLeft === scrimLeft &&
    applied.scrimMain === scrimMain &&
    applied.scrimRight === scrimRight

  if (next === null) {
    if (sameVars && !root.hasAttribute(ACTIVE_ATTRIBUTE)) return
    for (const property of INLINE_PROPERTIES) root.style.removeProperty(property)
    root.removeAttribute(ACTIVE_ATTRIBUTE)
    removeBackgroundLayer()
    root.removeAttribute(RIGHT_FULLSCREEN_ATTRIBUTE)
    root.style.removeProperty('--dsh-chat-background-full-left')
    root.style.removeProperty('--dsh-chat-background-full-width')
    clearPainters()
    clearRegionColumns()
    syncDynamicRules([])
    teardownTurnMasks()
    nudgeNativeTitlebar(false)
    applied = { selection: null, dark, scrimLeft, scrimMain, scrimRight }
    markSignature = -1
    markContainer = null
    recordDiagnostics({ background: { active: false } })
    return
  }

  /* Column/panel markers are refreshed on every apply: the right panel can be
   * recreated when the sidebar tab changes, and the frame when the layout
   * rebuilds. The helper only writes when a marker is missing. */
  markRegionColumns()
  ensureBackgroundLayer(next)
  if (sameVars && !needsPaint) return
  /* Measure before writing: the writes below invalidate style, and reading
   * computed backgrounds afterwards would force a style recalculation (`BG-09`). */
  if (needsPaint) {
    markSignature = signature
    markContainer = container
    markPainters()
  }
  recordDiagnostics({
    background: {
      active: true,
      painted: markedPainters().length,
      conversation: container !== null,
      dark,
      scrim: { left: scrimLeft, main: scrimMain, right: scrimRight },
      markers: {
        rightPanel: document.querySelector('[' + RIGHT_PANEL_ATTRIBUTE + ']') !== null,
        layoutFrame: document.querySelector('[' + LAYOUT_FRAME_ATTRIBUTE + ']') !== null,
        rightPanelFull:
          document.querySelector('[' + RIGHT_PANEL_ATTRIBUTE + '][' + RIGHT_PANEL_FULL_ATTRIBUTE + ']') !== null
      }
    }
  })
  if (!sameVars) {
    root.style.setProperty('--dsh-chat-background-image', 'url("' + FILE_URL + encodeURIComponent(next) + '")')
    root.style.setProperty('--dsh-chat-background-scrim-left', layer(scrimLeft))
    root.style.setProperty('--dsh-chat-background-scrim-main', layer(scrimMain))
    root.style.setProperty('--dsh-chat-background-scrim-right', layer(scrimRight))
    root.setAttribute(ACTIVE_ATTRIBUTE, next)
    /* Sidebar and right-bar surfaces always yield to the image; the left/right
     * scrim sliders decide how much of it remains visible (100 = opaque). */
    applied = { selection: next, dark, scrimLeft, scrimMain, scrimRight }
    nudgeNativeTitlebar(true)
  }
  /* The per-turn veils are measured from the live flow; refresh them whenever
   * the selection or the layout is re-applied. */
  updateTurnMasks()
}

/**
 * Schedule one re-apply after the app changed the DOM. Scheduling on rAF keeps
 * this at most once per frame and after the app's own render, which is what
 * removes the white flash on session switches.
 */
export function flushBackground() {
  if (flushHandle !== 0) return
  const run = () => {
    flushHandle = 0
    applyBackground(readSelection())
    /* Both injected elements are measured from live geometry, so they follow the
     * composer and the sidebar on the same deferred pass. In steady state
     * applyBackground wrote nothing, so this read does not force a reflow. */
    renderComposerStrip()
    renderTokenTotal()
    /* The per-turn veils follow the conversation flow; the resize observer on
     * the reading column covers pure-layout changes, this pass covers DOM
     * rebuilds (session switches, new nodes). */
    updateTurnMasks()
  }
  if (typeof window.requestAnimationFrame === 'function') {
    flushIsTimeout = false
    flushHandle = window.requestAnimationFrame(run)
  } else {
    flushIsTimeout = true
    flushHandle = window.setTimeout(run, 16)
  }
}

/**
 * Forget the measured opaque-surface snapshot and flush, so the next pass
 * re-measures the layout.
 *
 * Window restores, titlebar re-themes and renderer rebuilds can replace or
 * restyle the frame columns while the slot count stays the same. The measured
 * painter marks only ever describe the DOM they measured, so they would keep
 * vouching for elements that no longer paint the conversation (and stay silent
 * about the new opaque ones). Re-measuring after a focus/visibility/titlebar
 * change turns that stale snapshot into a fresh one; the stable column markers
 * carry the immediate fix in the stylesheet either way.
 */
export function invalidatePainters() {
  markSignature = -1
  markContainer = null
  flushBackground()
}

/**
 * Remove everything this plugin added to the document: attributes, inline
 * properties, injected nodes, measured rules and a pending flush. Called from
 * the plugin's disposal so a disable or hot replacement leaves no residue
 * (`BG-08`).
 */ export function teardownVisuals() {
  if (flushHandle !== 0) {
    if (flushIsTimeout) window.clearTimeout(flushHandle)
    else window.cancelAnimationFrame(flushHandle)
    flushHandle = 0
  }
  const root = document.documentElement
  root.removeAttribute(ACTIVE_ATTRIBUTE)
  removeBackgroundLayer()
  root.removeAttribute(RIGHT_FULLSCREEN_ATTRIBUTE)
  root.style.removeProperty('--dsh-chat-background-full-left')
  root.style.removeProperty('--dsh-chat-background-full-width')
  for (const property of INLINE_PROPERTIES) root.style.removeProperty(property)
  document.body?.style.removeProperty('--dsh-chat-background-native')
  panelObserver?.disconnect()
  panelObserver = null
  observedPanel = null
  fullscreenGraceUntil = 0
  fullscreenSuppressed = false
  if (noAnimationTimer !== 0) window.clearTimeout(noAnimationTimer)
  noAnimationTimer = 0
  root.removeAttribute(NO_ANIMATION_ATTRIBUTE)
  if (fullscreenTimer !== 0) window.clearTimeout(fullscreenTimer)
  fullscreenTimer = 0
  if (frameAnimTimer !== 0) window.clearTimeout(frameAnimTimer)
  frameAnimTimer = 0
  clearPainters()
  clearRegionColumns()
  syncDynamicRules([])
  teardownTurnMasks()
  document.querySelector(`style[data-plugin-css=${cssString(DYNAMIC_TAG_ID)}]`)?.remove()
  document.querySelector(`[${STRIP_ATTRIBUTE}]`)?.remove()
  document.querySelector(`[${TOKEN_NODE_ATTRIBUTE}]`)?.remove()
  cachedAnchor = null
  cachedContainer = null
  markSignature = -1
  markContainer = null
  applied = { selection: undefined, dark: null, scrimLeft: null, scrimMain: null, scrimRight: null }
}
