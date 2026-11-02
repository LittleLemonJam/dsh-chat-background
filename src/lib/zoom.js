/**
 * Pure helpers for the wheel zoom gesture.
 */

/** Pixels per wheel line for DOM_DELTA_LINE (matches common browser default). */
const LINE_HEIGHT = 16

/** Largest normalized wheel delta accepted by one zoom step. */
const MAX_STEP = 120

/** Per-pixel exponential sensitivity. */
const WHEEL_SENSITIVITY = 0.0015

/**
 * Normalize a wheel delta to pixel units, clamped to one sane zoom step.
 *
 * Browsers report wheel input in pixels, lines or pages; treating a LINE delta
 * of 1 as one pixel makes zooming look unresponsive, while huge trackpad
 * deltas can jump several zoom levels at once (`R17-02`).
 * @param deltaY - raw wheel delta.
 * @param deltaMode - WheelEvent delta mode (0 pixel, 1 line, 2 page).
 * @param viewportHeight - viewport height used for page deltas.
 * @returns normalized delta in pixels, in [-MAX_STEP, MAX_STEP].
 */
export function normalizeWheelDelta(deltaY, deltaMode, viewportHeight) {
  const unit = deltaMode === 1 ? LINE_HEIGHT : deltaMode === 2 ? Math.max(1, viewportHeight) : 1
  return Math.max(-MAX_STEP, Math.min(MAX_STEP, deltaY * unit))
}

/**
 * Multiplicative zoom for one normalized wheel delta. Negative (wheel up) means
 * zoom in, positive (wheel down) means zoom out.
 * @param delta - normalized wheel delta.
 * @returns the scale factor for this step.
 */
export function wheelZoomFactor(delta) {
  return Math.exp(-delta * WHEEL_SENSITIVITY)
}
