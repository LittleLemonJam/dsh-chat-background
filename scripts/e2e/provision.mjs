#!/usr/bin/env node
/**
 * Provision a disposable DSH home and profile for the end-to-end suite.
 *
 * Nothing here touches the user's `~/.dsh`: the harness sets `DSH_HOME` to a
 * directory under `.tmp/`, writes a profile that loads only `dsh-base`,
 * `dsh-web-app` and this plugin, and puts one generated background image in
 * `<home>/backgrounds/`.
 *
 * Usage (standalone):
 *   node scripts/e2e/provision.mjs [--keep]
 * Prints a JSON object with the generated paths.
 */
import { cp, mkdir, rm, writeFile } from 'node:fs/promises'
import { deflateSync } from 'node:zlib'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Profile name the end-to-end instance boots. */
export const PROFILE_NAME = 'e2e'

/** Image the suites seed as the selected background. */
export const SAMPLE_BACKGROUND = 'sample-background.png'

/** A two-frame 64×64 GIF used by the animated-background test. */
const ANIMATED_GIF_BASE64 =
  'R0lGODlhQABAAIEAAPrweNwoUAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQAFAAAACwAAAAAQABAAAAIsgADCBxIsKDBgwgTKlzIsKHDhxAjSpxIsaLFixgzatzIsaPHjyBDihxJsqTJkyhTqlzJsmVBADBjypxJs+bMjzZz6qSJc6fPnD1/CpUZdOjQokZ/Ik26cylToB6fCnUqlWfUqk2vYoXacatOql4BgPU6dmtZrGerppW69mlbpm+TxjU696jWsDfv4o1Zd6revWL/7u2rVDBewj4RZ3XJuLHjx5AjS55MubLly5gza95MOSAAIfkEARQAAgAsAAAAAEAAQACB+vB4KKDcAAAAAAAACLIAAwgcSLCgwYMIEypcyLChw4cQI0qcSLGixYsYM2rcyLGjx48gQ4ocSbKkyZMoU6pcybJlQQEwY8qcSbPmzI82c+qkiXOnz5w9fwqVGXTo0KJGfyJNunMpU6Aenwp1KpVn1KpNr2KF2nGrTqpeBYD1OnZrWaxnq6aVuvZpW6Zvk8Y1Oveo1rA37+KNWXeq3r1i/+7tq1QwXsI+EWd1ybix48eQI0ueTLmy5cuYM2veTDkgADs='

/** Package entries needed at runtime; mirrors the `files` field of package.json. */
const PACKAGE_ENTRIES = ['index.js', 'host', 'client.js', 'cordis.patch.yml', 'locale', 'icon.svg', 'package.json']

/** CRC32 table for the small PNG encoder below. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    table[index] = value >>> 0
  }
  return table
})()

/**
 * CRC32 of one buffer.
 * @param {Buffer} buffer
 * @returns {number}
 */
function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/**
 * Build a valid vertical-gradient PNG without any image library.
 * @param {number} width
 * @param {number} height
 * @param {[number, number, number]} from - top colour.
 * @param {[number, number, number]} to - bottom colour.
 * @returns {Buffer}
 */
