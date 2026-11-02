import assert from 'node:assert/strict'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { backgroundsDir, dshHomeDir, expandHomePath } from '../../host/paths.js'

/** Set or clear an environment variable for one test, returning a restore hook. */
function withEnvironment(name, value) {
  const before = process.env[name]
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
  return () => {
    if (before === undefined) delete process.env[name]
    else process.env[name] = before
  }
}

test('dshHomeDir: DSH_HOME wins over the home directory', () => {
  const restore = withEnvironment('DSH_HOME', '/tmp/dsh-home-test')
  try {
    assert.equal(dshHomeDir(), resolve('/tmp/dsh-home-test'))
  } finally {
    restore()
  }
})

test('dshHomeDir: blank DSH_HOME falls back to ~/.dsh', () => {
  const restore = withEnvironment('DSH_HOME', '   ')
  try {
    assert.match(dshHomeDir(), /\.dsh$/u)
  } finally {
    restore()
  }
})

test('backgroundsDir: DSH_BACKGROUNDS_DIR wins over DSH_HOME', () => {
  const restoreHome = withEnvironment('DSH_HOME', '/tmp/dsh-home-test')
  const restoreBackgrounds = withEnvironment('DSH_BACKGROUNDS_DIR', '/tmp/dsh-backgrounds-test')
  try {
    assert.match(backgroundsDir(), /dsh-backgrounds-test$/u)
  } finally {
    restoreBackgrounds()
    restoreHome()
  }
})

test('backgroundsDir: a trailing separator is normalised away (BG-05)', () => {
  const restoreBackgrounds = withEnvironment('DSH_BACKGROUNDS_DIR', '/tmp/dsh-backgrounds-test/')
  try {
    assert.equal(backgroundsDir(), resolve('/tmp/dsh-backgrounds-test'))
  } finally {
    restoreBackgrounds()
  }
})

test('backgroundsDir: falls back to <dsh home>/backgrounds', () => {
  const restoreHome = withEnvironment('DSH_HOME', '/tmp/dsh-home-test')
  const restoreBackgrounds = withEnvironment('DSH_BACKGROUNDS_DIR', undefined)
  try {
    assert.match(backgroundsDir(), /dsh-home-test[/\\]backgrounds$/u)
  } finally {
    restoreBackgrounds()
    restoreHome()
  }
})

test('expandHomePath: leading ~ is expanded like the host resolver (R2 F8)', () => {
  assert.equal(expandHomePath('~'), homedir())
  assert.equal(expandHomePath('~/.dsh'), join(homedir(), '.dsh'))
  assert.equal(expandHomePath('~\\backgrounds'), join(homedir(), 'backgrounds'))
  assert.equal(expandHomePath('C:\\custom'), 'C:\\custom')
})

test('backgroundsDir: an env value with ~ expands before resolving', () => {
  const restore = withEnvironment('DSH_BACKGROUNDS_DIR', '~/pictures/walls')
  try {
    assert.equal(backgroundsDir(), join(homedir(), 'pictures', 'walls'))
  } finally {
    restore()
  }
})
