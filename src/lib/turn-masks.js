/**
 * Pure geometry for the per-turn conversation scrims.
 *
 * The DOM layer (`src/turn-masks.js`) measures each turn's vertical range and
 * hands it here; this module only decides where one card starts and ends.
 * Keeping it pure makes the gap/padding rules unit-testable and keeps the DOM
 * pass free of arithmetic.
 */

/**
 * @typedef {{ turn: string, top: number, bottom: number }} FlowRange
 * @typedef {{ key: string, top: number, bottom: number }} TurnRange
 * @typedef {{ key: string, top: number, height: number }} TurnCard
 */

/**
 * Group measured flow items into one range per conversation turn. Items of the
 * same turn may be interleaved with other turns' nodes in odd DOM shapes, so
 * the ranges are merged by key and then ordered by position.
 * @param items - measured flow items in DOM order.
 * @returns one range per turn, ordered top to bottom.
 */
export function groupTurnRanges(items) {
  const groups = []
  const byKey = new Map()
  for (const item of items) {
    if (typeof item.turn !== 'string' || item.turn === '') continue
    if (!(item.bottom > item.top)) continue
    const existing = byKey.get(item.turn)
    if (existing === undefined) {
      const group = { key: item.turn, top: item.top, bottom: item.bottom }
      byKey.set(item.turn, group)
      groups.push(group)
    } else {
      if (item.top < existing.top) existing.top = item.top
      if (item.bottom > existing.bottom) existing.bottom = item.bottom
    }
  }
  groups.sort((left, right) => left.top - right.top)
  return groups
}

/**
 * How much vertical padding one card may take on one side so that two cards
 * keep at least `minGap` px of wallpaper between them.
 * @param gap - empty space between the two turn ranges, or Infinity at the ends.
 * @param padding - preferred padding.
 * @param minGap - smallest visible gap between cards.
 * @returns the padding in px.
 */
function sidePadding(gap, padding, minGap) {
  if (!Number.isFinite(gap)) return padding
  if (gap <= 0) return 0
  return Math.max(0, Math.min(padding, (gap - minGap) / 2))
}

/**
 * Turn one measured range into one card rectangle. The first and last cards may
 * use the full padding; cards in between shrink their padding so the gap
 * between them never collapses (the conversation only has 6–12px flow gaps).
 * @param ranges - ranges from {@link groupTurnRanges}.
 * @param options - `padding` (px) and `minGap` (px).
 * @returns the card rectangles, in the same order.
 */
export function computeTurnCards(ranges, options = {}) {
  const padding = options.padding ?? 10
  const minGap = options.minGap ?? 6
  return ranges.map((range, index) => {
    const previous = ranges[index - 1]
    const next = ranges[index + 1]
    const gapAbove = previous === undefined ? Infinity : range.top - previous.bottom
    const gapBelow = next === undefined ? Infinity : next.top - range.bottom
    const padTop = sidePadding(gapAbove, padding, minGap)
    const padBottom = sidePadding(gapBelow, padding, minGap)
    return {
      key: range.key,
      top: range.top - padTop,
      height: Math.max(0, range.bottom - range.top + padTop + padBottom)
    }
  })
}
