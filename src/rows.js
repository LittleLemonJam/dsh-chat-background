/**
 * The rows of the plugin's own settings section (设置 → 页面设置).
 *
 * Every row shares one visual shell; the three interactive controls — switch,
 * colour well and slider — are generalised so the ten rows stay identical in
 * markup and behaviour. Class names use the `dshcb-` prefix (see `styles.js`).
 */
import {
  FILE_URL,
  FOLDER_HEADER,
  FOLDER_HEADER_VALUE,
  FOLDER_URL,
  LIST_URL,
  MODE_KEY,
  ROTATION_DURATION_KEY,
  ROTATION_DURATION_MAX,
  ROTATION_DURATION_MIN,
  ROTATION_EFFECT_KEY,
  ROTATION_EVENT,
  ROTATION_GROUP_KEY,
  ROTATION_ORDER_KEY,
  ROTATION_INTERVAL_KEY,
  ROTATION_INTERVAL_MAX,
  ROTATION_INTERVAL_MIN,
  SCRIM_DEFAULT,
  SCRIM_KEY,
  SCRIM_LEFT_KEY,
  SCRIM_MAIN_KEY,
  SCRIM_MAX,
  SCRIM_MIN,
  SCRIM_RIGHT_KEY,
  SELECTION_KEY,
  TOKEN_SIZE_DEFAULT,
  TOKEN_SIZE_KEY,
  TOKEN_SIZE_MAX,
  TOKEN_SIZE_MIN,
  VEIL_DEFAULT,
  VEIL_KEY,
  VEIL_MAX,
  VEIL_MIN
} from './constants.js'
import { applyBackground } from './background.js'
import { recordDiagnostics } from './diagnostics.js'
import { useCopy } from './i18n.js'
import { clampToRange } from './lib/clamp.js'
import { h, useEffect, useId, useLayoutEffect, useRef, useState } from './react.js'
import { settings } from './settings.js'
import { readPercent, readSelection, readString, writeString } from './storage.js'
import {
  readRotationDuration,
  readRotationEffect,
  readRotationGroup,
  readRotationInterval,
  readRotationMode,
  refreshRotation
} from './rotation.js'
import { moveRotationImage, normalizeRotationDuration, normalizeRotationInterval } from './lib/rotation.js'
import { applyTokenSize } from './token-total.js'

/**
 * The shared row shell: title and description on the left, controls on the
 * right. Rows never hand-roll this markup, so the section stays aligned.
 *
 * The title and description get generated ids, linked from the row group and
 * from the control container, so a screen reader reads the explanation with the
 * control (`BG-21`). `status` holds optional live notices under the description.
 * @param props - row copy, control nodes and an optional status node.
 */
export function Row({ title, description, children, disabled, status }) {
  const titleId = useId()
  const descriptionId = useId()
  const hasDescription = typeof description === 'string' && description !== ''
  return h(
    'div',
    {
      className: 'dshcb-row',
      'data-disabled': disabled ? '' : undefined,
      role: 'group',
      'aria-labelledby': titleId === '' ? undefined : titleId,
      'aria-describedby': hasDescription ? descriptionId : undefined
    },
    h(
      'div',
      { className: 'dshcb-text' },
      h('div', { className: 'dshcb-title', id: titleId === '' ? undefined : titleId }, title),
      hasDescription ? h('div', { className: 'dshcb-desc', id: descriptionId }, description) : null,
      status
    ),
    h('div', { className: 'dshcb-control', 'aria-describedby': hasDescription ? descriptionId : undefined }, children)
  )
}

/**
 * Image row: preview, image picker, rescan and "open folder".
 *
 * The error is stored as a dictionary key rather than as rendered text so a
 * language switch mid-error still renders the right copy (`BG-19`).
 */
