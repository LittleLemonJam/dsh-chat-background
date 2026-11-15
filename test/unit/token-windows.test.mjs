import assert from 'node:assert/strict'
import test from 'node:test'
import {
  localMonthWindow,
  readMonthlyTokens,
  readTokenWindows,
  readTokenWindowsFromLedger,
  readWeeklyTokens,
  tokensOfDay
} from '../../host/token-windows.js'

const NOW = new Date(2026, 10, 15, 12, 0, 0).getTime()

const LEDGER = {
  days: {
    '2026-09-30': { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 },
    '2026-10-01': { input: 10, output: 1, cacheRead: 100, cacheWrite: 0 },
    '2026-11-01': { input: 20, output: 2, cacheRead: 200, cacheWrite: 0 },
    '2026-11-15': { input: 30, output: 3, cacheRead: 300, cacheWrite: 0 },
    '2026-12-01': { input: 40, output: 4, cacheRead: 400, cacheWrite: 0 }
  },
  planSamples: {
    go: {
      weekly: [
        {
          t: NOW - 1000,
          s: Date.parse('2026-11-09T00:00:00.000Z'),
          r: '2026-11-16T00:00:00.000Z',
          lt: 1234,
          p: 25
        }
      ]
    }
  },
  planHourBuckets: {
    go: {
      [String(Date.parse('2026-11-10T01:00:00.000Z'))]: { tokens: 10 },
      [String(Date.parse('2026-11-16T00:00:00.000Z'))]: { tokens: 999 }
    }
  }
}

test('tokensOfDay: sums the four tracked buckets and ignores junk', () => {
  assert.equal(tokensOfDay({ input: 1, output: 2, cacheRead: 3, cacheWrite: 4 }), 10)
  assert.equal(tokensOfDay({ input: '5', output: 5 }), 10)
  assert.equal(tokensOfDay(null), 0)
  assert.equal(tokensOfDay({ input: Number.NaN, output: -1 }), 0)
})

test('localMonthWindow: returns the current local month boundaries', () => {
  const window = localMonthWindow(NOW)
  assert.equal(window.monthKey, '2026-11')
  assert.equal(new Date(window.from).getDate(), 1)
  assert.equal(new Date(window.to).getMonth(), 11)
})

test('readMonthlyTokens: sums only the current calendar month', () => {
  const monthly = readMonthlyTokens(LEDGER, NOW)
  assert.equal(monthly.monthKey, '2026-11')
  assert.equal(monthly.tokens, 555)
  assert.equal(monthly.days, 2)
})

test('readWeeklyTokens: uses the subscription window token count and reset', () => {
  const weekly = readWeeklyTokens(LEDGER, NOW)
  assert.equal(weekly.tokens, 1234)
  assert.equal(weekly.percent, 25)
  assert.equal(weekly.windowStart, '2026-11-09T00:00:00.000Z')
  assert.equal(weekly.windowEnd, '2026-11-16T00:00:00.000Z')
  assert.equal(weekly.resetAt, '2026-11-16T00:00:00.000Z')
})

test('readWeeklyTokens: falls back to the hourly buckets when lt is absent', () => {
  const ledger = {
    planSamples: { go: { weekly: [{ t: NOW, s: Date.parse('2026-11-09T00:00:00Z'), r: '2026-11-16T00:00:00Z' }] } },
    planHourBuckets: LEDGER.planHourBuckets
  }
  const weekly = readWeeklyTokens(ledger, NOW)
  assert.equal(weekly.tokens, 10)
})

test('readWeeklyTokens: returns null when there is no subscription sample', () => {
  assert.equal(readWeeklyTokens({ days: {} }, NOW), null)
})

test('readTokenWindowsFromLedger: returns both windows', () => {
  const windows = readTokenWindowsFromLedger(LEDGER, NOW)
  assert.equal(windows.monthly.tokens, 555)
  assert.equal(windows.weekly.tokens, 1234)
})

test('readTokenWindows: missing ledger is unavailable, not an error', async () => {
  assert.equal(await readTokenWindows('C:/definitely/not/a/ledger.json', NOW), null)
})
