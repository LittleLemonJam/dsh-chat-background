/**
 * Browser-half bundle entry.
 *
 * The DSH client module loader expects one `client.js` per package that calls
 * `window.__ModuleLoader__.load({ id, factory })`; the factory receives the
 * shell's synchronous `require` and returns the plugin descriptor.
 *
 * `__PACKAGE_NAME__` is replaced at build time by `scripts/build.mjs` with the
 * name from `package.json`, so the loader row and the registered module id can
 * never disagree.
 */
import { createPlugin } from './plugin.js'

window.__ModuleLoader__.load({
  id: __PACKAGE_NAME__,
  factory(require) {
    return createPlugin(require)
  }
})
