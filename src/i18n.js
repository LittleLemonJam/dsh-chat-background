/**
 * Bilingual copy for the settings rows and the injected lines.
 *
 * The dictionaries are the source of truth: `plugin.js` registers both into the
 * client locale service and installs the service's bound translator here, so
 * visible text is routed through the official locale path (`BG-20`). A language
 * change re-renders mounted rows through one shared `MutationObserver` on
 * `html[lang]`; a build without the locale service falls back to the local
 * dictionaries (which is also what the unit tests exercise).
 */
import { useEffect, useState } from './react.js'

/** Chinese copy. Keys must match `en` exactly (checked by `scripts/check.mjs`). */
export const zh = {
  none: '无（纯色背景）',
  choose: '选择图片',
  open: '打开文件夹',
  refresh: '重新扫描',
  emptyBefore: '文件夹还是空的，把图片放进 ',
  emptyAfter: ' 后点「重新扫描」',
  loading: '读取中…',
  failed: '读取背景文件夹失败',
  openFailed: '打开文件夹失败',
  truncated: '图片太多，只显示最近的 {shown} 张',
  scrimLeftTitle: '左侧栏遮罩层',
  scrimMainTitle: '主窗口遮罩层',
  scrimRightTitle: '右侧栏遮罩层',
  stripTitle: '输入栏下方背景条',
  stripDescription: '在输入栏下方加一条与输入栏等长的背景条，把下面那排用量数据包起来（仅在有背景图时显示）',
  stripColorTitle: '背景条颜色',
  stripColorDescription: '这条背景条的底色；点色块打开调色盘，也可以恢复默认',
  reset: '恢复默认',
  progressTitle: '任务进度条',
  progressDescription: '显示当前任务的完成进度：有任务清单时按清单完成度，否则按本轮已完成的步骤粗略估算；空闲时隐藏',
  progressRunning: '正在执行…',
  progressRunningHint: '粗略估算：本轮已完成 {steps} 步',
  progressColorTitle: '进度条颜色',
  progressColorDescription: '进度条填充色；点色块打开调色盘，也可以恢复默认',
  tokenTitle: 'Token 总用量',
  tokenDescription: '在左下角用户标上方显示所有会话（含已归档）的 token 总用量',
  tokenLabel: 'Token总用量：',
  tokenHint: '全部会话累计：{exact} token（含缓存读取；{sessions}/{all} 个会话有用量）',
  tokenSizeTitle: 'Token 字号',
  tokenSizeDescription: '这一行的字号，10–20 px',
  modeTitle: '背景显示方式',
  modeFixed: '固定背景',
  modeRotation: '轮换背景',
  rotationEffectTitle: '轮换设置',
  effectType: '特效方式',
  effectFade: '淡入淡出',
  effectFadeThrough: '渐变过渡',
  effectNone: '无特效',
  effectDuration: '切换时长',
  rotationInterval: '轮换间隔',
  rotationGroupTitle: '轮换分组',
  rotationGroupAll: '全选',
  rotationGroupNone: '清空',
  rotationGroupEmpty: '背景库为空',
  dragHandle: '拖动排序',
  nav: '页面设置',
  tabBackground: '背景',
  tabUi: 'UI',
  percent: '%'
}

