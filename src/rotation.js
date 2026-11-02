/**
 * Background rotation: periodically switch the active library image, with a
 * fade / fade-through transition and an optional group filter.
 *
 * The manager owns one timer and one temporary overlay layer at a time. The
 * layer is a fixed, negative-z-index element appended to `body`: it paints the
 * previous image above the `<html>` background but below the app's columns, so
 * the existing region scrims stay above it (same layering contract as the rest
 * of the plugin).
 */
import {
  FILE_URL,
  LIST_URL,
  MODE_KEY,
  RIGHT_FULLSCREEN_ATTRIBUTE,
  ROTATION_DURATION_DEFAULT,
  ROTATION_DURATION_KEY,
  ROTATION_EFFECT_DEFAULT,
  ROTATION_EFFECT_KEY,
  ROTATION_EFFECTS,
  ROTATION_EVENT,
  ROTATION_GROUP_KEY,
  ROTATION_INTERVAL_DEFAULT,
  ROTATION_INTERVAL_KEY,
  ROTATION_LAYER_ATTRIBUTE,
  SELECTION_KEY
} from './constants.js'
import { applyBackground } from './background.js'
import {
  normalizeRotationDuration,
  normalizeRotationInterval,
  pickNextImage,
  selectRotationGroup
} from './lib/rotation.js'
import { readString, writeString } from './storage.js'

const LAYER_CLASS = 'dshcb-rotate-layer'

/** @type {number} */
let timer = 0
/** @type {number[]} */
let layerTimers = []
/** @type {AbortController | null} */
let request = null
let installed = false

/** Whether the user chose the rotation display mode. */
export function readRotationMode() {
  return readString(MODE_KEY) === 'rotation'
}

/** Rotation interval in seconds. */
export function readRotationInterval() {
  const raw = Number.parseFloat(readString(ROTATION_INTERVAL_KEY) ?? '')
  return normalizeRotationInterval(Number.isFinite(raw) ? raw : ROTATION_INTERVAL_DEFAULT)
}

/** Effect duration in seconds (0 means an instant switch). */
export function readRotationDuration() {
  const raw = Number.parseFloat(readString(ROTATION_DURATION_KEY) ?? '')
  return normalizeRotationDuration(Number.isFinite(raw) ? raw : ROTATION_DURATION_DEFAULT)
}

/** Stored effect name, falling back to the default. */
export function readRotationEffect() {
  const raw = readString(ROTATION_EFFECT_KEY)
  return ROTATION_EFFECTS.includes(raw) ? raw : ROTATION_EFFECT_DEFAULT
}

/** Stored group names; malformed storage is treated as an empty group. */
export function readRotationGroup() {
  const raw = readString(ROTATION_GROUP_KEY)
  if (raw === null) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((value) => typeof value === 'string')
  } catch {
    return []
  }
}

/** Remove the temporary transition layer. */
/** Schedule a layer cleanup and remove its id from the tracking array. */
function scheduleLayer(fn, delay) {
  const id = window.setTimeout(() => {
    layerTimers = layerTimers.filter((entry) => entry !== id)
    fn()
  }, delay)
  layerTimers.push(id)
}

function removeLayer() {
  for (const element of document.querySelectorAll(`[${ROTATION_LAYER_ATTRIBUTE}]`)) element.remove()
}

/** Cancel pending layer timers and abort a running list request. */
function clearTransient() {
  for (const id of layerTimers) window.clearTimeout(id)
  layerTimers = []
  request?.abort?.()
  request = null
  removeLayer()
}

/** Publish the new image to the app and to the settings row. */
function commit(name) {
  writeString(SELECTION_KEY, name)
  applyBackground(name)
  window.dispatchEvent(new CustomEvent(ROTATION_EVENT, { detail: { name } }))
}

/** The theme base colour used by the fade-through effect. */
function themeBaseColour() {
  const value = getComputedStyle(document.body ?? document.documentElement)
    .getPropertyValue('--dsw-alias-bg-base')
    .trim()
  if (value !== '') return value
  return document.body?.hasAttribute('data-ds-dark-theme') === true ? 'rgb(9, 11, 15)' : 'rgb(250, 250, 250)'
}

/** Create a full-viewport image layer under the app columns. */
function createImageLayer(name) {
  const layer = document.createElement('img')
  layer.className = LAYER_CLASS
  layer.setAttribute(ROTATION_LAYER_ATTRIBUTE, '')
  layer.setAttribute('aria-hidden', 'true')
  layer.setAttribute('alt', '')
  layer.setAttribute('draggable', 'false')
  layer.src = FILE_URL + encodeURIComponent(name)
  document.body.appendChild(layer)
  return layer
}

