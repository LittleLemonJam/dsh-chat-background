/**
 * Directory resolution for the host half.
 *
 * Both paths honour an environment override so tests and alternative profiles
 * can point the plugin at a disposable folder. `DSH_HOME` mirrors the harness
 * home; `backgroundsDir` additionally accepts `DSH_BACKGROUNDS_DIR`.
 *
 * Overrides are normalised with `resolve`, so a value copied from a file manager
 * with a trailing separator (`...\backgrounds\`) still compares equal to the
 * joined child paths further down (`BG-05`). A leading `~` / `~\` is expanded
 * like the host's own home-path resolver does, because users copy such values
 * from the DSH documentation (`R2 F8`).
 */
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * Expand a leading `~` or `~\`/`~/` to the user's home directory.
 * @param value - raw environment value.
 * @returns the expanded path.
 */
export function expandHomePath(value) {
  const trimmed = value.trim()
  if (trimmed === '~') return homedir()
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) return join(homedir(), trimmed.slice(2))
  return trimmed
}

/** The harness home directory: `DSH_HOME` when set, else `~/.dsh`. */
export function dshHomeDir() {
  const home = process.env.DSH_HOME
  return home !== undefined && home.trim() !== '' ? resolve(expandHomePath(home)) : join(homedir(), '.dsh')
}

/**
 * The background image folder: `DSH_BACKGROUNDS_DIR` when set, else
 * `<dsh home>/backgrounds`.
 */
export function backgroundsDir() {
  const override = process.env.DSH_BACKGROUNDS_DIR
  if (override !== undefined && override.trim() !== '') return resolve(expandHomePath(override))
  return join(dshHomeDir(), 'backgrounds')
}
