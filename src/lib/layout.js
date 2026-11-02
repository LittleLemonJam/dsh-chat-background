/**
 * Pure layout predicates for the right sidebar.
 *
 * The panel is `position: absolute` and as wide as its column in the normal
 * state; the fullscreen preview makes the same element cover the viewport.
 * Width alone is not enough: on a narrow window a normal 637px panel could be
 * as wide as the viewport. The check therefore also requires viewport height
 * and a zero viewport offset (`R12-02`); the column may itself expand in some
 * fullscreen states, so its width is not part of the predicate (`R14-01`).
 */

/**
 * Whether the right panel currently covers the whole viewport.
 * @param panel - panel box in CSS pixels.
 * @param viewport - viewport width and height.
 * @returns whether the panel is in its fullscreen preview.
 */
export function isFullscreenPanel(panel, viewport) {
  return (
    panel.width >= viewport.width - 2 &&
    panel.height >= viewport.height - 2 &&
    Math.abs(panel.left) <= 1 &&
    Math.abs(panel.top) <= 1
  )
}
