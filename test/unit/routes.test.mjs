import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm, truncate, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { Writable } from 'node:stream'
import test from 'node:test'
import { createHandlers } from '../../host/routes.js'

const logger = { warn() {}, info() {} }

/** The Host header the request fence accepts in tests. */
const TRUSTED_HOST = '127.0.0.1:12345'

/**
 * A minimal Node response double. A real `Writable` is used so `stream.pipe`
 * works; the handlers only additionally use writeHead/setHeader/destroy.
 */
function createResponse() {
  const chunks = []
  const response = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk))
      callback()
    }
  })
  response.statusCode = 0
  response.headers = {}
  response.writeHead = (status, headers) => {
    response.statusCode = status
    response.headers = { ...response.headers, ...(headers ?? {}) }
    return response
  }
  response.setHeader = (name, value) => {
    response.headers[name] = value
  }
  Object.defineProperty(response, 'body', {
    get() {
      return Buffer.concat(chunks).toString()
    }
  })
  Object.defineProperty(response, 'rawBody', {
    get() {
      return Buffer.concat(chunks)
    }
  })
  return response
}

/**
 * Build a request double with the trusted Host by default.
 * @param options - method, url and header overrides.
 */
function createRequest({ method = 'GET', url, headers = {} } = {}) {
  return { method, url: url ?? '/', headers: { host: TRUSTED_HOST, ...headers } }
}

/** @param {string} prefix */
async function temporaryDirectory(prefix) {
  return mkdtemp(join(tmpdir(), prefix))
}

/** Build handlers over one temporary folder + token directory. */
async function createFixture(options = {}) {
  const directory = await temporaryDirectory('dsh-bg-routes-')
  const folder = join(directory, 'backgrounds')
  const tokenDirectory = join(directory, 'tokens')
  const handlers = createHandlers({
    folder,
    tokenDirectory,
    logger,
    tokenCacheMs: options.tokenCacheMs ?? 10_000,
    manifestCacheMs: options.manifestCacheMs ?? 0,
    trustedHosts: 'trustedHosts' in options ? options.trustedHosts : new Set(['127.0.0.1']),
    maxImageBytes: options.maxImageBytes,
    tokenProvider: options.tokenProvider
  })
  return { directory, folder, tokenDirectory, handlers }
}

test('list: reports the folder, accepted formats and its images', async () => {
  const fixture = await createFixture()
  try {
    await mkdir(fixture.folder, { recursive: true })
    await writeFile(join(fixture.folder, 'photo.png'), 'image-bytes')
    await writeFile(join(fixture.folder, 'notes.txt'), 'not an image')
    const response = createResponse()
    await fixture.handlers.list(createRequest({ url: '/chat-backgrounds/list' }), response)
    assert.equal(response.statusCode, 200)
    const payload = JSON.parse(response.body)
    assert.ok(payload.folder.endsWith('backgrounds'))
    assert.match(payload.accepted, /\.png/u)
    assert.deepEqual(
      payload.images.map((entry) => entry.name),
      ['photo.png']
    )
    assert.equal(payload.truncated, false)
  } finally {
    await rm(fixture.directory, { recursive: true, force: true })
  }
})

test('list: the folder label never exposes the home directory (SEC-03)', async () => {
  const fixture = await createFixture()
  try {
    const response = createResponse()
    await fixture.handlers.list(createRequest({ url: '/chat-backgrounds/list' }), response)
    const payload = JSON.parse(response.body)
    assert.equal(payload.folder.includes(homedir()), false)
  } finally {
    await rm(fixture.directory, { recursive: true, force: true })
  }
})

test('list: HEAD answers headers without a body', async () => {
  const fixture = await createFixture()
  try {
    const response = createResponse()
    await fixture.handlers.list(createRequest({ method: 'HEAD', url: '/chat-backgrounds/list' }), response)
    assert.equal(response.statusCode, 200)
    assert.equal(response.body, '')
  } finally {
    await rm(fixture.directory, { recursive: true, force: true })
  }
})

test('list: an unsupported method is rejected with 405 and Allow', async () => {
  const fixture = await createFixture()
  try {
    const response = createResponse()
    await fixture.handlers.list(createRequest({ method: 'DELETE', url: '/chat-backgrounds/list' }), response)
    assert.equal(response.statusCode, 405)
    assert.match(String(response.headers.allow), /GET/u)
  } finally {
    await rm(fixture.directory, { recursive: true, force: true })
  }
})