export function BackgroundRow() {
  const copy = useCopy()
  const [images, setImages] = useState(null)
  const [folder, setFolder] = useState('')
  const [truncated, setTruncated] = useState(false)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [selection, setSelection] = useState(() => readSelection())

  /* A pending request must not touch state after the row unmounted (`BG-19`). */
  const alive = useRef(true)
  const request = useRef(null)

  const load = () => {
    request.current?.abort?.()
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    fetch(LIST_URL, { headers: { accept: 'application/json' }, signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('HTTP ' + String(response.status))
        return response.json()
      })
      .then((payload) => {
        if (!alive.current) return
        const list = Array.isArray(payload.images) ? payload.images : []
        setImages(list)
        setFolder(typeof payload.folder === 'string' ? payload.folder : '')
        setTruncated(payload.truncated === true)
        setError(null)
        recordDiagnostics({
          list: { status: 'ok', images: list.length, truncated: payload.truncated === true, at: Date.now() }
        })
      })
      .catch((failure) => {
        if (failure?.name === 'AbortError') return
        recordDiagnostics({ list: { status: 'error', error: String(failure), at: Date.now() } })
        if (alive.current) setError('failed')
      })
      .finally(() => {
        if (alive.current && request.current === controller) setBusy(false)
      })
  }

  useEffect(() => {
    alive.current = true
    load()
    const onRotated = (event) => {
      const name = event?.detail?.name
      if (typeof name === 'string') setSelection(name)
    }
    window.addEventListener(ROTATION_EVENT, onRotated)
    return () => {
      alive.current = false
      request.current?.abort?.()
      window.removeEventListener(ROTATION_EVENT, onRotated)
    }
  }, [])

  const choose = (name) => {
    const next = name === '' ? null : name
    writeString(SELECTION_KEY, next)
    setSelection(next)
    applyBackground(next)
  }

  const openFolder = () => {
    fetch(FOLDER_URL, {
      method: 'POST',
      headers: { [FOLDER_HEADER]: FOLDER_HEADER_VALUE }
    })
      .then((response) => {
        /* A 4xx/5xx response is a failed action, not a success (`BG-18`). */
        if (!response.ok) throw new Error('HTTP ' + String(response.status))
        if (alive.current) setError(null)
      })
      .catch(() => {
        if (alive.current) setError('openFailed')
      })
  }

  const current = images === null ? null : images.find((image) => image.name === selection) || null
  const available = images === null ? [] : images
  const errorText = error === null ? null : copy[error]
  const notices = []
  if (errorText !== null) notices.push(h('div', { key: 'error', className: 'dshcb-error', role: 'alert' }, errorText))
  if (errorText === null && images === null) {
    notices.push(h('div', { key: 'loading', className: 'dshcb-notice' }, copy.loading))
  }
  if (errorText === null && images !== null && available.length === 0) {
    notices.push(
      h(
        'div',
        { key: 'empty', className: 'dshcb-notice' },
        copy.emptyBefore,
        h('code', null, folder === '' ? '~/.dsh/backgrounds' : folder),
        copy.emptyAfter
      )
    )
  }
  if (errorText === null && images !== null && truncated) {
    notices.push(
      h(
        'div',
        { key: 'truncated', className: 'dshcb-notice' },
        copy.truncated.replace('{shown}', String(available.length))
      )
    )
  }
  const status = notices.length === 0 ? null : h('div', { className: 'dshcb-status' }, notices)

  return h(
    'div',
    { className: 'dshcb-background-block' },
    h(
      'div',
      {
        className: 'dshcb-bg-preview',
        'aria-hidden': true,
        style:
          selection === null
            ? undefined
            : { backgroundImage: 'url("' + FILE_URL + encodeURIComponent(selection) + '")' }
      },
      selection === null ? h('span', { className: 'dshcb-bg-empty' }, copy.none) : null
    ),
    h(
      'div',
      { className: 'dshcb-bg-file' },
      h(
        'select',
        {
          className: 'dshcb-select dshcb-bg-select',
          value: selection === null ? '' : selection,
          disabled: busy,
          'aria-label': copy.choose,
          onChange: (event) => {
            choose(event.target.value)
          }
        },
        h('option', { value: '' }, copy.none),
        available.map((image) => h('option', { key: image.name, value: image.name }, image.name)),
        selection !== null && current === null
          ? h('option', { key: selection, value: selection }, selection + ' (missing)')
          : null
      ),
      h('button', { type: 'button', className: 'dshcb-button', onClick: openFolder }, copy.open),
      h('button', { type: 'button', className: 'dshcb-button', onClick: load, disabled: busy }, copy.refresh)
    ),
    status
  )
}

/**
 * Background display mode: one fixed image or an automatic rotation.
 */
