import {
  ROTATION_DURATION_MAX,
  ROTATION_DURATION_MIN,
  ROTATION_INTERVAL_MAX,
  ROTATION_INTERVAL_MIN
} from '../constants.js'
import { clampToRange } from './clamp.js'

/**
 * Pick the image after `current` in the rotation candidates.
 * A missing/foreign current starts at the first candidate; one candidate is
 * returned unchanged (the caller then skips the repaint).
 * @param candidates - candidate image names.
 * @param current - currently active name, or null.
 * @returns the next name, or null for an empty candidate list.
 */
export function pickNextImage(candidates, current) {
  if (candidates.length === 0) return null
  const index = current === null ? -1 : candidates.indexOf(current)
  return candidates[(index + 1) % candidates.length]
}

/**
 * Clamp a rotation interval to its slider range.
 * @param value - raw interval in seconds.
 * @returns an integer interval.
 */
export function normalizeRotationInterval(value) {
  return Math.round(clampToRange(Number(value), ROTATION_INTERVAL_MIN, ROTATION_INTERVAL_MAX))
}

/**
 * Clamp an effect duration to 0–3 seconds, keeping one decimal.
 * @param value - raw duration in seconds.
 * @returns the clamped duration.
 */
export function normalizeRotationDuration(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 0
  return Math.round(Math.min(ROTATION_DURATION_MAX, Math.max(ROTATION_DURATION_MIN, number)) * 10) / 10
}

/**
 * Keep only stored group names that still exist in the library.
 * @param stored - raw stored names.
 * @param available - image names currently available.
 * @returns the intersection, preserving the library order.
 */
export function selectRotationGroup(stored, available) {
  return stored.filter((name) => available.includes(name))
}

/**
 * Move one image in the rotation order. Dragging down places it after the target,
 * dragging up places it before the target.
 * @param order - current order.
 * @param from - image being dragged.
 * @param to - drop target.
 * @returns a new order array.
 */
export function moveRotationImage(order, from, to) {
  const fromIndex = order.indexOf(from)
  const toIndex = order.indexOf(to)
  if (fromIndex < 0 || toIndex < 0 || from === to) return [...order]
  const next = [...order]
  next.splice(fromIndex, 1)
  const target = next.indexOf(to)
  next.splice(fromIndex < toIndex ? target + 1 : target, 0, from)
  return next
}
