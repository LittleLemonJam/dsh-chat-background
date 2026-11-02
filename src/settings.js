/**
 * The plugin's late-bound settings instances.
 *
 * `plugin.js` creates the real switches and colour settings during `apply()` and
 * installs them here, so the feature modules can read them while storage side
 * effects stay out of module import time (which also keeps these modules
 * importable by the unit tests).
 */

/** @type {{ switches: Record<string, any>, colors: Record<string, any> } | null} */
let installed = null

/**
 * Record the instances created by the plugin entry.
 * @param value - created switches and colour settings.
 */
export function installSettings(value) {
  installed = value
}

/**
 * The installed settings. Only call this after `apply()` started; every caller
 * is a component or effect that the shell mounts afterwards.
 * @returns the created switches and colour settings.
 */
export function settings() {
  if (installed === null) throw new Error('dsh-chat-background: settings were read before the plugin applied')
  return installed
}
