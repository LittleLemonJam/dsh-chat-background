import assert from 'node:assert/strict'
import test from 'node:test'
import {
  moveRotationImage,
  normalizeRotationDuration,
  normalizeRotationInterval,
  pickNextImage,
  selectRotationGroup
} from '../../src/lib/rotation.js'

test('pickNextImage: advances after the current image and wraps', () => {
  const names = ['a.png', 'b.png', 'c.png']
  assert.equal(pickNextImage(names, 'a.png'), 'b.png')
  assert.equal(pickNextImage(names, 'c.png'), 'a.png')
})

test('pickNextImage: a foreign or missing current starts at the first image', () => {
  assert.equal(pickNextImage(['a.png', 'b.png'], 'x.png'), 'a.png')
  assert.equal(pickNextImage(['a.png', 'b.png'], null), 'a.png')
  assert.equal(pickNextImage([], 'a.png'), null)
})

test('selectRotationGroup: keeps only available images, in the stored rotation order', () => {
  assert.deepEqual(selectRotationGroup(['b.png', 'x.png', 'a.png'], ['a.png', 'b.png', 'c.png']), ['b.png', 'a.png'])
})

test('rotation durations clamp to 0–3s and keep one decimal', () => {
  assert.equal(normalizeRotationDuration(0.3), 0.3)
  assert.equal(normalizeRotationDuration(-1), 0)
  assert.equal(normalizeRotationDuration(9), 3)
  assert.equal(normalizeRotationDuration('1.26'), 1.3)
})

test('rotation intervals clamp to whole seconds in 5–300', () => {
  assert.equal(normalizeRotationInterval(5), 5)
  assert.equal(normalizeRotationInterval(4), 5)
  assert.equal(normalizeRotationInterval(999), 300)
  assert.equal(normalizeRotationInterval(30.4), 30)
})

test('moveRotationImage: dragging down inserts after the target', () => {
  assert.deepEqual(moveRotationImage(['a.png', 'b.png', 'c.png'], 'a.png', 'b.png'), ['b.png', 'a.png', 'c.png'])
})

test('moveRotationImage: dragging up inserts before the target', () => {
  assert.deepEqual(moveRotationImage(['a.png', 'b.png', 'c.png'], 'c.png', 'a.png'), ['c.png', 'a.png', 'b.png'])
})
