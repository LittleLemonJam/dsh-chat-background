import assert from 'node:assert/strict'
import test from 'node:test'
import { followThemeFromStorage, scrimThemeKey } from '../../src/lib/scrims.js'

test('scrimThemeKey: scopes the base key by theme', () => {
  assert.equal(scrimThemeKey('dsh-chat-background:scrim-left', false), 'dsh-chat-background:scrim-left:light')
  assert.equal(scrimThemeKey('dsh-chat-background:scrim-left', true), 'dsh-chat-background:scrim-left:dark')
})

test('followThemeFromStorage: only an explicit on enables the opt-in switch', () => {
  assert.equal(followThemeFromStorage('on'), true)
  assert.equal(followThemeFromStorage('off'), false)
  assert.equal(followThemeFromStorage(null), false)
  assert.equal(followThemeFromStorage(''), false)
})
