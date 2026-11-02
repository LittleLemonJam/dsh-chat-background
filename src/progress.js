/**
 * The task progress bar above the composer card.
 *
 * Progress has two sources, in order of accuracy:
 *
 *  1. the `todos` projection — completed todos over the total, when the agent
 *     keeps a task list for the current work;
 *  2. otherwise a rough estimate of the running turn, from how many steps it has
 *     already taken (`sessionStats.steps` counted from the turn's start). The
 *     curve approaches but never reaches 100% while the turn runs, and an idle
 *     session with no list reads as done.
 *
 * The shell's `useProjection` / `useSession` are React hooks, so they must be
 * called unconditionally and in a stable order. The entry component therefore
 * picks between two child components with fixed hook sequences instead of
 * swapping a hook implementation inside one component (`R-05`).
 */
import { recordDiagnostics } from './diagnostics.js'
import { h, useEffect, useRef } from './react.js'
import { useCopy } from './i18n.js'
import { settings } from './settings.js'

/**
 * Pure presenter for the bar; contains no hooks, so both variants can share it.
 * Idle (no task list, no running turn) renders nothing: a permanently visible
 * 100% row would occupy composer height for no information (`R2 F4`).
 * @param props - resolved state plus the copy dictionary.
 */
function ProgressView({ copy, enabled, percent, runningHint, estimating, idle = false }) {
  recordDiagnostics({ progress: { enabled, idle, percent, estimating, visible: enabled && !idle } })
  if (!enabled || idle) return null
  const track = {
    className: 'dshcb-progress-track',
    role: 'progressbar',
    'aria-valuemin': '0',
    'aria-valuemax': '100',
    'aria-valuenow': String(percent),
    'aria-label': copy.progressTitle,
    title: estimating ? runningHint : copy.progressTitle
  }
  if (estimating) track['data-running'] = ''
  return h(
    'div',
    { className: 'dshcb-progress-row' },
    h(
      'span',
      { className: 'dshcb-progress-value', title: estimating ? copy.progressRunning : undefined },
      String(percent) + copy.percent
    ),
    h('div', track, h('div', { className: 'dshcb-progress-fill', style: { width: `${percent}%` } }))
  )
}

/**
 * Live variant: the shell provided both projection readers. Hook order is fixed
 * (copy, switch, two projections, session selector, ref, effect).
 * @param props - composed slot props carrying `useProjection` and `useSession`.
 */
function ProgressDockLive({ useProjection, useSession }) {
  const copy = useCopy()
  const enabled = settings().switches.progress.useEnabled()
  const todos = useProjection('todos')
  const stats = useProjection('sessionStats')
  const running =
    useSession((snapshot) => snapshot !== undefined && snapshot !== null && snapshot.running === true) === true
  const steps = stats !== null && typeof stats === 'object' && typeof stats.steps === 'number' ? stats.steps : 0
  /* The turn's own step count: `sessionStats.steps` is cumulative, so the value
   * at the moment the session started running is remembered as the baseline.
   * This lives in a ref and is updated from an effect, never during render. */
  const baseline = useRef(null)
  useEffect(() => {
    baseline.current = running ? (baseline.current ?? steps) : null
  }, [running, steps])
  const turnSteps = running && baseline.current !== null ? Math.max(0, steps - baseline.current) : 0

  const list = Array.isArray(todos) ? todos.filter((item) => item !== null && typeof item === 'object') : []
  if (list.length > 0) {
    const done = list.filter((item) => item.status === 'completed').length
    return h(ProgressView, {
      copy,
      enabled,
      percent: Math.round((done / list.length) * 100),
      runningHint: undefined,
      estimating: false
    })
  }
  if (running) {
    /* Rough by design: a concave curve over the steps already taken, capped
     * below 100 so a live turn never claims to be finished. */
    const percent = turnSteps <= 0 ? 4 : Math.min(92, Math.round((turnSteps / (turnSteps + 6)) * 100))
    return h(ProgressView, {
      copy,
      enabled,
      percent,
      runningHint: copy.progressRunningHint.replace('{steps}', String(turnSteps)),
      estimating: true
    })
  }
  return h(ProgressView, { copy, enabled, percent: 100, runningHint: undefined, estimating: false, idle: true })
}

/**
 * Static variant: the shell did not provide the readers (an older composition or
 * a different slot). No truthful progress can be reported, so nothing is shown.
 */
function ProgressDockStatic() {
  const copy = useCopy()
  const enabled = settings().switches.progress.useEnabled()
  return h(ProgressView, { copy, enabled, percent: 100, runningHint: undefined, estimating: false, idle: true })
}

/**
 * The progress bar itself. It mounts into the composer's input dock, a
 * full-width entry above the composer card, so the row is pushed right with the
 * percentage first and the bar beside it.
 * @param props - composed slot props: `useProjection`, `useSession`.
 */
export function ProgressDock(props) {
  const live = typeof props.useProjection === 'function' && typeof props.useSession === 'function'
  return live ? h(ProgressDockLive, props) : h(ProgressDockStatic)
}