export function ModeRow() {
  const copy = useCopy()
  const [mode, setMode] = useState(() => (readRotationMode() ? 'rotation' : 'fixed'))
  const change = (next) => {
    setMode(next)
    writeString(MODE_KEY, next)
    refreshRotation({ immediate: next === 'rotation' })
  }
  return h(
    Row,
    { title: copy.modeTitle },
    h(
      'div',
      { className: 'dshcb-rotation-controls' },
      h(
        'label',
        { className: 'dshcb-control-field' },
        h('span', { className: 'dshcb-control-caption' }, copy.modeTitle),
        h(
          'select',
          {
            className: 'dshcb-select',
            value: mode,
            'aria-label': copy.modeTitle,
            onChange: (event) => change(event.target.value)
          },
          h('option', { value: 'fixed' }, copy.modeFixed),
          h('option', { value: 'rotation' }, copy.modeRotation)
        )
      )
    )
  )
}

/**
 * Rotation effect, duration and interval. The two sliders share one row so the
 * group row can stay directly below, matching the requested layout.
 */
export function RotationEffectRow() {
  const copy = useCopy()
  const [effect, setEffect] = useState(() => readRotationEffect())
  const [duration, setDuration] = useState(() => readRotationDuration())
  const [interval, setIntervalValue] = useState(() => readRotationInterval())
  const changeEffect = (next) => {
    setEffect(next)
    writeString(ROTATION_EFFECT_KEY, next)
    refreshRotation()
  }
  const changeDuration = (next) => {
    const value = normalizeRotationDuration(next)
    setDuration(value)
    writeString(ROTATION_DURATION_KEY, String(value))
    refreshRotation()
  }
  const changeInterval = (next) => {
    const value = normalizeRotationInterval(next)
    setIntervalValue(value)
    writeString(ROTATION_INTERVAL_KEY, String(value))
    refreshRotation()
  }
  return h(
    Row,
    { title: copy.rotationEffectTitle },
    h(
      'div',
      { className: 'dshcb-rotation-controls' },
      h(
        'label',
        { className: 'dshcb-control-field' },
        h('span', { className: 'dshcb-control-caption' }, copy.effectType),
        h(
          'select',
          {
            className: 'dshcb-select',
            value: effect,
            'aria-label': copy.effectType,
            onChange: (event) => changeEffect(event.target.value)
          },
          h('option', { value: 'fade' }, copy.effectFade),
          h('option', { value: 'fade-through' }, copy.effectFadeThrough),
          h('option', { value: 'none' }, copy.effectNone)
        )
      ),
      h(
        'label',
        { className: 'dshcb-control-field' },
        h('span', { className: 'dshcb-control-caption' }, copy.effectDuration),
        h('input', {
          type: 'range',
          className: 'dshcb-range',
          min: String(ROTATION_DURATION_MIN),
          max: String(ROTATION_DURATION_MAX),
          step: '0.1',
          value: String(duration),
          'aria-label': copy.effectDuration,
          onChange: (event) => changeDuration(event.target.value)
        }),
        h('span', { className: 'dshcb-value' }, duration.toFixed(1) + 's')
      ),
      h(
        'label',
        { className: 'dshcb-control-field' },
        h('span', { className: 'dshcb-control-caption' }, copy.rotationInterval),
        h('input', {
          type: 'range',
          className: 'dshcb-range',
          min: String(ROTATION_INTERVAL_MIN),
          max: String(ROTATION_INTERVAL_MAX),
          step: '5',
          value: String(interval),
          'aria-label': copy.rotationInterval,
          onChange: (event) => changeInterval(event.target.value)
        }),
        h('span', { className: 'dshcb-value' }, String(interval) + 's')
      )
    )
  )
}

/**
 * Library checkboxes limiting which images the rotation may use.
 */
