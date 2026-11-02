/**
 * Colour helpers shared by the two colour settings.
 */

/**
 * Normalise `#abc`, `#aabbcc`, `rgb(r, g, b)` and `rgba(r, g, b, a)` to
 * `#rrggbb`, so a swatch shows what is actually painted.
 * @param value - any CSS colour text.
 * @returns the six-digit hex colour, or null when the value is not understood.
 */
export function cssColorToHex(value) {
  const raw = String(value ?? '').trim()
  if (raw === '') return null
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/iu.exec(raw)
  if (short !== null) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`
  if (/^#[0-9a-f]{6}$/iu.test(raw)) return raw
  const parts = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/iu.exec(raw)
  if (parts === null) return null
  const channel = (text) => Number.parseInt(text, 10).toString(16).padStart(2, '0')
  return `#${channel(parts[1])}${channel(parts[2])}${channel(parts[3])}`
}