/** English copy; same keys as `zh`. */
export const en = {
  none: 'None (plain background)',
  choose: 'Choose image',
  open: 'Open folder',
  refresh: 'Rescan',
  emptyBefore: 'The folder is empty — put images in ',
  emptyAfter: ' and press Rescan',
  loading: 'Loading…',
  failed: 'Could not read the background folder',
  openFailed: 'Could not open the folder',
  truncated: 'Too many images; showing the most recent {shown}',
  scrimLeftTitle: 'Left sidebar scrim layer',
  scrimMainTitle: 'Main window scrim layer',
  scrimRightTitle: 'Right sidebar scrim layer',
  stripTitle: 'Bar under the input',
  stripDescription:
    'Adds a bar as wide as the input, wrapping the usage row below it (shown while a background image is set)',
  stripColorTitle: 'Bar colour',
  stripColorDescription: 'Fill of that bar; click the swatch for a colour picker, or reset it',
  reset: 'Reset',
  progressTitle: 'Task progress bar',
  progressDescription:
    'Shows how far the current task has come: the todo list when the agent keeps one, otherwise a rough estimate from the steps this turn has taken; hidden while idle',
  progressRunning: 'Working…',
  progressRunningHint: 'Rough estimate: {steps} steps taken this turn',
  progressColorTitle: 'Progress colour',
  progressColorDescription: 'Fill of the progress bar; click the swatch to open a colour picker, or reset it',
  tokenTitle: 'Total token usage',
  tokenDescription: 'Shows the token total of every session (archived included) above the account row',
  tokenLabel: 'Total tokens: ',
  tokenHint: 'All sessions: {exact} tokens (cache reads included; {sessions}/{all} sessions carry usage)',
  tokenSizeTitle: 'Token font size',
  tokenSizeDescription: 'Font size of that line, 10–20 px',
  modeTitle: 'Background display',
  modeFixed: 'Fixed image',
  modeRotation: 'Rotate images',
  rotationEffectTitle: 'Rotation settings',
  effectType: 'Effect',
  effectFade: 'Fade',
  effectFadeThrough: 'Fade through',
  effectNone: 'None',
  effectDuration: 'Duration',
  rotationInterval: 'Interval',
  rotationGroupTitle: 'Rotation group',
  rotationGroupAll: 'Select all',
  rotationGroupNone: 'Clear',
  rotationGroupEmpty: 'The background library is empty',
  dragHandle: 'Drag to reorder',
  nav: 'Page settings',
  tabBackground: 'Background',
  tabUi: 'UI',
  percent: '%'
}

/**
 * The copy dictionary for the current UI language, resolved locally.
 * @returns `zh` or `en`.
 */
export function copyNow() {
  if (typeof document === 'undefined') return en
  const documentLanguage = (document.documentElement.lang || '').toLowerCase()
  const browserLanguage = (typeof navigator === 'undefined' ? '' : navigator.language || '').toLowerCase()
  if (documentLanguage.startsWith('zh')) return zh
  if (documentLanguage === '' && browserLanguage.startsWith('zh')) return zh
  return en
}

/** The locale service's bound translator and change subscription. */
let translate = null
/** @type {(() => void) | null} */
let unsubscribeLocale = null

/**
 * Route copy lookups and language-change notifications through the client
 * locale service. `subscribe` is the documented service hook; the DOM observer
 * below is only a fallback for a composition without it.
 * @param options - the service's bound translator and its `subscribe` method.
 */
export function installTranslator({ translate: boundTranslate, subscribe = null }) {
  translate = boundTranslate
  unsubscribeLocale = typeof subscribe === 'function' ? subscribe : null
}

/**
 * One copy value: the locale service first, the local dictionary as fallback.
 * A service that does not know the key echoes the key back; that must fall back
 * to the bundled dictionary instead of rendering a raw identifier (`R-13`).
 * @param key - dictionary key.
 * @returns the visible text.
 */
function copyValue(key) {
  if (translate !== null) {
    try {
      const text = translate(key)
      if (typeof text === 'string' && text !== '' && text !== key) return text
    } catch {
      /* A service without this namespace falls back to the local dictionary. */
    }
  }
  return copyNow()[key] ?? key
}

/**
 * Read-through view of the current copy; property access resolves per render.
 * It only supports property reads: do not spread it or enumerate its keys.
 */
const copyView = new Proxy(
  {},
  {
    get: (_target, key) => copyValue(String(key))
  }
)

/** Listeners re-render when the language changes; the observer serves all rows. */
const copyListeners = new Set()
/** @type {MutationObserver | null} */
let copyObserver = null

/** Fallback subscription used only when the locale service exposes none. */
function subscribeDomLanguage(listener) {
  if (typeof MutationObserver === 'undefined') return () => {}
  if (copyObserver === null) {
    copyObserver = new MutationObserver(() => {
      for (const entry of copyListeners) entry()
    })
    copyObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
  }
  copyListeners.add(listener)
  return () => {
    copyListeners.delete(listener)
    if (copyListeners.size === 0 && copyObserver !== null) {
      copyObserver.disconnect()
      copyObserver = null
    }
  }
}

/**
 * Re-render the calling component when the UI language changes. The client
 * locale service owns the language; this only subscribes and re-renders.
 * @returns the current copy dictionary view.
 */
export function useCopy() {
  const [, forceRender] = useState(0)
  useEffect(() => {
    const listener = () => {
      forceRender((generation) => generation + 1)
    }
    const unsubscribe = unsubscribeLocale !== null ? unsubscribeLocale(listener) : subscribeDomLanguage(listener)
    return () => {
      unsubscribe()
    }
  }, [])
  return copyView
}
