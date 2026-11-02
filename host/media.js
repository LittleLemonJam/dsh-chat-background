/**
 * Background image discovery: which files count as images, how one file name is
 * validated, and how the folder is listed.
 *
 * The manifest is also the access-control list for the `files` route (`SEC-04`):
 * a name that is not listed is not served, so Windows 8.3 short names, hidden
 * files and arbitrary case variants of unlisted files cannot be used to fetch
 * bytes that the settings page never offered.
 */
import { lstat, readdir, realpath, stat } from 'node:fs/promises'
import { basename, extname, isAbsolute, join, relative } from 'node:path'
import { MAX_MANIFEST_ENTRIES, MAX_MANIFEST_SCAN } from './constants.js'

/** Extensions accepted as background images, mapped to their media type. */
export const MEDIA_TYPES = new Map([
  ['.png', 'image/png'],
  ['.apng', 'image/apng'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
  ['.avif', 'image/avif'],
  ['.bmp', 'image/bmp'],
  ['.svg', 'image/svg+xml']
])

/** The accepted extension list, for display in the settings row. */
export const ACCEPTED_EXTENSIONS = [...MEDIA_TYPES.keys()].join(', ')

/**
 * Media type of one file name, or `application/octet-stream` when unknown.
 * @param name - file name.
 * @returns the media type header value.
 */
export function mediaTypeFor(name) {
  return MEDIA_TYPES.get(extname(name).toLowerCase()) ?? 'application/octet-stream'
}

/**
 * Validate one user-supplied image name.
 *
 * The value arrives from a URL and becomes a path segment; it is accepted only
 * when it is a plain single-segment file name of an accepted image type. A
 * dot-leading name is rejected so the folder's hidden files never surface.
 * @param value - candidate file name.
 * @returns the name when safe, otherwise undefined.
 */
export function safeImageName(value) {
  if (typeof value !== 'string' || value === '' || value.length > 200) return undefined
  if (value !== basename(value)) return undefined
  if (value.includes('/') || value.includes('\\') || value.includes('\0')) return undefined
  if (value.startsWith('.')) return undefined
  if (!MEDIA_TYPES.has(extname(value).toLowerCase())) return undefined
  return value
}

/**
 * Whether `candidate` resolves inside `root`. Both paths must be absolute.
 * @param root - absolute directory path.
 * @param candidate - absolute path.
 */
function isInside(root, candidate) {
  const relation = relative(root, candidate)
  return relation !== '' && !relation.startsWith('..') && !isAbsolute(relation)
}

/**
 * List the folder's images, newest first.
 *
 * Symbolic links that point outside the folder are skipped, so a link dropped
 * into the folder cannot turn this route into an arbitrary-file reader
 * (`SEC-05`). Scanning and result size are bounded (`SEC-08`).
 * @param directory - absolute folder path.
 * @returns image entries with their stable revision and a truncation flag.
 */
export async function readImageManifestDetailed(directory) {
  let names
  try {
    names = await readdir(directory)
  } catch (error) {
    if (error?.code === 'ENOENT') return { entries: [], truncated: false }
    throw error
  }
  let root
  try {
    root = await realpath(directory)
  } catch {
    return { entries: [], truncated: false }
  }
  const entries = []
  let scanned = 0
  for (const name of names) {
    if (scanned >= MAX_MANIFEST_SCAN) break
    scanned += 1
    if (safeImageName(name) === undefined) continue
    const path = join(directory, name)
    let linkInfo
    try {
      linkInfo = await lstat(path)
    } catch {
      continue
    }
    if (linkInfo.isSymbolicLink()) {
      /* A link is acceptable only when its target stays inside the folder. */
      try {
        if (!isInside(root, await realpath(path))) continue
      } catch {
        continue
      }
    }
    let info
    try {
      info = await stat(path)
    } catch {
      continue
    }
    if (!info.isFile()) continue
    entries.push({
      name,
      bytes: info.size,
      mtimeMs: Math.floor(info.mtimeMs),
      rev: `${info.size.toString(36)}-${Math.floor(info.mtimeMs).toString(36)}`
    })
  }
  entries.sort((left, right) => right.mtimeMs - left.mtimeMs || left.name.localeCompare(right.name))
  const truncated = entries.length > MAX_MANIFEST_ENTRIES || scanned >= MAX_MANIFEST_SCAN
  return { entries: entries.slice(0, MAX_MANIFEST_ENTRIES), truncated }
}

/**
 * List the folder images without truncation metadata. Kept for callers and
 * tests that only need the entries.
 * @param directory - absolute folder path.
 * @returns the image entries.
 */
export async function readImageManifest(directory) {
  return (await readImageManifestDetailed(directory)).entries
}

/**
 * Find the actual manifest entry for a requested file name. Windows and macOS
 * file systems are case-insensitive, so an exact match is preferred and a
 * case-insensitive one is accepted; anything else is not served.
 * @param entries - the current manifest.
 * @param name - validated request name.
 * @returns the manifest entry, or undefined when the name is not listed.
 */
export function findManifestEntry(entries, name) {
  const exact = entries.find((entry) => entry.name === name)
  if (exact !== undefined) return exact
  const lowered = name.toLowerCase()
  return entries.find((entry) => entry.name.toLowerCase() === lowered)
}
