/**
 * React binding for the browser half.
 *
 * The client bundle registers a factory that receives the shell's `require`;
 * React is one of the platform's shared modules and must not be bundled. The
 * binding is installed once, inside the factory, before any component renders;
 * every module takes React through these helpers so no module imports `react`
 * directly at load time.
 */

/** @type {{ React: object, h: Function } | null} */
let binding = null

/**
 * Bind the platform's React module to this bundle.
 * @param require - the factory's synchronous `require`.
 * @returns the stored binding.
 */
export function bindReact(require) {
  if (binding !== null) return binding
  const React = require('react')
  binding = { React, h: React.createElement }
  return binding
}

/** The bound React namespace. */
export function getReact() {
  if (binding === null) throw new Error('dsh-chat-background: React was not bound before first render')
  return binding.React
}

/**
 * `React.createElement`, spelled short: the client half builds every element by
 * hand, so one name keeps the call sites uniform.
 * @param type - element type.
 * @param props - element props.
 * @param children - child nodes.
 */
export function h(type, props, ...children) {
  return getReact().createElement(type, props, ...children)
}

/** React's `useState`, delegated so modules never destructure React at load. */
export function useState(initialState) {
  return getReact().useState(initialState)
}

/** React's `useEffect`, delegated for the same reason. */
export function useEffect(effect, dependencies) {
  return getReact().useEffect(effect, dependencies)
}

/** React's `useLayoutEffect`, delegated for the same reason. */
export function useLayoutEffect(effect, dependencies) {
  return getReact().useLayoutEffect(effect, dependencies)
}

/** React's `useRef`, delegated for the same reason. */
export function useRef(initialValue) {
  return getReact().useRef(initialValue)
}

/**
 * React's `useId`, or an empty string on a React build without it. The check is
 * stable for the lifetime of the page, so the hook order cannot change.
 */
export function useId() {
  const React = getReact()
  return typeof React.useId === 'function' ? React.useId() : ''
}