test('fence: rejects foreign Host, cross-site and foreign Origin (SEC-02)', async () => {
  const fixture = await createFixture()
  try {
    const cases = [
      createRequest({ url: '/chat-backgrounds/list', headers: { host: 'attacker.test:12345' } }),
      createRequest({ url: '/chat-backgrounds/list', headers: { 'sec-fetch-site': 'cross-site' } }),
      createRequest({ url: '/chat-backgrounds/list', headers: { origin: 'https://evil.example' } }),
      createRequest({ url: '/chat-backgrounds/list', headers: { origin: 'null' } }),
      { method: 'GET', url: '/chat-backgrounds/list', headers: {} }
    ]
    for (const request of cases) {
      const response = createResponse()
      await fixture.handlers.list(request, response)
      assert.equal(response.statusCode, 403, `expected 403 for ${JSON.stringify(request.headers)}`)
    }
    const sameOrigin = createRequest({
      url: '/chat-backgrounds/list',
      headers: { 'sec-fetch-site': 'same-origin', origin: `http://${TRUSTED_HOST}` }
    })
    const response = createResponse()
    await fixture.handlers.list(sameOrigin, response)
    assert.equal(response.statusCode, 200)
  } finally {
    await rm(fixture.directory, { recursive: true, force: true })
  }
})

test('fence: a null trusted-host set disables only the host check', async () => {
  const fixture = await createFixture({ trustedHosts: null })
  try {
    const foreign = createResponse()
    await fixture.handlers.list(
      createRequest({ url: '/chat-backgrounds/list', headers: { host: 'attacker.test:12345' } }),
      foreign
    )
    assert.equal(foreign.statusCode, 200)
    const crossSite = createResponse()
    await fixture.handlers.list(
      createRequest({ url: '/chat-backgrounds/list', headers: { 'sec-fetch-site': 'cross-site' } }),
      crossSite
    )
    assert.equal(crossSite.statusCode, 403)
  } finally {
    await rm(fixture.directory, { recursive: true, force: true })
  }
})

test('file: an unreadable background folder answers 500 instead of rejecting', async () => {
  const fixture = await createFixture()
  try {
    await writeFile(fixture.folder, 'not a directory')
    const response = createResponse()
    await fixture.handlers.file(createRequest({ url: '/chat-backgrounds/files/photo.png' }), response)
    assert.equal(response.statusCode, 500)
    assert.match(response.body, /background folder could not be read/u)
  } finally {
    await rm(fixture.directory, { recursive: true, force: true })
  }
})

test('file: serves a listed image with security headers', async () => {
  const fixture = await createFixture()
  try {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01, 0x02])
    await mkdir(fixture.folder, { recursive: true })
    await writeFile(join(fixture.folder, 'photo.png'), bytes)
    const response = createResponse()
    const finished = once(response, 'finish')
    await fixture.handlers.file(createRequest({ url: '/chat-backgrounds/files/photo.png' }), response)
    await finished
    assert.equal(response.statusCode, 200)
    assert.equal(response.headers['content-type'], 'image/png')
    assert.equal(response.headers['cache-control'], 'private, max-age=0, must-revalidate')
    assert.equal(response.headers['x-content-type-options'], 'nosniff')
    assert.equal(response.headers['cross-origin-resource-policy'], 'same-origin')
    assert.match(String(response.headers.etag), /^"[0-9a-z]+-[0-9a-z]+"$/u)
    assert.deepEqual(response.rawBody, bytes)
  } finally {
    await rm(fixture.directory, { recursive: true, force: true })
  }
})

