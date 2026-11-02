/**
 * Pure range helpers for the three sliders.
 */

/**
 * Round and clamp a value into an inclusive integer range.
 * @param value - numeric value.
 * @param minimum - inclusive lower bound.
 * @param maximum - inclusive upper bound.
 * @returns the clamped integer.
 */
export function clampToRange(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Math.round(value)))
}

/**
 * Parse one stored slider value, falling back when it is missing or unparsable.
 * @param raw - value read from storage, or null.
 * @param fallback - value used when nothing usable is stored.
 * @param minimum - inclusive lower bound.
 * @param maximum - inclusive upper bound.
 * @returns the clamped integer.
 */
export function parsePercent(raw, fallback, minimum, maximum) {
  if (raw === null || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isFinite(value)) return fallback
  return clampToRange(value, minimum, maximum)
}
