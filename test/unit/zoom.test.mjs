import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeWheelDelta, wheelZoomFactor } from '../../src/lib/zoom.js'

test('normalizeWheelDelta: pixel deltas stay unchanged within the step cap', () => {
  assert.equal(normalizeWheelDelta(-120, 0, 900), -120)
  assert.equal(normalizeWheelDelta(53, 0, 900), 53)
})

test('normalizeWheelDelta: line deltas are multiplied by the line height', () => {
  assert.equal(normalizeWheelDelta(3, 1, 900), 48)
  assert.equal(normalizeWheelDelta(-3, 1, 900), -48)
})

test('normalizeWheelDelta: page deltas use the viewport height and stay capped', () => {
  assert.equal(normalizeWheelDelta(1, 2, 900), 120)
  assert.equal(normalizeWheelDelta(-1, 2, 900), -120)
})

test('wheelZoomFactor: wheel up zooms in, wheel down zooms out', () => {
  assert.ok(wheelZoomFactor(-120) > 1)
  assert.ok(wheelZoomFactor(120) < 1)
  assert.equal(wheelZoomFactor(0), 1)
})

test('wheelZoomFactor: opposite deltas are symmetric', () => {
  assert.ok(Math.abs(wheelZoomFactor(-40) * wheelZoomFactor(40) - 1) < 1e-12)
})
