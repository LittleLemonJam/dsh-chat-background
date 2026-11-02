import assert from 'node:assert/strict'
import test from 'node:test'
import { formatCompactTokens } from '../../src/lib/format.js'

test('formatCompactTokens: invalid and zero values collapse to "0"', () => {
  assert.equal(formatCompactTokens(0), '0')
  assert.equal(formatCompactTokens(-1), '0')
  assert.equal(formatCompactTokens(Number.NaN), '0')
  assert.equal(formatCompactTokens(Number.POSITIVE_INFINITY), '0')
})

test('formatCompactTokens: raw integers below one thousand', () => {
  assert.equal(formatCompactTokens(1), '1')
  assert.equal(formatCompactTokens(999), '999')
})

test('formatCompactTokens: thousands keep one decimal below 10K, none above', () => {
  assert.equal(formatCompactTokens(1_234), '1.2K')
  assert.equal(formatCompactTokens(9_876), '9.9K')
  assert.equal(formatCompactTokens(45_678), '46K')
})

test('formatCompactTokens: millions keep one decimal below 10M, none above', () => {
  assert.equal(formatCompactTokens(4_376_588), '4.4M')
  assert.equal(formatCompactTokens(437_658_830), '438M')
})

test('formatCompactTokens: billions use two decimals', () => {
  assert.equal(formatCompactTokens(1_234_567_890), '1.23B')
  assert.equal(formatCompactTokens(9_876_543_210), '9.88B')
})