/** Create a full-viewport colour layer for fade-through. */
function createColorLayer(color) {
  const layer = document.createElement('div')
  layer.className = LAYER_CLASS
  layer.setAttribute(ROTATION_LAYER_ATTRIBUTE, '')
  layer.setAttribute('aria-hidden', 'true')
  layer.style.background = color
  document.body.appendChild(layer)
  return layer
}

/** One image layer fading out over the new `<html>` background. */
function fadeTransition(previous, next, duration) {
  const layer = createImageLayer(previous)
  layer.style.opacity = '1'
  /* New image is already on <html>; the layer above it fades out. */
  commit(next)
  void layer.offsetWidth
  layer.style.transition = `opacity ${String(duration)}s ease`
  layer.style.opacity = '0'
  scheduleLayer(removeLayer, duration * 1000 + 80)
}

/** Fade to the theme base, swap the image, then fade back in. */
function fadeThroughTransition(previous, next, duration) {
  const half = Math.max(40, (duration * 1000) / 2)
  const layer = createColorLayer(themeBaseColour())
  layer.style.opacity = '0'
  void layer.offsetWidth
  layer.style.transition = `opacity ${String(half / 1000)}s ease`
  layer.style.opacity = '1'
  scheduleLayer(() => {
    commit(next)
    layer.style.transition = `opacity ${String(half / 1000)}s ease`
    layer.style.opacity = '0'
    scheduleLayer(removeLayer, half + 80)
  }, half)
  /* `previous` is kept for symmetry/documentation of the effect. */
  void previous
}

/** Switch the active image, honouring the effect and duration. */
function transitionTo(next) {
  const previous = readString(SELECTION_KEY)
  if (next === null || next === previous) return
  const ref = document.documentElement.getAttribute(RIGHT_FULLSCREEN_ATTRIBUTE) !== null
  const duration = readRotationDuration()
  const effect = readRotationEffect()
  if (ref || duration <= 0 || effect === 'none' || previous === null) {
    commit(next)
    return
  }
  if (effect === 'fade-through') fadeThroughTransition(previous, next, duration)
  else fadeTransition(previous, next, duration)
}

/** The library images, or an empty list when the host request failed. */
async function loadImages() {
  request?.abort?.()
  const controller = new AbortController()
  request = controller
  try {
    const response = await fetch(LIST_URL, { headers: { accept: 'application/json' }, signal: controller.signal })
    if (!response.ok) return []
    const payload = await response.json()
    return Array.isArray(payload.images) ? payload.images.map((image) => image.name) : []
  } catch {
    return []
  } finally {
    if (request === controller) request = null
  }
}

/** Timed tick: advance to the next image in the selected group. */
async function tick(advance) {
  if (!installed || !readRotationMode()) return
  const names = await loadImages()
  if (!installed || !readRotationMode()) return
  const selected = readRotationGroup()
  const candidates = selected.length === 0 ? names : selectRotationGroup(selected, names)
  if (candidates.length === 0) return
  const current = readString(SELECTION_KEY)
  if (current === null || !candidates.includes(current)) {
    transitionTo(candidates[0])
  } else if (advance) {
    transitionTo(pickNextImage(candidates, current))
  }
}

/** Clear and re-arm the timer. */
function schedule() {
  window.clearTimeout(timer)
  timer = 0
  if (!installed || !readRotationMode()) return
  const interval = readRotationInterval()
  timer = window.setTimeout(() => {
    timer = 0
    void tick(true).finally(() => {
      schedule()
    })
  }, interval * 1000)
}

/**
 * Re-read mode/interval/group and reschedule. `immediate` also validates the
 * current image against the group and switches to the first candidate when the
 * current one is outside the selected set.
 */
export function refreshRotation({ immediate = false } = {}) {
  window.clearTimeout(timer)
  timer = 0
  if (!installed) return
  if (!readRotationMode()) {
    clearTransient()
    return
  }
  if (immediate || readString(SELECTION_KEY) === null) {
    void tick(false).finally(() => {
      schedule()
    })
  } else {
    schedule()
  }
}

/** Start the rotation timer. @returns an uninstall function. */
export function installRotation() {
  installed = true
  refreshRotation({ immediate: true })
  return () => {
    installed = false
    window.clearTimeout(timer)
    timer = 0
    clearTransient()
  }
}