function createGradientPng(width, height, from, to) {
  const chunk = (type, payload) => {
    const head = Buffer.alloc(8)
    head.writeUInt32BE(payload.length, 0)
    head.write(type, 4, 'ascii')
    const tail = Buffer.alloc(4)
    tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), payload])), 0)
    return Buffer.concat([head, payload, tail])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // RGBA
  const rows = []
  for (let y = 0; y < height; y += 1) {
    const ratio = height === 1 ? 0 : y / (height - 1)
    const row = Buffer.alloc(1 + width * 4)
    const colour = from.map((channel, index) => Math.round(channel + (to[index] - channel) * ratio))
    for (let x = 0; x < width; x += 1) row.set([...colour, 255], 1 + x * 4)
    rows.push(row)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/**
 * Copy the runtime files of this package into a profile's node_modules.
 * @param {string} target - `<profile>/node_modules/dsh-chat-background`
 */
async function copyPackage(target) {
  await mkdir(target, { recursive: true })
  for (const entry of PACKAGE_ENTRIES) {
    await cp(join(ROOT, entry), join(target, entry), { recursive: true })
  }
}

/**
 * Create the disposable home, profile, plugin copy and sample background.
 * @param {{ home?: string }} [options] - `home` overrides the default location.
 * @returns the generated paths.
 */
export async function provision(options = {}) {
  const home = options.home ?? join(ROOT, '.tmp', 'e2e-home')
  await rm(home, { recursive: true, force: true })
  const profileDir = join(home, 'profiles', PROFILE_NAME)
  await mkdir(join(profileDir, 'node_modules'), { recursive: true })

  await writeFile(
    join(profileDir, 'package.json'),
    `${JSON.stringify(
      {
        name: 'dsh-profile-e2e',
        private: true,
        dependencies: {},
        dsh: {
          profile: {
            bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-chat-background']
          }
        }
      },
      null,
      2
    )}\n`
  )
  await writeFile(join(profileDir, 'cordis.yml'), '[]\n')
  await writeFile(
    join(profileDir, 'pnpm-workspace.yaml'),
    'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n'
  )
  await writeFile(
    join(profileDir, 'cordis.patch.yml'),
    ['- insert:', '    - id: chat-background', "      name: 'dsh-chat-background'", ''].join('\n')
  )
  await copyPackage(join(profileDir, 'node_modules', 'dsh-chat-background'))

  const backgrounds = join(home, 'backgrounds')
  await mkdir(backgrounds, { recursive: true })
  await writeFile(join(backgrounds, SAMPLE_BACKGROUND), createGradientPng(640, 400, [110, 168, 254], [43, 78, 168]))
  await writeFile(join(backgrounds, 'sample-animation.gif'), Buffer.from(ANIMATED_GIF_BASE64, 'base64'))
  /* Extra images give the rotation suite a real group to choose from. */
  await writeFile(
    join(backgrounds, 'sample-background-2.png'),
    createGradientPng(640, 400, [255, 196, 120], [214, 91, 91])
  )
  await writeFile(
    join(backgrounds, 'sample-background-3.png'),
    createGradientPng(640, 400, [126, 220, 170], [34, 105, 86])
  )
  await writeFile(
    join(backgrounds, 'sample-background-4.png'),
    createGradientPng(640, 400, [180, 170, 255], [86, 64, 160])
  )
  await writeFile(
    join(backgrounds, 'sample-background-5.png'),
    createGradientPng(640, 400, [255, 230, 150], [200, 150, 60])
  )
  await writeFile(
    join(backgrounds, 'sample-background-6.png'),
    createGradientPng(640, 400, [150, 220, 255], [40, 110, 160])
  )
  /* A non-image file next to it proves the manifest filter runs on real disk. */
  await writeFile(join(backgrounds, 'notes.txt'), 'not an image\n')
  /* An SVG tries to run script if the file route is ever served unsandboxed
   * (`SEC-01`); the security suite navigates to it and asserts nothing ran. */
  await writeFile(
    join(backgrounds, 'probe.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">' +
      '<script>document.documentElement.setAttribute("data-svg-script-ran","yes")</script>' +
      '<rect width="64" height="64" fill="#3366ff"/></svg>\n'
  )

  return { home, profileDir, backgrounds, sample: SAMPLE_BACKGROUND, probe: 'probe.svg' }
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (isMain) {
  /* Standalone runs are for inspection: provision the standard location and
   * print every generated path so the caller can boot an instance by hand. */
  const result = await provision({ home: join(ROOT, '.tmp', 'e2e-home') })
  console.log(JSON.stringify(result, null, 2))
}
