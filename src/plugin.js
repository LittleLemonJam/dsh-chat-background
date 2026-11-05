/**
 * Browser-half entry point: binds React, creates the settings instances,
 * applies the durable state and wires every slot and effect the shell owns.
 */
import {
  applyBackground,
  flattenScrimTheme,
  flushBackground,
  installRightbarGestures,
  invalidatePainters,
  teardownVisuals
} from './background.js'
import {
  LOCALE_NS,
  PROGRESS_DOCK_ORDER,
  PROGRESS_KEY,
  SCRIM_FOLLOW_THEME_KEY,
  SECTION_ID,
  SECTION_ORDER,
  STRIP_KEY,
  TOKEN_KEY,
  TOKEN_POLL_MS
} from './constants.js'
import { diagnosticsSnapshot } from './diagnostics.js'
import { installImageZoom } from './image-zoom.js'
import { en, installTranslator, zh } from './i18n.js'
import { ProgressDock } from './progress.js'
import { bindReact } from './react.js'
import { PageSection } from './rows.js'
import { installRotation } from './rotation.js'
import { installSettings } from './settings.js'
import {
  createProgressColorSetting,
  createStripColorSetting,
  createSwitch,
  disposeStorageCache,
  readSelection
} from './storage.js'
import { disconnectComposerSizing, renderComposerStrip } from './strip.js'
import { installStyles } from './styles.js'
import { applyTokenSize, refreshTokenTotal, renderTokenTotal, resetTokenTotal } from './token-total.js'

/**
 * Migrate the retired per-region switches once.
 *
 * A user who had turned a region scrim off expects no darkening; the old switch
 * stored `off` while the slider kept its number, so map that to a 0% scrim and
 * drop the retired keys. Failures are ignored: storage can be unavailable.
 */
function migrateLegacyPreferences() {
  try {
    const pairs = [
      ['dsh-chat-background:scrim-left-enabled', 'dsh-chat-background:scrim-left'],
      ['dsh-chat-background:scrim-main-enabled', 'dsh-chat-background:scrim-main'],
      ['dsh-chat-background:scrim-right-enabled', 'dsh-chat-background:scrim-right']
    ]
    for (const [enabledKey, amountKey] of pairs) {
      if (window.localStorage.getItem(enabledKey) === 'off' && window.localStorage.getItem(amountKey) === null) {
        window.localStorage.setItem(amountKey, '0')
      }
      window.localStorage.removeItem(enabledKey)
    }
    window.localStorage.removeItem('dsh-chat-background:sidebar')
  } catch {
    /* Storage is optional; the defaults still apply. */
  }
}

/**
 * Build the plugin object the module loader expects.
 * @param require - the loader's synchronous `require` for shared modules.
 * @returns the plugin descriptor (`inject` + `apply`).
 */
