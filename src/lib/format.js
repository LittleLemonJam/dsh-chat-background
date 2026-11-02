/**
 * Compact number formatting for the token line (437658830 → `437.7M`).
 */

/**
 * Format a token count compactly for the 256px-wide sidebar footer.
 * @param value - token count.
 * @returns one of `0`, `123`, `1.2K`, `45K`, `437.7M`, `1.23B`.
 */
export function formatCompactTokens(value) {
  if (!Number.isFinite(value) || value <= 0) return '0'
  if (value < 1e3) return String(Math.round(value))
  if (value < 1e6) return `${(value / 1e3).toFixed(value < 1e4 ? 1 : 0)}K`
  if (value < 1e9) return `${(value / 1e6).toFixed(value < 1e7 ? 1 : 0)}M`
  return `${(value / 1e9).toFixed(2)}B`
}
