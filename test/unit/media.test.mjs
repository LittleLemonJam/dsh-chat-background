import assert from 'node:assert/strict'
import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  ACCEPTED_EXTENSIONS,
  findManifestEntry,
  MEDIA_TYPES,
  mediaTypeFor,
  readImageManifest,
  safeImageName
} from '../../host/media.js'

/** @param {string} prefix */
async function temporaryDirectory(prefix) {
  return mkdtemp(join(tmpdir(), prefix))
}

test('MEDIA_TYPES: the accepted list covers the documented formats', () => {
  for (const extension of ['.png', '.apng', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.bmp', '.svg']) {
    assert.ok(MEDIA_TYPES.has(extension), `missing ${extension}`)
  }
  assert.equal(MEDIA_TYPES.get('.jpg'), 'image/jpeg')
  assert.equal(MEDIA_TYPES.get('.svg'), 'image/svg+xml')
  assert.ok(ACCEPTED_EXTENSIONS.includes('.png'))
})

test('mediaTypeFor: known extensions map to media types, unknown fall back', () => {
  assert.equal(mediaTypeFor('a.PNG'), 'image/png')
  assert.equal(mediaTypeFor('a.jpeg'), 'image/jpeg')
  assert.equal(mediaTypeFor('a.txt'), 'application/octet-stream')
  assert.equal(mediaTypeFor('a'), 'application/octet-stream')
})

test('safeImageName: accepts a plain image file name', () => {
  assert.equal(safeImageName('photo.png'), 'photo.png')
  assert.equal(safeImageName('a b.webp'), 'a b.webp')
  assert.equal(safeImageName('中文背景.jpg'), '中文背景.jpg')
})

test('safeImageName: rejects traversal, separators and hidden files', () => {
  for (const value of [
    '../photo.png',
    '..',
    'a/b.png',
    'a\\b.png',
    '.hidden.png',
    'photo.txt',
    'photo',
    'photo.png\0',
    '',
    null,
    undefined,
    42,
    'x'.repeat(201)
  ]) {
    assert.equal(safeImageName(value), undefined, `unexpectedly accepted ${String(value)}`)
  }
})

test('readImageManifest: lists only images, newest first, with a revision', async () => {
  const directory = await temporaryDirectory('dsh-bg-media-')
  try {
    await writeFile(join(directory, 'old.png'), Buffer.from([1, 2, 3]))
    await writeFile(join(directory, 'new.jpg'), Buffer.from([4, 5]))
    await writeFile(join(directory, 'notes.txt'), 'not an image')
    await writeFile(join(directory, '.hidden.png'), 'hidden')
    const old = new Date('2026-01-01T00:00:00Z')
    const fresh = new Date('2026-02-01T00:00:00Z')
    await utimes(join(directory, 'old.png'), old, old)
    await utimes(join(directory, 'new.jpg'), fresh, fresh)

    const entries = await readImageManifest(directory)
    assert.deepEqual(
      entries.map((entry) => entry.name),
      ['new.jpg', 'old.png']
    )
    assert.equal(entries[0].bytes, 2)
    assert.match(entries[0].rev, /^[0-9a-z]+-[0-9a-z]+$/u)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('readImageManifest: a missing folder lists as empty', async () => {
  const directory = await temporaryDirectory('dsh-bg-media-missing-')
  try {
    assert.deepEqual(await readImageManifest(join(directory, 'absent')), [])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('readImageManifest: a directory entry named like an image is skipped', async () => {
  const directory = await temporaryDirectory('dsh-bg-media-dir-')
  try {
    const { mkdir } = await import('node:fs/promises')
    await mkdir(join(directory, 'folder.png'))
    assert.deepEqual(await readImageManifest(directory), [])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('findManifestEntry: prefers an exact name and falls back case-insensitively (SEC-04)', () => {
  const entries = [{ name: 'photo.png' }, { name: 'Photo-2.jpg' }]
  assert.equal(findManifestEntry(entries, 'photo.png')?.name, 'photo.png')
  assert.equal(findManifestEntry(entries, 'PHOTO.PNG')?.name, 'photo.png')
  assert.equal(findManifestEntry(entries, 'photo-2.JPG')?.name, 'Photo-2.jpg')
  assert.equal(findManifestEntry(entries, 'other.png'), undefined)
})
