/**
 * Mouse-wheel zoom for the two image viewers the app ships:
 *
 *  1. the chat image lightbox — a document-level fixed overlay with an `<img>`;
 *     this module applies a cursor-anchored CSS transform to that image;
 *  2. the right sidebar document/image preview — its zoom viewport already
 *     implements Ctrl+wheel zoom with cursor anchoring, persistence and fit
 *     width, so a plain wheel is translated into the Ctrl+wheel gesture it
 *     already understands instead of re-implementing the math.
 *
 * There is deliberately no setting: wheel zoom is a direct manipulation
 * gesture, and a switch would only make users hunt for it. The module only
 * claims wheels over those two viewers, never over inline thumbnails or the
 * page itself.
 */

import { normalizeWheelDelta, wheelZoomFactor } from './lib/zoom.js'

/** Marks an image this module has transformed (diagnostics only). */
const ZOOM_ATTRIBUTE = 'data-dsh-image-zoom'

/** Cursor-anchored zoom range for the lightbox. */
const MIN_SCALE = 0.4
const MAX_SCALE = 8

/** Original inline transform/origin, restored by double click. */
/** @type {WeakMap<Element, { transform: string, origin: string }>} */
const originals = new WeakMap()

/** Re-entry guard for the synthetic Ctrl+wheel event. */
let injectingWheel = false

/**
 * Whether an element is the app image lightbox, or one of its full-viewport
 * stages. The check is deliberately structural: settings and other modals are
 * also dialogs, so only a dialog whose direct child (or direct stage child) is
 * the image counts as the lightbox (`R27-01`).
 * @param element - candidate viewer element.
 * @returns whether it covers most of the viewport.
 */
function isViewerElement(element) {
  const style = getComputedStyle(element)
  if (style.position !== 'fixed' && style.position !== 'absolute') return false
  const rect = element.getBoundingClientRect()
  return rect.width * rect.height >= window.innerWidth * window.innerHeight * 0.4
}

/**
 * Find the lightbox image for a wheel target, but never for images inside the
 * plugin settings or another nested modal. The real lightbox portal is either
 * `<dialog><img></dialog>` or `<dialog><stage><img…></stage></dialog>`.
 * @param target - wheel event target.
 * @returns the lightbox image, or null.
 */
function findLightboxImage(target) {
  if (target.closest('.dshcb-section') !== null) return null
  const dialog = target.closest('[role="dialog"][aria-modal="true"]')
  if (dialog === null || !isViewerElement(dialog)) return null
  for (const child of dialog.children) {
    if (child.tagName === 'IMG') return child
    if (child.tagName !== 'DIV' || !isViewerElement(child)) continue
    for (const grandchild of child.children) {
      if (grandchild.tagName === 'IMG') return grandchild
    }
  }
  return null
}

/**
 * Read the transform currently applied to an image. Deriving it from computed
 * style (instead of a cached counter) keeps repeated wheels monotonic even if
 * the viewer re-renders or resets the inline transform (`R17-01`).
 * @param image - the viewed `<img>`.
 * @returns scale and translation of the current CSS transform.
 */
function readTransform(image) {
  const style = getComputedStyle(image)
  if (style.transform === 'none' || style.transform === '') {
    return { scale: 1, tx: 0, ty: 0 }
  }
  const matrix = new DOMMatrixReadOnly(style.transform)
  const scale = Math.hypot(matrix.a, matrix.b) || 1
  return { scale, tx: matrix.e, ty: matrix.f }
}

/**
 * Apply one cursor-anchored zoom step to an image inside the lightbox.
 * @param image - viewed `<img>`.
 * @param event - the wheel event (uses deltaY/deltaMode/clientX/clientY).
 */
function zoomImage(image, event) {
  const before = readTransform(image)
  const delta = normalizeWheelDelta(event.deltaY, event.deltaMode, window.innerHeight)
  const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, before.scale * wheelZoomFactor(delta)))
  if (nextScale === before.scale) return
  const rect = image.getBoundingClientRect()
  /* The rect includes the current transform; recover the untransformed origin
   * so the point under the cursor stays under the cursor. */
  const baseLeft = rect.left - before.tx
  const baseTop = rect.top - before.ty
  const localX = (event.clientX - rect.left) / before.scale
  const localY = (event.clientY - rect.top) / before.scale
  const tx = event.clientX - baseLeft - nextScale * localX
  const ty = event.clientY - baseTop - nextScale * localY
  if (!originals.has(image)) {
    originals.set(image, { transform: image.style.transform, origin: image.style.transformOrigin })
  }
  image.style.transformOrigin = '0 0'
  image.style.transform = `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scale(${nextScale.toFixed(4)})`
  image.setAttribute(ZOOM_ATTRIBUTE, nextScale.toFixed(2))
}

/**
 * Reset one lightbox image to its untouched layout.
 * @param image - viewed `<img>`.
 */
function resetImage(image) {
  const original = originals.get(image)
  originals.delete(image)
  if (original !== undefined && original.transform !== '') image.style.transform = original.transform
  else image.style.removeProperty('transform')
  if (original !== undefined && original.origin !== '') image.style.transformOrigin = original.origin
  else image.style.removeProperty('transform-origin')
  image.removeAttribute(ZOOM_ATTRIBUTE)
}

/**
 * Translate a plain wheel over the sidebar preview into the Ctrl+wheel gesture
 * its zoom viewport listens for.
 * @param scrollport - the preview's scrollport element.
 * @param event - original wheel event.
 * @returns whether the gesture was translated.
 */
function translateSidebarWheel(scrollport, event) {
  if (event.ctrlKey || injectingWheel) return false
  injectingWheel = true
  try {
    scrollport.dispatchEvent(
      new WheelEvent('wheel', {
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        deltaMode: event.deltaMode,
        ctrlKey: true,
        clientX: event.clientX,
        clientY: event.clientY,
        bubbles: true,
        cancelable: true
      })
    )
  } finally {
    injectingWheel = false
  }
  return true
}

/**
 * One capture-phase wheel listener for both viewers.
 * @param event - wheel event.
 */
function onWheel(event) {
  const target = event.target instanceof Element ? event.target : null
  if (target === null) return
  const scrollport = target.closest('[data-document-zoom-scrollport]')
  if (scrollport !== null && target.closest('[data-image-preview]') !== null) {
    if (translateSidebarWheel(scrollport, event)) {
      event.preventDefault()
      event.stopPropagation()
    }
    return
  }
  const image = findLightboxImage(target)
  if (image === null) return
  event.preventDefault()
  event.stopPropagation()
  zoomImage(image, event)
}

/**
 * Double click inside the lightbox returns the image to its layout size.
 * @param event - double-click event.
 */
function onDoubleClick(event) {
  const target = event.target instanceof Element ? event.target : null
  if (target === null) return
  const image = findLightboxImage(target)
  if (image === null || !originals.has(image)) return
  resetImage(image)
  event.preventDefault()
  event.stopPropagation()
}

/**
 * Install the wheel gesture globally.
 * @returns an uninstall function for the plugin's disposal path.
 */
export function installImageZoom() {
  window.addEventListener('wheel', onWheel, { capture: true, passive: false })
  window.addEventListener('dblclick', onDoubleClick, { capture: true })
  return () => {
    window.removeEventListener('wheel', onWheel, { capture: true })
    window.removeEventListener('dblclick', onDoubleClick, { capture: true })
  }
}