export function RotationGroupRow() {
  const copy = useCopy()
  const [images, setImages] = useState(null)
  const [selected, setSelected] = useState(() => readRotationGroup())
  const [order, setOrder] = useState(() => {
    const raw = readString(ROTATION_ORDER_KEY)
    if (raw === null) return []
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed.filter((value) => typeof value === 'string') : []
    } catch {
      return []
    }
  })
  const [dragging, setDragging] = useState(null)
  const alive = useRef(true)
  const listRef = useRef(null)
  const flipFrom = useRef(null)
  useEffect(() => {
    alive.current = true
    const controller = new AbortController()
    fetch(LIST_URL, { headers: { accept: 'application/json' }, signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('HTTP ' + String(response.status))
        return response.json()
      })
      .then((payload) => {
        if (!alive.current) return
        const names = Array.isArray(payload.images) ? payload.images.map((image) => image.name) : []
        setImages(names)
        setOrder((current) => {
          const saved = current.filter((name) => names.includes(name))
          return [...saved, ...names.filter((name) => !saved.includes(name))]
        })
        setSelected((current) => current.filter((name) => names.includes(name)))
      })
      .catch(() => {
        if (alive.current) setImages([])
      })
    return () => {
      alive.current = false
      controller.abort()
    }
  }, [])
  const writeSelected = (next) => {
    setSelected(next)
    writeString(ROTATION_GROUP_KEY, JSON.stringify(order.filter((name) => next.includes(name))))
    refreshRotation({ immediate: true })
  }

  const writeOrder = (next) => {
    const list = listRef.current
    if (list !== null) {
      const rects = new Map()
      for (const item of list.querySelectorAll('.dshcb-group-item')) {
        rects.set(item.getAttribute('data-name'), item.getBoundingClientRect())
      }
      flipFrom.current = rects
    }
    setOrder(next)
    writeString(ROTATION_ORDER_KEY, JSON.stringify(next))
    writeString(ROTATION_GROUP_KEY, JSON.stringify(next.filter((name) => selected.includes(name))))
    refreshRotation({ immediate: true })
  }

  /* FLIP: animate every row from its previous position to its new one, so
   * dropping a dragged image does not snap the list (`R25-01`). */
  useLayoutEffect(() => {
    const previous = flipFrom.current
    flipFrom.current = null
    const list = listRef.current
    if (previous === null || list === null) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true) return
    for (const item of list.querySelectorAll('.dshcb-group-item')) {
      const before = previous.get(item.getAttribute('data-name'))
      if (before === undefined) continue
      const after = item.getBoundingClientRect()
      const delta = before.top - after.top
      if (Math.abs(delta) < 1) continue
      item.animate([{ transform: `translateY(${String(delta)}px)` }, { transform: 'translateY(0)' }], {
        duration: 220,
        easing: 'cubic-bezier(.2, .8, .2, 1)'
      })
    }
  }, [order])
  const toggle = (name) => {
    writeSelected(selected.includes(name) ? selected.filter((entry) => entry !== name) : [...selected, name])
  }
  const available = images ?? []
  /* The list order is explicit: selecting an image must not move it. */
  const displayNames = order.filter((name) => available.includes(name))
  const move = (from, to) => {
    if (from === null || from === to) return
    writeOrder(moveRotationImage(order, from, to))
  }
  const list =
    images === null
      ? h('div', { className: 'dshcb-notice' }, copy.loading)
      : available.length === 0
        ? h('div', { className: 'dshcb-notice' }, copy.rotationGroupEmpty)
        : h(
            'div',
            { className: 'dshcb-group-list', ref: listRef },
            displayNames.map((name) => {
              const checked = selected.includes(name)
              return h(
                'div',
                {
                  key: name,
                  className: 'dshcb-group-item',
                  'data-name': name,
                  'data-selected': checked ? '' : undefined,
                  'data-dragging': dragging === name ? '' : undefined,
                  onDragOver: (event) => {
                    if (dragging !== null) event.preventDefault()
                  },
                  onDrop: (event) => {
                    event.preventDefault()
                    move(dragging, name)
                    setDragging(null)
                  }
                },
                h('input', {
                  type: 'checkbox',
                  checked,
                  'aria-label': name,
                  onChange: () => toggle(name)
                }),
                h('img', {
                  className: 'dshcb-group-thumb',
                  src: FILE_URL + encodeURIComponent(name),
                  alt: '',
                  loading: 'lazy',
                  decoding: 'async'
                }),
                h('span', { className: 'dshcb-group-name' }, name),
                h(
                  'span',
                  {
                    className: 'dshcb-drag-handle',
                    draggable: true,
                    title: copy.dragHandle,
                    'aria-label': copy.dragHandle,
                    onDragStart: (event) => {
                      event.dataTransfer.setData('text/plain', name)
                      event.dataTransfer.effectAllowed = 'move'
                      setDragging(name)
                    },
                    onDragEnd: () => setDragging(null),
                    onClick: (event) => event.preventDefault()
                  },
                  '☰'
                )
              )
            })
          )
  return h(
    Row,
    { title: copy.rotationGroupTitle },
    h(
      'div',
      { className: 'dshcb-rotation-controls' },
      list,
      h(
        'div',
        { className: 'dshcb-group-actions' },
        h(
          'button',
          {
            type: 'button',
            className: 'dshcb-button',
            disabled: available.length === 0,
            onClick: () => writeSelected(available)
          },
          copy.rotationGroupAll
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'dshcb-button',
            disabled: selected.length === 0,
            onClick: () => writeSelected([])
          },
          copy.rotationGroupNone
        )
      )
    )
  )
}

