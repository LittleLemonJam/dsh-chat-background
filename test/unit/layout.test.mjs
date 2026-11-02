import assert from 'node:assert/strict'
import test from 'node:test'
import { isFullscreenPanel } from '../../src/lib/layout.js'

test('isFullscreenPanel: a full-window panel is fullscreen', () => {
  assert.equal(isFullscreenPanel({ width: 1416, height: 808, left: 0, top: 0 }, { width: 1416, height: 808 }), true)
})

test('isFullscreenPanel: a normal right-column panel is not fullscreen', () => {
  assert.equal(isFullscreenPanel({ width: 637, height: 808, left: 779, top: 0 }, { width: 1416, height: 808 }), false)
})

test('isFullscreenPanel: narrow viewports do not misclassify a normal panel (R12-02)', () => {
  assert.equal(isFullscreenPanel({ width: 637, height: 808, left: 280, top: 0 }, { width: 639, height: 808 }), false)
  assert.equal(isFullscreenPanel({ width: 637, height: 808, left: 2, top: 0 }, { width: 637, height: 808 }), false)
})
