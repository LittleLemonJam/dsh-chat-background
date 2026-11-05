/**
 * Durable storage and the two reusable setting factories.
 *
 * `'off'` is the stored off state of the default-on switches, and an absent key
 * means on, so such a switch costs nothing until it is turned off. Opt-in
 * switches store `'on'` instead and are off while absent. Listeners exist
 * because the settings row and whatever the switch drives (an injected element,
 * the background layer) mount at different times.
 *
 * Reads are memoised: the mutation-driven flush reads several keys per frame
 * while a session streams, and `localStorage` is synchronous. The cache is
 * refreshed on `writeString` and cleared by the browser `storage` event, so a
 * second window changing a value is still honoured (`BG-09`).
 */
import {
  ACCEPTED_IMAGE_EXTENSIONS,
  PROGRESS_COLOR_KEY,
  PROGRESS_DEFAULT_HEX,
  PROGRESS_DEFAULT_TOKEN,
  SELECTION_KEY,
  STRIP_COLOR_KEY,
  STRIP_DEFAULT_HEX
} from './constants.js'
import { parsePercent } from './lib/clamp.js'
import { cssColorToHex } from './lib/color.js'
import { useEffect, useState } from './react.js'

/** @type {Map<string, string | null>} */
const valueCache = new Map()

/** @type {(() => void) | null} */
let storageListener = null

/** Install the cross-window invalidation listener on first use. */
function installStorageListener() {
  if (storageListener !== null) return
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return
  storageListener = () => {
    valueCache.clear()
  }
  window.addEventListener('storage', storageListener)
}

/**
 * Release the cross-window listener and the memo. Called from the plugin's
 * disposal so a disable or hot replacement leaves no listener behind (`R-12`).
 */
export function disposeStorageCache() {
  if (storageListener !== null && typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
    window.removeEventListener('storage', storageListener)
  }
  storageListener = null
  valueCache.clear()
}

/**
 * Read one stored string.
 * @param key - localStorage key.
 * @returns the value, or null when missing, empty or unreadable.
 */
export function readString(key) {
  installStorageListener()
  if (valueCache.has(key)) return valueCache.get(key)
  try {
    const raw = window.localStorage.getItem(key)
    const value = raw === null || raw === '' ? null : raw
    valueCache.set(key, value)
    return value
  } catch {
    return null
  }
}

/**
 * Write or clear one stored string.
 * @param key - localStorage key.
 * @param value - value to store, or null to clear the key.
 */
export function writeString(key, value) {
  valueCache.set(key, value)
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
  } catch {
    /* A blocked storage keeps the choice for this page only. */
  }
}

/**
 * A stored percentage clamped into its slider range, or the default.
 * @param key - localStorage key.
 * @param fallback - value used when nothing usable is stored.
 * @param minimum - inclusive lower bound.
 * @param maximum - inclusive upper bound.
 * @returns the clamped integer.
 */
export function readPercent(key, fallback, minimum, maximum) {
  return parsePercent(readString(key), fallback, minimum, maximum)
}

/**
 * The selected image file name, or null for the plain theme. Stored values are
 * untrusted input (any same-origin script can write storage), so a name is only
 * returned when it looks like one of the accepted image types and contains no
 * path separators (`SEC-01` defence in depth).
 * @returns stored file name or null.
 */
export function readSelection() {
  const raw = readString(SELECTION_KEY)
  if (raw === null) return null
  if (raw.includes('/') || raw.includes('\\') || raw.includes('\0')) return null
  const lowered = raw.toLowerCase()
  if (!ACCEPTED_IMAGE_EXTENSIONS.some((extension) => lowered.endsWith(extension))) return null
  return raw
}

/**
 * One durable on/off switch.
 * @param {{ key: string, onChange?: (next: boolean) => void, defaultEnabled?: boolean }} options -
 *   storage key, an optional side effect to run on change, and whether an
 *   absent key means on (the historical default) or off (opt-in switches).
 * @returns reader, writer and the React hook for that switch.
 */
