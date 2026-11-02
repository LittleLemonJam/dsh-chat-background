/**
 * Read-only diagnostics for this plugin.
 *
 * The plugin degrades gracefully when a host anchor or route changes, which
 * means a broken install can look like "the feature was never enabled". This
 * module keeps a small snapshot of the decisions each feature made so a user can
 * answer "what is actually happening" from DevTools instead of guessing
 * (`window.__dshcb.diagnostics()`), and so an issue can include one object
 * (`R2 F9`).
 *
 * It never logs, never touches the network and never mutates host state.
 */

/** @type {Record<string, unknown>} */
let state = { startedAt: Date.now() }

/**
 * Merge one feature's current state into the snapshot.
 * @param patch - top-level keys such as `background`, `strip`, `token`, `list`.
 */
export function recordDiagnostics(patch) {
  state = { ...state, ...patch }
}

/**
 * The current diagnostic snapshot.
 * @returns a JSON-serialisable object with the bundle version and feature state.
 */
export function diagnosticsSnapshot() {
  return {
    version: typeof __PACKAGE_VERSION__ === 'string' ? __PACKAGE_VERSION__ : 'unknown',
    updatedAt: Date.now(),
    ...state
  }
}