/**
 * One switch row over a `createSwitch` object. Every toggle in this plugin
 * renders through here, so they stay visually and behaviourally identical.
 * @param props - the switch, plus the row's title and description.
 */
export function SwitchRow({ setting, title, description }) {
  const enabled = setting.useEnabled()
  return h(
    Row,
    { title, description },
    h('button', {
      type: 'button',
      role: 'switch',
      'aria-checked': enabled ? 'true' : 'false',
      'aria-label': title,
      className: 'dshcb-switch',
      onClick: () => {
        setting.write(!enabled)
      }
    })
  )
}

/**
 * One colour row over a `createColorSetting` object: a native colour well plus
 * a reset button.
 * @param props - the colour setting plus the row's title and description.
 */
export function ColorRow({ setting, title, description }) {
  const copy = useCopy()
  const { color, change, reset } = setting.useColor()
  return h(
    Row,
    { title, description },
    h('input', {
      type: 'color',
      className: 'dshcb-color',
      value: color,
      'aria-label': title,
      onChange: (event) => {
        change(event.target.value)
      }
    }),
    h(
      'button',
      {
        type: 'button',
        className: 'dshcb-button',
        onClick: () => {
          reset()
        }
      },
      copy.reset
    )
  )
}

/**
 * One slider row: a range input, its live value, and one side effect. Most
 * sliders repaint the background; the token-size row repaints its own line
 * instead, which is what `after` is for.
 * @param props - storage key and bounds, copy, optional disabled state, unit
 *   suffix and the side effect to run after the value changed.
 */
export function ActiveSliderRow({ storageKey, minimum, maximum, fallback, title, description, disabled, unit, after }) {
  const copy = useCopy()
  const [value, setValue] = useState(() => readPercent(storageKey, fallback, minimum, maximum))

  const change = (next) => {
    const parsed = Number(next)
    const clamped = Number.isFinite(parsed) ? clampToRange(parsed, minimum, maximum) : value
    setValue(clamped)
    writeString(storageKey, String(clamped))
    /* Callers that drive something other than the background repaint it here. */
    if (typeof after === 'function') after(clamped)
    else applyBackground(readSelection())
  }

  return h(
    Row,
    { title, description, disabled },
    h('input', {
      type: 'range',
      className: 'dshcb-range',
      min: String(minimum),
      max: String(maximum),
      step: '1',
      value: String(value),
      disabled: disabled === true,
      'aria-label': title,
      onChange: (event) => {
        change(Number(event.target.value))
      }
    }),
    h('span', { className: 'dshcb-value' }, String(value) + (unit ?? copy.percent))
  )
}

/** Left sidebar scrim layer. */
export function ScrimLeftRow() {
  const copy = useCopy()
  return h(ActiveSliderRow, {
    storageKey: SCRIM_LEFT_KEY,
    minimum: SCRIM_MIN,
    maximum: SCRIM_MAX,
    fallback: readPercent(VEIL_KEY, VEIL_DEFAULT, VEIL_MIN, VEIL_MAX),
    title: copy.scrimLeftTitle
  })
}

/** Main window scrim layer. */
export function ScrimMainRow() {
  const copy = useCopy()
  return h(ActiveSliderRow, {
    storageKey: SCRIM_MAIN_KEY,
    minimum: SCRIM_MIN,
    maximum: SCRIM_MAX,
    fallback: readPercent(SCRIM_KEY, SCRIM_DEFAULT, SCRIM_MIN, SCRIM_MAX),
    title: copy.scrimMainTitle
  })
}

/** Right sidebar scrim layer. */
export function ScrimRightRow() {
  const copy = useCopy()
  return h(ActiveSliderRow, {
    storageKey: SCRIM_RIGHT_KEY,
    minimum: SCRIM_MIN,
    maximum: SCRIM_MAX,
    fallback: readPercent(VEIL_KEY, VEIL_DEFAULT, VEIL_MIN, VEIL_MAX),
    title: copy.scrimRightTitle
  })
}

/** Bar under the composer: on/off. */
export function StripRow() {
  const copy = useCopy()
  return h(SwitchRow, {
    setting: settings().switches.strip,
    title: copy.stripTitle,
    description: copy.stripDescription
  })
}