test('file: SVG is served with a sandboxing CSP (SEC-01)', async () => {
  const fixture = await createFixture()
  try {
    await mkdir(fixture.folder, { recursive: true })
    await writeFile(
      join(fixture.folder, 'probe.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>'
    )
    const response = createResponse()
    const finished = once(response, 'finish')
    await fixture.handlers.file(createRequest({ url: '/chat-backgrounds/files/probe.svg' }), response)
    await finished
    assert.equal(response.statusCode, 200)
    assert.equal(response.headers['content-type'], 'image/svg+xml')
    assert.match(String(response.headers['content-security-policy']), /sandbox/u)
    assert.match(String(response.headers['content-security-policy']), /default-src 'none'/u)
  } finally {
    await rm(fixture.directory, { recursive: true, force: true })
  }
})

test('file: serves the listed name case-insensitively but never an unlisted alias (SEC-04)', async () => {
  const fixture = await createFixture()
  try {
    await mkdir(fixture.folder, { recursive: true })
    await writeFile(join(fixture.folder, 'visible.png'), 'image-bytes')
    await writeFile(join(fixture.folder, '.hidden.png'), 'hidden')
    const upper = createResponse()
    const finished = once(upper, 'finish')
    await fixture.handlers.file(createRequest({ url: '/chat-backgrounds/files/VISIBLE.PNG' }), upper)
    await finished
    assert.equal(upper.statusCode, 200)
    for (const url of ['/chat-backgrounds/files/.hidden.png', '/chat-backgrounds/files/HIDDEN~1.PNG']) {
      const response = createResponse()
      await fixture.handlers.file(createRequest({ url }), response)
      assert.equal(response.statusCode, 404, `expected 404 for ${url}`)
    }
  } finally {
    await rm(fixture.directory, { recursive: true, force: true })
  }
})

test('file: answers 413 above the configured size cap (SEC-08)', async () => {
  const fixture = await createFixture({ maxImageBytes: 16 })
  try {
    await mkdir(fixture.folder, { recursive: true })
    const path = join(fixture.folder, 'large.png')
    await writeFile(path, Buffer.alloc(16))
    await truncate(path, 64)
    const response = createResponse()
    await fixture.handlers.file(createRequest({ url: '/chat-backgrounds/files/large.png' }), response)
    assert.equal(response.statusCode, 413)
  } finally {
    await rm(fixture.directory, { recursive: true, force: true })
  }
})

test('file: HEAD answers headers without the bytes', async () => {
  const fixture = await createFixture()
  try {
    await mkdir(fixture.folder, { recursive: true })
    await writeFile(join(fixture.folder, 'photo.png'), 'image-bytes')
    const response = createResponse()
    await fixture.handlers.file(createRequest({ method: 'HEAD', url: '/chat-backgrounds/files/photo.png' }), response)
    assert.equal(response.statusCode, 200)
    assert.equal(response.body, '')
    assert.equal(response.headers['content-length'], String('image-bytes'.length))
  } finally {
    await rm(fixture.directory, { recursive: true, force: true })
  }
})

test('file: a matching If-None-Match revalidates with 304', async () => {
  const fixture = await createFixture()
  try {
    await mkdir(fixture.folder, { recursive: true })
    await writeFile(join(fixture.folder, 'photo.png'), 'image-bytes')
    const first = createResponse()
    await fixture.handlers.file(createRequest({ url: '/chat-backgrounds/files/photo.png' }), first)
    const response = createResponse()
    await fixture.handlers.file(
      createRequest({
        url: '/chat-backgrounds/files/photo.png',
        headers: { 'if-none-match': first.headers.etag }
      }),
      response
    )
    assert.equal(response.statusCode, 304)
    assert.equal(response.headers['x-content-type-options'], 'nosniff')
  } finally {
    await rm(fixture.directory, { recursive: true, force: true })
  }
})

test('file: traversal, malformed names and unknown routes answer 404', async () => {
  const fixture = await createFixture()
  try {
    for (const url of [
      '/chat-backgrounds/files/../secret.png',
      '/chat-backgrounds/files/..%2Fsecret.png',
      '/chat-backgrounds/files/%E0%A4%A',
      '/chat-backgrounds/files/photo.txt',
      '/chat-backgrounds/files/',
      '/totally-unknown'
    ]) {
      const response = createResponse()
      await fixture.handlers.file(createRequest({ url }), response)
      assert.equal(response.statusCode, 404, `expected 404 for ${url}`)
    }
  } finally {
    await rm(fixture.directory, { recursive: true, force: true })
  }
})

test('file: a folder path with a trailing separator still serves files (BG-05)', async () => {
  const fixture = await createFixture()
  try {
    await mkdir(fixture.folder, { recursive: true })
    await writeFile(join(fixture.folder, 'photo.png'), 'image-bytes')
    const trimmed = createHandlers({
      folder: `${fixture.folder}${sep}`,
      tokenDirectory: fixture.tokenDirectory,
      logger,
      manifestCacheMs: 0,
      trustedHosts: new Set(['127.0.0.1'])
    })
    const response = createResponse()
    const finished = once(response, 'finish')
    await trimmed.file(createRequest({ url: '/chat-backgrounds/files/photo.png' }), response)
    await finished
    assert.equal(response.statusCode, 200)
  } finally {
    await rm(fixture.directory, { recursive: true, force: true })
  }
})

test('folder: only POST with the plugin header and a same-origin marker may spawn', async () => {
  const fixture = await createFixture()
  try {
    const get = createResponse()
    await fixture.handlers.revealFolder(createRequest({ method: 'GET', url: '/chat-backgrounds/folder' }), get)
    assert.equal(get.statusCode, 405)
    const post = createResponse()
    await fixture.handlers.revealFolder(createRequest({ method: 'POST', url: '/chat-backgrounds/folder' }), post)
    assert.equal(post.statusCode, 403)
    const crossSite = createResponse()
    await fixture.handlers.revealFolder(
      createRequest({
        method: 'POST',
        url: '/chat-backgrounds/folder',
        headers: { 'x-dsh-chat-background': '1', 'sec-fetch-site': 'cross-site' }
      }),
      crossSite
    )
    assert.equal(crossSite.statusCode, 403)
  } finally {
    await rm(fixture.directory, { recursive: true, force: true })
  }
})

test('tokenTotal: reports zero with missing flag when the cache is absent', async () => {
  const fixture = await createFixture()
  try {
    const response = createResponse()
    await fixture.handlers.tokenTotal(createRequest({ url: '/chat-backgrounds/token-total' }), response)
    assert.equal(response.statusCode, 200)
    const payload = JSON.parse(response.body)
    assert.equal(payload.total, 0)
    assert.equal(payload.missing, true)
    assert.equal(payload.source, 'none')
  } finally {
    await rm(fixture.directory, { recursive: true, force: true })
  }
})

test('tokenTotal: uses the injected provider and caches its payload', async () => {
  let calls = 0
  const payload = { total: 42, sessions: 1, countedSessions: 1, source: 'services' }
  const fixture = await createFixture({
    tokenCacheMs: 60_000,
    tokenProvider: async () => {
      calls += 1
      return payload
    }
  })
  try {
    const first = createResponse()
    await fixture.handlers.tokenTotal(createRequest({ url: '/chat-backgrounds/token-total' }), first)
    assert.equal(JSON.parse(first.body).total, 42)
    const cached = createResponse()
    await fixture.handlers.tokenTotal(createRequest({ url: '/chat-backgrounds/token-total' }), cached)
    assert.equal(JSON.parse(cached.body).total, 42)
    assert.equal(calls, 1, 'the provider must be called once per cache window')
  } finally {
    await rm(fixture.directory, { recursive: true, force: true })
  }
})

test('every response carries the baseline security headers', async () => {
  const fixture = await createFixture()
  try {
    const list = createResponse()
    await fixture.handlers.list(createRequest({ url: '/chat-backgrounds/list' }), list)
    assert.equal(list.headers['x-content-type-options'], 'nosniff')
    assert.equal(list.headers['referrer-policy'], 'no-referrer')
    const forbidden = createResponse()
    await fixture.handlers.list(
      createRequest({ url: '/chat-backgrounds/list', headers: { host: 'attacker.test' } }),
      forbidden
    )
    assert.equal(forbidden.headers['x-content-type-options'], 'nosniff')
  } finally {
    await rm(fixture.directory, { recursive: true, force: true })
  }
})

test('health: reports ok, version and the request fence state', async () => {
  const fixture = await createFixture()
  try {
    const response = createResponse()
    await fixture.handlers.health(createRequest({ url: '/chat-backgrounds/health' }), response)
    assert.equal(response.statusCode, 200)
    const payload = JSON.parse(response.body)
    assert.equal(payload.ok, true)
    assert.equal(payload.fence, 'on')
    assert.ok(payload.limits.maxImageBytes > 0)
    const foreign = createResponse()
    await fixture.handlers.health(
      createRequest({ url: '/chat-backgrounds/health', headers: { host: 'attacker.test' } }),
      foreign
    )
    assert.equal(foreign.statusCode, 403)
  } finally {
    await rm(fixture.directory, { recursive: true, force: true })
  }
})
