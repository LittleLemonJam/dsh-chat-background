import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  emptyTotals,
  MAX_PROJECTION_BYTES,
  missingTotalsPayload,
  readTokenTotals,
  readTokenTotalsFromServices,
  TOKEN_KEYS
} from '../../host/token-usage.js'

/** One projection file body with the given four buckets. */
function projection(totals) {
  return JSON.stringify({ record: { rows: { tokenUsage: { val: { totals } } } } })
}

/** @param {string} prefix */
async function temporaryDirectory(prefix) {
  return mkdtemp(join(tmpdir(), prefix))
}

test('TOKEN_KEYS: the four documented buckets, in display order', () => {
  assert.deepEqual(TOKEN_KEYS, ['uncachedInputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'])
  assert.deepEqual(emptyTotals(), {
    uncachedInputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0
  })
})

test('readTokenTotals: sums the four buckets over every projection file', async () => {
  const directory = await temporaryDirectory('dsh-bg-tokens-')
  try {
    await writeFile(
      join(directory, 'a.json'),
      projection({ uncachedInputTokens: 100, outputTokens: 200, cacheReadTokens: 300, cacheWriteTokens: 400 })
    )
    await writeFile(join(directory, 'b.json'), projection({ uncachedInputTokens: 1, outputTokens: 2 }))
    const totals = await readTokenTotals(directory)
    assert.ok(totals !== null)
    assert.equal(totals.uncachedInputTokens, 101)
    assert.equal(totals.outputTokens, 202)
    assert.equal(totals.cacheReadTokens, 300)
    assert.equal(totals.cacheWriteTokens, 400)
    assert.equal(totals.total, 1_003)
    assert.equal(totals.sessions, 2)
    assert.equal(totals.countedSessions, 2)
    assert.equal(typeof totals.scannedAt, 'number')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('readTokenTotals: malformed, foreign and empty files do not contribute', async () => {
  const directory = await temporaryDirectory('dsh-bg-tokens-bad-')
  try {
    await writeFile(join(directory, 'valid.json'), projection({ outputTokens: 10 }))
    await writeFile(join(directory, 'broken.json'), '{ not json')
    await writeFile(join(directory, 'foreign.json'), JSON.stringify({ hello: 'world' }))
    await writeFile(join(directory, 'ignored.txt'), 'not a projection')
    const totals = await readTokenTotals(directory)
    assert.ok(totals !== null)
    assert.equal(totals.total, 10)
    assert.equal(totals.sessions, 3)
    assert.equal(totals.countedSessions, 1)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('readTokenTotals: negative and non-numeric bucket values are ignored', async () => {
  const directory = await temporaryDirectory('dsh-bg-tokens-odd-')
  try {
    await writeFile(
      join(directory, 'odd.json'),
      projection({ uncachedInputTokens: -5, outputTokens: 'many', cacheReadTokens: 7 })
    )
    const totals = await readTokenTotals(directory)
    assert.ok(totals !== null)
    assert.equal(totals.uncachedInputTokens, 0)
    assert.equal(totals.outputTokens, 0)
    assert.equal(totals.cacheReadTokens, 7)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('readTokenTotals: a missing directory reports null', async () => {
  const directory = await temporaryDirectory('dsh-bg-tokens-missing-')
  try {
    assert.equal(await readTokenTotals(join(directory, 'absent')), null)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('readTokenTotals: an existing empty directory is all zeros', async () => {
  const directory = await temporaryDirectory('dsh-bg-tokens-empty-')
  try {
    await mkdir(join(directory, 'sub'), { recursive: true })
    const totals = await readTokenTotals(directory)
    assert.ok(totals !== null)
    assert.equal(totals.total, 0)
    assert.equal(totals.sessions, 0)
    assert.equal(totals.countedSessions, 0)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('readTokenTotals: a projection larger than the size cap is skipped (R-10)', async () => {
  const directory = await temporaryDirectory('dsh-bg-tokens-large-')
  try {
    await writeFile(join(directory, 'small.json'), projection({ outputTokens: 5 }))
    await writeFile(join(directory, 'huge.json'), Buffer.alloc(MAX_PROJECTION_BYTES + 1, 0x20))
    const totals = await readTokenTotals(directory)
    assert.ok(totals !== null)
    assert.equal(totals.total, 5)
    assert.equal(totals.sessions, 2)
    assert.equal(totals.countedSessions, 1)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('readTokenTotals: reports the files source and counts', async () => {
  const directory = await temporaryDirectory('dsh-bg-tokens-source-')
  try {
    await writeFile(join(directory, 'a.json'), projection({ outputTokens: 1 }))
    const totals = await readTokenTotals(directory)
    assert.equal(totals?.source, 'files')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('readTokenTotalsFromServices: sums cached tokenUsage projection values', async () => {
  const projectionCache = {
    cachedSnapshot(header) {
      if (header.id === 'a') return { values: { tokenUsage: { uncachedInputTokens: 10, outputTokens: 20 } } }
      if (header.id === 'b') return { values: { tokenUsage: { cacheReadTokens: 30, cacheWriteTokens: 40 } } }
      return undefined
    }
  }
  const persistence = {
    async list() {
      return [{ header: { id: 'a' } }, { header: { id: 'b' } }, { header: { id: 'c' } }]
    }
  }
  const totals = await readTokenTotalsFromServices({ persistence, projectionCache })
  assert.ok(totals !== null)
  assert.equal(totals.total, 100)
  assert.equal(totals.sessions, 3)
  assert.equal(totals.countedSessions, 2)
  assert.equal(totals.source, 'services')
})

test('readTokenTotalsFromServices: tolerates malformed values and missing listings', async () => {
  const projectionCache = {
    cachedSnapshot() {
      throw new Error('cache unavailable')
    }
  }
  const persistence = {
    async list() {
      return [{ header: {} }]
    }
  }
  const totals = await readTokenTotalsFromServices({ persistence, projectionCache })
  assert.ok(totals !== null)
  assert.equal(totals.total, 0)
  assert.equal(totals.sessions, 1)
  assert.equal(totals.countedSessions, 0)
  const empty = await readTokenTotalsFromServices({
    persistence: {
      async list() {
        return null
      }
    },
    projectionCache
  })
  assert.equal(empty, null)
})

test('missingTotalsPayload: a zero payload flagged missing', () => {
  const payload = missingTotalsPayload()
  assert.equal(payload.total, 0)
  assert.equal(payload.sessions, 0)
  assert.equal(payload.missing, true)
  assert.equal(payload.uncachedInputTokens, 0)
})
