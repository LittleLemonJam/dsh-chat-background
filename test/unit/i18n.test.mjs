import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { copyNow, en, zh } from '../../src/i18n.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

test('i18n: zh and en expose exactly the same keys', () => {
  const zhKeys = Object.keys(zh).sort()
  const enKeys = Object.keys(en).sort()
  assert.deepEqual(zhKeys, enKeys)
  assert.ok(zhKeys.length > 30, `expected the full dictionary, got ${String(zhKeys.length)} keys`)
})

test('i18n: every copy value is a non-empty string', () => {
  for (const [key, value] of Object.entries(zh)) assert.equal(typeof value, 'string', `zh.${key}`)
  for (const [key, value] of Object.entries(en)) assert.equal(typeof value, 'string', `en.${key}`)
  for (const [key, value] of Object.entries(zh)) assert.ok(value.length > 0, `zh.${key} is empty`)
  for (const [key, value] of Object.entries(en)) assert.ok(value.length > 0, `en.${key} is empty`)
})

test('i18n: placeholders match between the two languages', () => {
  const placeholders = (text) => [...text.matchAll(/\{[a-z]+\}/gu)].map((match) => match[0]).sort()
  for (const key of Object.keys(zh)) {
    assert.deepEqual(placeholders(zh[key]), placeholders(en[key]), `placeholder mismatch in ${key}`)
  }
})

test('copyNow: without a document the English dictionary is returned', () => {
  assert.equal(typeof globalThis.document, 'undefined', 'the unit test environment must not provide a document')
  assert.equal(copyNow(), en)
})

test('locale resources: zh/en meta blocks carry title and description', async () => {
  for (const language of ['zh', 'en']) {
    const parsed = JSON.parse(await readFile(join(ROOT, 'locale', `${language}.json`), 'utf8'))
    assert.deepEqual(Object.keys(parsed), ['meta'])
    assert.equal(typeof parsed.meta.title, 'string')
    assert.ok(parsed.meta.title.length > 0)
    assert.equal(typeof parsed.meta.description, 'string')
    assert.ok(parsed.meta.description.length > 0)
  }
})
