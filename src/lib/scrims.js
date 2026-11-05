/**
 * Pure helpers for the theme-scoped scrim values.
 *
 * The scrim sliders can either share one value across both themes (the default)
 * or keep a separate value per theme. The stored key for the separated case is
 * the base key plus `:light`/`:dark`; this module owns that naming so the
 * background reader, the rows and the unit tests agree on it.
 */

/**
 * The storage key holding one scrim's value for one theme.
 * @param baseKey - the unscoped storage key, e.g. `dsh-chat-background:scrim-left`.
 * @param dark - whether the dark theme value is wanted.
 * @returns the theme-scoped key.
 */
export function scrimThemeKey(baseKey, dark) {
  return `${baseKey}${dark ? ':dark' : ':light'}`
}

/**
 * Whether a stored follow-theme switch value means "on". The switch is opt-in,
 * so only an explicit `on` enables it.
 * @param raw - the raw localStorage value, or null.
 * @returns whether the separated theme values are in use.
 */
export function followThemeFromStorage(raw) {
  return raw === 'on'
}