export function createPlugin(require) {
  bindReact(require)
  return {
    inject: ['slots', 'locale'],
    apply(ctx) {
      migrateLegacyPreferences()
      const switches = {
        strip: createSwitch({
          key: STRIP_KEY,
          onChange: () => {
            renderComposerStrip()
          }
        }),
        progress: createSwitch({ key: PROGRESS_KEY }),
        token: createSwitch({
          key: TOKEN_KEY,
          onChange: (next) => {
            if (next) void refreshTokenTotal()
            renderTokenTotal()
          }
        }),
        /* Opt-in: keep one scrim value per theme. Turning it off copies the
         * current theme's values back to the shared keys so the visible scrims
         * do not jump. */
        scrimTheme: createSwitch({
          key: SCRIM_FOLLOW_THEME_KEY,
          defaultEnabled: false,
          onChange: (next) => {
            if (!next) flattenScrimTheme()
            applyBackground(readSelection())
          }
        })
      }
      const colors = {
        strip: createStripColorSetting(),
        progress: createProgressColorSetting()
      }
      ctx.effect(() => installImageZoom(), 'chat-background: image wheel zoom')
      ctx.effect(() => installRightbarGestures(), 'chat-background: rightbar gestures')
      ctx.effect(() => installRotation(), 'chat-background: background rotation')
      installSettings({ switches, colors })
      /* Read-only diagnostics for issue reports: `window.__dshcb.diagnostics()`
       * returns what each feature/anchor decided, without logging or network
       * side effects (`R2 F9`). */
      globalThis.__dshcb = { diagnostics: () => diagnosticsSnapshot() }

      ctx.effect(installStyles, 'chat-background: stylesheet')
      /* Apply the durable selection and every stored colour as soon as the
       * plugin mounts; the tables below then only ever read them back. */
      applyBackground(readSelection())
      colors.strip.apply()
      colors.progress.apply()
      applyTokenSize()
      renderTokenTotal()
      /* Disposal removes every document-level trace: marker attributes, inline
       * properties, injected nodes, measured rules, a pending flush and the
       * cross-window storage listener. */
      ctx.effect(
        () => () => {
          teardownVisuals()
          resetTokenTotal()
          disposeStorageCache()
          if (globalThis.__dshcb !== undefined) delete globalThis.__dshcb
        },
        'chat-background: document state'
      )

      /* A window resize moves the composer without a DOM mutation, and the
       * injected bar is placed in pixels, so it has to be re-measured; the
       * composer's own ResizeObserver is released with the plugin. */
      ctx.effect(() => {
        const onResize = () => {
          flushBackground()
        }
        window.addEventListener('resize', onResize)
        return () => {
          window.removeEventListener('resize', onResize)
          disconnectComposerSizing()
        }
      }, 'chat-background: viewport and composer re-measure')

      ctx.effect(() => {
        const observer = new MutationObserver((records) => {
          /* The colour scheme decides the scrim, a new subtree can add a
           * container that paints the base surface, and the settings surface
           * toggles the menu marker. All are handled by the same deferred
           * re-apply. */
          for (const record of records) {
            if (record.type === 'attributes') {
              if (record.attributeName === 'data-ds-dark-theme') {
                flushBackground()
                return
              }
              continue
            }
            if (record.addedNodes.length > 0 || record.removedNodes.length > 0) {
              flushBackground()
              return
            }
          }
        })
        const observe = () => {
          observer.observe(document.body, {
            attributes: true,
            attributeFilter: ['data-ds-dark-theme'],
            childList: true,
            subtree: true
          })
        }
        if (document.body === null) document.addEventListener('DOMContentLoaded', observe, { once: true })
        else observe()
        /* The Windows desktop preload marks the titlebar frame on <html>, which
         * gives the center column an opaque base surface; that marker can land
         * after the first measurement (or be re-applied around a window
         * restore), so a marker change re-measures the layout. */
        const rootObserver = new MutationObserver(() => {
          invalidatePainters()
        })
        rootObserver.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ['data-windows-titlebar', 'data-platform']
        })
        /* A rebuilt renderer or a restored/occluded window can replace the
         * frame columns without changing the slot count; re-measure when the
         * document becomes visible again. */
        const onFocus = () => {
          invalidatePainters()
        }
        const onVisibility = () => {
          if (!document.hidden) invalidatePainters()
        }
        window.addEventListener('focus', onFocus)
        document.addEventListener('visibilitychange', onVisibility)
        return () => {
          observer.disconnect()
          rootObserver.disconnect()
          window.removeEventListener('focus', onFocus)
          document.removeEventListener('visibilitychange', onVisibility)
        }
      }, 'chat-background: DOM, scheme and switch follow-up')

      /* The copy dictionaries are owned by the client locale service; the bound
       * translator is what every row reads, the service's own subscription
       * drives language re-renders, and the section label is resolved per render
       * so the shell can follow the active language (`BG-20`). */
      ctx.effect(() => ctx.locale.register(LOCALE_NS, { zh, en }), 'chat-background: settings dictionaries')
      const t = ctx.locale.bind(LOCALE_NS)
      installTranslator({
        translate: t,
        subscribe: typeof ctx.locale.subscribe === 'function' ? (listener) => ctx.locale.subscribe(listener) : null
      })
      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          {
            name: 'settings.section',
            id: SECTION_ID,
            order: SECTION_ORDER,
            label: () => t('nav'),
            locale: LOCALE_NS
          },
          PageSection
        )
      )
      /* The progress bar lives in the composer's own dock, not in this plugin's
       * settings page: a full-width entry above the composer card. */
      ctx.slots.inject('conversation.input.dock', () =>
        ctx.slots.register(
          {
            name: 'conversation.input.dock',
            id: 'chat-background-progress',
            order: PROGRESS_DOCK_ORDER
          },
          ProgressDock
        )
      )
      /* The total-token line polls the host aggregation; the first answer lands
       * as soon as it arrives. */
      ctx.effect(() => {
        let timer = 0
        const tick = () => {
          if (switches.token.read()) void refreshTokenTotal()
        }
        tick()
        timer = window.setInterval(tick, TOKEN_POLL_MS)
        return () => {
          window.clearInterval(timer)
        }
      }, 'chat-background: token total polling')
    }
  }
}