export function createSwitch({ key, onChange, defaultEnabled = true }) {
  const listeners = new Set()
  const read = () => (defaultEnabled ? readString(key) !== 'off' : readString(key) === 'on')
  const write = (next) => {
    if (defaultEnabled) writeString(key, next ? null : 'off')
    else writeString(key, next ? 'on' : null)
    if (typeof onChange === 'function') onChange(next)
    for (const listener of listeners) listener(next)
  }
  /** Hook: subscribe a component to this switch. */
  const useEnabled = () => {
    const [enabled, setLocal] = useState(read)
    useEffect(() => {
      const listener = (next) => {
        setLocal(next)
      }
      listeners.add(listener)
      setLocal(read())
      return () => {
        listeners.delete(listener)
      }
    }, [])
    return enabled
  }
  return { read, write, useEnabled }
}

/**
 * One colour setting: a stored `#rrggbb` with a default, published as a single
 * inline custom property on `<html>`. Inline declarations beat the stylesheet,
 * so a picked colour wins in both themes; clearing it hands the choice back to
 * the stylesheet's per-theme default.
 * @param {{ key: string, property: string, fallback: string, translucent?: boolean, defaultToken?: string | null }} options -
 *   storage key, custom property name, default colour, whether the value is
 *   published translucent, and an optional design token to read the real
 *   default from (so the swatch shows what is actually painted).
 * @returns reader, applier and the value/change/reset triple for a row.
 */
export function createColorSetting({ key, property, fallback, translucent = false, defaultToken = null }) {
  const read = () => {
    const raw = readString(key)
    return raw !== null && /^#[0-9a-f]{6}$/iu.test(raw) ? raw : null
  }
  /** What is on screen when nothing is stored: the token, or the literal. */
  const shownDefault = () => {
    if (defaultToken === null) return fallback
    /* The theme service publishes its alias tokens as inline variables on
     * `body`; `html` is only a fallback for a differently mounted theme. */
    const scope = document.body ?? document.documentElement
    const fromBody = getComputedStyle(scope).getPropertyValue(defaultToken)
    const fromRoot = getComputedStyle(document.documentElement).getPropertyValue(defaultToken)
    return cssColorToHex(fromBody) ?? cssColorToHex(fromRoot) ?? fallback
  }
  const apply = () => {
    const hex = read()
    if (hex === null) document.documentElement.style.removeProperty(property)
    else document.documentElement.style.setProperty(property, translucent ? `${hex}eb` : hex)
  }
  /** Hook: the swatch value and the two mutators a row needs. */
  const useColor = (onChange) => {
    const [color, setColor] = useState(() => read() ?? shownDefault())
    const change = (next) => {
      setColor(next)
      writeString(key, next)
      apply()
      if (typeof onChange === 'function') onChange(next)
    }
    const reset = () => {
      setColor(shownDefault())
      writeString(key, null)
      apply()
      if (typeof onChange === 'function') onChange()
    }
    return { color, change, reset }
  }
  return { read, apply, useColor }
}

/** The bar colour, published as an inline custom property on `<html>`. */
export function createStripColorSetting() {
  return createColorSetting({
    key: STRIP_COLOR_KEY,
    property: '--dsh-chat-strip-bg',
    fallback: STRIP_DEFAULT_HEX,
    translucent: true
  })
}

/** The progress fill colour; unset paints the theme's brand token. */
export function createProgressColorSetting() {
  return createColorSetting({
    key: PROGRESS_COLOR_KEY,
    property: '--dsh-progress-color',
    fallback: PROGRESS_DEFAULT_HEX,
    /* Unset means the bar paints the theme's brand token, so the swatch shows
     * that colour rather than a blue the bar never uses. */
    defaultToken: PROGRESS_DEFAULT_TOKEN
  })
}