/** Bar colour row. */
export function StripColorRow() {
  const copy = useCopy()
  return h(ColorRow, {
    setting: settings().colors.strip,
    title: copy.stripColorTitle,
    description: copy.stripColorDescription
  })
}

/** Task progress bar: on/off. */
export function ProgressRow() {
  const copy = useCopy()
  return h(SwitchRow, {
    setting: settings().switches.progress,
    title: copy.progressTitle,
    description: copy.progressDescription
  })
}

/** Progress fill colour row. */
export function ProgressColorRow() {
  const copy = useCopy()
  return h(ColorRow, {
    setting: settings().colors.progress,
    title: copy.progressColorTitle,
    description: copy.progressColorDescription
  })
}

/** Total token line: on/off. */
export function TokenRow() {
  const copy = useCopy()
  return h(SwitchRow, {
    setting: settings().switches.token,
    title: copy.tokenTitle,
    description: copy.tokenDescription
  })
}

/** Font size of the total-token line. */
export function TokenSizeRow() {
  const copy = useCopy()
  return h(ActiveSliderRow, {
    storageKey: TOKEN_SIZE_KEY,
    minimum: TOKEN_SIZE_MIN,
    maximum: TOKEN_SIZE_MAX,
    fallback: TOKEN_SIZE_DEFAULT,
    title: copy.tokenSizeTitle,
    description: copy.tokenSizeDescription,
    unit: 'px',
    after: () => {
      applyTokenSize()
    }
  })
}

/**
 * The settings rows, in display order. The section renders them directly: the
 * `settings.section` slot's documented registration options are only
 * `id/order/label`, so composing them here keeps the plugin on the documented
 * contract instead of relying on an undocumented child-slot option
 * (`docs/ARCHITECTURE.md` §8).
 */
/** Rows shown on the Background tab. */
const BACKGROUND_ROWS = [
  BackgroundRow,
  ModeRow,
  RotationEffectRow,
  RotationGroupRow,
  ScrimLeftRow,
  ScrimMainRow,
  ScrimRightRow
]

/**
 * UI tab groups: settings that drive the same component share one card,
 * matching the card framing the app uses elsewhere (`R10-01`).
 */
const UI_GROUPS = [
  [StripRow, StripColorRow],
  [ProgressRow, ProgressColorRow],
  [TokenRow, TokenSizeRow]
]

/**
 * One UI card: a bordered rounded frame holding its two setting rows.
 * @param props - the row components to render inside the card.
 */
function UiCard({ rows }) {
  return h(
    'div',
    { className: 'dshcb-card' },
    rows.map((RowComponent, index) => h(RowComponent, { key: String(index) }))
  )
}

/**
 * The section page: a two-tab layout (背景 / UI). Slot props are not needed;
 * the rows are ordinary components of this bundle.
 */
export function PageSection() {
  const copy = useCopy()
  const [tab, setTab] = useState('background')
  const tabs = [
    { id: 'background', label: copy.tabBackground },
    { id: 'ui', label: copy.tabUi }
  ]
  const panelId = useId()
  const tabId = (id) => 'dshcb-tab-' + id
  return h(
    'div',
    { className: 'dshcb-section' },
    h(
      'div',
      { className: 'dshcb-tabs', role: 'tablist' },
      tabs.map((entry) =>
        h(
          'button',
          {
            key: entry.id,
            type: 'button',
            role: 'tab',
            id: tabId(entry.id),
            'aria-controls': panelId,
            tabIndex: tab === entry.id ? 0 : -1,
            className: 'dshcb-tab' + (tab === entry.id ? ' dshcb-tab-active' : ''),
            'aria-selected': tab === entry.id ? 'true' : 'false',
            onClick: () => setTab(entry.id),
            onKeyDown: (event) => {
              if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault()
                setTab(tab === 'background' ? 'ui' : 'background')
              }
            }
          },
          entry.label
        )
      )
    ),
    h(
      'div',
      { className: 'dshcb-tab-panel', role: 'tabpanel', id: panelId, 'aria-labelledby': tabId(tab) },
      tab === 'background'
        ? BACKGROUND_ROWS.map((RowComponent, index) => h(RowComponent, { key: String(index) }))
        : UI_GROUPS.map((rows, index) => h(UiCard, { key: String(index), rows }))
    )
  )
}
