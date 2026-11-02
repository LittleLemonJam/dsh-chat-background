import assert from 'node:assert/strict'
import test from 'node:test'
import { cssColorToHex } from '../../src/lib/color.js'

test('cssColorToHex: three-digit hex expands', () => {
  assert.equal(cssColorToHex('#abc'), '#aabbcc')
  assert.equal(cssColorToHex('#0f0'), '#00ff00')
})

test('cssColorToHex: six-digit hex passes through', () => {
  assert.equal(cssColorToHex('#4176e6'), '#4176e6')
  assert.equal(cssColorToHex('#ABCDEF'), '#ABCDEF')
})

test('cssColorToHex: rgb and rgba reduce to hex', () => {
  assert.equal(cssColorToHex('rgb(65, 118, 230)'), '#4176e6')
  assert.equal(cssColorToHex('rgba(65,118,230,0.5)'), '#4176e6')
  assert.equal(cssColorToHex('rgb(255 255 255 / 0.2)'), '#ffffff')
})

test('cssColorToHex: unparsable values return null', () => {
  assert.equal(cssColorToHex(''), null)
  assert.equal(cssColorToHex('transparent'), null)
  assert.equal(cssColorToHex('color(srgb 0 0 0 / 0)'), null)
  assert.equal(cssColorToHex(undefined), null)
  assert.equal(cssColorToHex(null), null)
})
