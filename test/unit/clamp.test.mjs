import assert from 'node:assert/strict'
import test from 'node:test'
import { clampToRange, parsePercent } from '../../src/lib/clamp.js'

test('clampToRange: rounds and clamps into the inclusive range', () => {
  assert.equal(clampToRange(58.4, 10, 90), 58)
  assert.equal(clampToRange(58.5, 10, 90), 59)
  assert.equal(clampToRange(-5, 0, 90), 0)
  assert.equal(clampToRange(500, 10, 90), 90)
})

test('parsePercent: stored values are parsed and clamped', () => {
  assert.equal(parsePercent('45', 58, 10, 90), 45)
  assert.equal(parsePercent('90.6', 58, 10, 90), 90)
  assert.equal(parsePercent('1', 58, 10, 90), 10)
})

test('parsePercent: missing or unparsable values fall back', () => {
  assert.equal(parsePercent(null, 58, 10, 90), 58)
  assert.equal(parsePercent('', 58, 10, 90), 58)
  assert.equal(parsePercent('not-a-number', 58, 10, 90), 58)
  assert.equal(parsePercent('NaN', 58, 10, 90), 58)
})
