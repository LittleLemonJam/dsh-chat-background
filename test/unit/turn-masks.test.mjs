import assert from 'node:assert/strict'
import test from 'node:test'
import { computeTurnCards, groupTurnRanges } from '../../src/lib/turn-masks.js'

test('groupTurnRanges: merges the flow items of one turn into one range', () => {
  const ranges = groupTurnRanges([
    { turn: '1', top: 0, bottom: 60 },
    { turn: '1', top: 66, bottom: 200 },
    { turn: '2', top: 220, bottom: 300 }
  ])
  assert.deepEqual(ranges, [
    { key: '1', top: 0, bottom: 200 },
    { key: '2', top: 220, bottom: 300 }
  ])
})

test('groupTurnRanges: skips empty turns and malformed ranges', () => {
  const ranges = groupTurnRanges([
    { turn: '', top: 0, bottom: 10 },
    { turn: '1', top: 20, bottom: 20 },
    { turn: '2', top: undefined, bottom: 40 },
    { turn: '3', top: 50, bottom: 90 }
  ])
  assert.deepEqual(ranges, [{ key: '3', top: 50, bottom: 90 }])
})

test('groupTurnRanges: orders ranges by position, not by first sighting', () => {
  const ranges = groupTurnRanges([
    { turn: '2', top: 300, bottom: 360 },
    { turn: '1', top: 0, bottom: 100 },
    { turn: '2', top: 366, bottom: 420 }
  ])
  assert.deepEqual(
    ranges.map((range) => range.key),
    ['1', '2']
  )
  assert.equal(ranges[1].bottom, 420)
})

test('computeTurnCards: the first and last turns may use the full padding', () => {
  const cards = computeTurnCards([
    { key: '1', top: 0, bottom: 100 },
    { key: '2', top: 112, bottom: 200 },
    { key: '3', top: 212, bottom: 300 }
  ])
  assert.deepEqual(cards, [
    { key: '1', top: -10, height: 113 },
    { key: '2', top: 109, height: 94 },
    { key: '3', top: 209, height: 101 }
  ])
})

test('computeTurnCards: adjacent cards never lose the minimum wallpaper gap', () => {
  const cards = computeTurnCards(
    [
      { key: '1', top: 0, bottom: 100 },
      { key: '2', top: 112, bottom: 200 },
      { key: '3', top: 208, bottom: 300 }
    ],
    { padding: 10, minGap: 6 }
  )
  for (let index = 1; index < cards.length; index += 1) {
    const gap = cards[index].top - (cards[index - 1].top + cards[index - 1].height)
    assert.ok(gap >= 6 - 1e-9, `expected gap >= 6, got ${String(gap)}`)
  }
})

test('computeTurnCards: a flow gap smaller than minGap is kept without overlapping', () => {
  const cards = computeTurnCards(
    [
      { key: '1', top: 0, bottom: 100 },
      { key: '2', top: 104, bottom: 200 }
    ],
    { padding: 10, minGap: 6 }
  )
  assert.equal(cards[0].top + cards[0].height, 100)
  assert.equal(cards[1].top, 104)
})

test('computeTurnCards: touching ranges keep zero padding instead of overlapping', () => {
  const cards = computeTurnCards(
    [
      { key: '1', top: 0, bottom: 100 },
      { key: '2', top: 100, bottom: 200 }
    ],
    { padding: 10, minGap: 6 }
  )
  assert.equal(cards[0].top + cards[0].height, 100)
  assert.equal(cards[1].top, 100)
})

test('computeTurnCards: a single turn is content plus symmetric padding', () => {
  assert.deepEqual(computeTurnCards([{ key: 'only', top: 40, bottom: 140 }]), [{ key: 'only', top: 30, height: 120 }])
})
