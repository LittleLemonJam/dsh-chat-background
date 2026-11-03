/**
 * Every CSS rule this plugin owns, in one string, injected once as a `<style>`
 * element while the plugin is mounted.
 *
 * Layering follows two invariants documented in `docs/ARCHITECTURE.md`:
 *   - the background image sits on `<html>`; the scrim is a fixed pseudo
 *     element at `z-index: -1`, i.e. above the image but below every in-flow
 *     surface;
 *   - anything the plugin wants "above the image, under the app" uses
 *     `isolation: isolate` plus a negative `z-index` child, never `transform`.
 *
 * Class names use the `dshcb-` prefix so they cannot collide with another
 * plugin's classes (`BG-27`).
 */
import {
  ACTIVE_ATTRIBUTE,
  CSS_TAG_ID,
  LIFT_ATTRIBUTE,
  FRAME_ANIMATING_ATTRIBUTE,
  LAYOUT_FRAME_ATTRIBUTE,
  MAIN_COLUMN_ATTRIBUTE,
  NO_ANIMATION_ATTRIBUTE,
  RIGHT_COLUMN_ATTRIBUTE,
  RIGHT_FULLSCREEN_ATTRIBUTE,
  RIGHT_PANEL_ATTRIBUTE,
  RIGHT_PANEL_FULL_ATTRIBUTE,
  READ_COLUMN_ATTRIBUTE,
  SIDEBAR_COLUMN_ATTRIBUTE,
  STRIP_ATTRIBUTE,
  TOKEN_NODE_ATTRIBUTE
} from './constants.js'

const active = `html[${ACTIVE_ATTRIBUTE}]`
export const css = `
/* ---- background image ---------------------------------------------------- */

${active} {
  background-color: transparent !important;
}

/* The image lives on its own fixed element, not on <html>: Chromium renders
 * animated GIF/WebP/APNG backgrounds on the root element as a static first
 * frame. */
.dshcb-background-layer {
  position: fixed;
  inset: 0;
  z-index: -1;
  width: 100%;
  height: 100%;
  pointer-events: none;
  display: block;
  object-fit: cover;
  object-position: center center;
}

/* Temporary rotation layer: painted above the <html> background but below
 * the app columns and their scrims. The manager sets the image/colour and
 * animates opacity inline. */
.dshcb-rotate-layer {
  position: fixed;
  inset: 0;
  z-index: -1;
  width: 100%;
  height: 100%;
  pointer-events: none;
  display: block;
  object-fit: cover;
  object-position: center center;
}

/* Rotation settings block. Each field is its own two-column module so the
 * captions, inputs and value slots keep the same width on every display,
 * font scale and window size; the block only decides the module width. */
.dshcb-rotation-controls {
  display: grid;
  gap: 8px;
  width: min(340px, 100%);
  min-width: 0;
}
.dshcb-control-field {
  display: grid;
  grid-template-columns: 84px minmax(0, 1fr) auto;
  align-items: center;
  column-gap: 8px;
  min-width: 0;
  font-size: 12px;
}
.dshcb-control-field > .dshcb-control-caption {
  min-width: 0;
  color: var(--dsw-alias-label-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dshcb-control-field > .dshcb-select {
  width: 100%;
  max-width: none;
  min-width: 0;
}
.dshcb-control-field > .dshcb-range {
  width: 100%;
  min-width: 0;
}
.dshcb-control-field > .dshcb-value {
  min-width: 40px;
  justify-self: end;
  text-align: end;
}
.dshcb-group-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 128px;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.dshcb-group-item {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
  height: 24px;
  max-width: 100%;
  padding: 0 2px;
  border-radius: 4px;
  font-size: 12px;
}
.dshcb-group-item[data-dragging] {
  opacity: .5;
  will-change: transform;
}
.dshcb-group-thumb {
  flex: 0 0 auto;
  width: 20px;
  height: 20px;
  border-radius: 3px;
  object-fit: cover;
  background: var(--dsw-alias-interactive-bg-hover);
}
.dshcb-group-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dshcb-drag-handle {
  flex: 0 0 auto;
  padding: 0 2px;
  color: var(--dsw-alias-label-tertiary);
  cursor: grab;
  font-size: 14px;
  line-height: 1;
  user-select: none;
}
.dshcb-group-actions {
  display: flex;
  gap: 8px;
}

/* Scrims are independent per region (left sidebar / main column / right
 * sidebar); each column is marked by the plugin and paints its own layer at
 * z-index -1 inside an isolated stacking context. There is deliberately no
 * window-wide pseudo-element: it could not leave the sidebars untouched. */

/* Measured containers: any ancestor of the conversation that paints an opaque
 * base surface is marked by markPainters(R11-01) and cleared here. */
${active} [${LIFT_ATTRIBUTE}] {
  background-color: transparent !important;
}

/* ---- sidebar ------------------------------------------------------------- */

/* The sidebar column and the sidebar slot's own root are two opaque surfaces of
 * the app frame. The column is marked by markSidebarColumn() through the
 * [data-slot=sidebar] outlet's parent, so these rules no longer depend on
 * the hashed CSS-module class name; the class selector stays as a last-resort
 * fallback for a composition where the slot outlet is missing. Both clear
 * background-image too: macOS paints the column with a gradient (R2 F2). */
${active} [${SIDEBAR_COLUMN_ATTRIBUTE}],
${active} [${SIDEBAR_COLUMN_ATTRIBUTE}] > [data-slot="sidebar"] > *,
${active} [class*="sidebarCol"] {
  background-color: transparent !important;
  background-image: none !important;
}

/* The three painted columns get their own stacking context so a scrim layer
 * can sit at z-index -1: above the image, below every in-flow surface. A
 * positioned pseudo-element needs a positioned containing block, so each
 * column gets position: relative as well (isolation alone is not enough). */
${active} [${SIDEBAR_COLUMN_ATTRIBUTE}],
${active} [${MAIN_COLUMN_ATTRIBUTE}],
${active} [${RIGHT_COLUMN_ATTRIBUTE}],
${active} [class*="sidebarCol"] {
  position: relative !important;
  isolation: isolate !important;
}

/* The app paints the base surface on the frame and on the center/right
 * columns: the Windows titlebar frame gives the center column an opaque fill
 * plus a rounded corner, and macOS fills the right column. The measured
 * painter marks only describe the DOM that was measured, so a rebuilt or
 * restyled column can come back white while the slots stay the same (the
 * marker is refreshed on every apply, the measured mark is not). Clearing
 * through the stable slot-derived markers keeps the image visible across
 * rebuilds, window restores and titlebar re-themes. */
${active} [${MAIN_COLUMN_ATTRIBUTE}],
${active} [${RIGHT_COLUMN_ATTRIBUTE}],
${active} [${LAYOUT_FRAME_ATTRIBUTE}] {
  background-color: transparent !important;
  background-image: none !important;
}

/* Left sidebar scrim. */
${active} [${SIDEBAR_COLUMN_ATTRIBUTE}]::before,
${active} [class*="sidebarCol"]::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background: var(--dsh-chat-background-scrim-left);
}

/* The reading-area veil is painted per conversation turn by the turn-mask
 * layer (src/turn-masks.js), not as one rectangle over the whole centre
 * column: the wallpaper stays visible between two turns while every turn —
 * prompt and reply — still reads as one card. The layer lives inside the
 * reading column so its width follows that column's drag handle. */
${active} [${READ_COLUMN_ATTRIBUTE}] {
  position: relative !important;
  isolation: isolate !important;
}
.dshcb-turn-scrims {
  position: absolute;
  top: 0;
  height: 0;
  overflow: visible;
  pointer-events: none;
  z-index: -1;
  /* The host's flow-gap rule targets every direct child of the flow, including
   * this layer; without the reset the whole layer (and every card in it) sits
   * one flow gap below the reading column top, leaving prompt bubbles outside
   * the veil. */
  margin: 0 !important;
}
.dshcb-turn-scrim {
  position: absolute;
  left: 0;
  width: 100%;
  border-radius: var(--dsw-radius-lg, 12px);
  background: var(--dsh-chat-background-scrim-main);
}

/* Normal size: the right column carries the scrim like the other columns, so
 * collapsing the sidebar shrinks the scrim with it. */
${active} [${RIGHT_COLUMN_ATTRIBUTE}]::after {
  content: "";
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background: var(--dsh-chat-background-scrim-right);
}
${active} [${RIGHT_COLUMN_ATTRIBUTE}][${RIGHT_PANEL_FULL_ATTRIBUTE}]::after {
  display: none;
}

/* Full-window preview: the panel itself paints the image + one right scrim,
 * covering the conversation underneath instead of letting it show through
 * (R11-01). The marker is only present while the panel is full-window, so a
 * collapsing normal sidebar never leaves a scrim rectangle behind. */
/* Fullscreen means "the main window becomes the right sidebar": keep the left
 * sidebar in place, hide the conversation column, and let the panel cover the
 * rest. The panel is repositioned through the fullscreen offset variables so
 * it starts at the left sidebar edge instead of covering the whole window. */
${active}[${RIGHT_FULLSCREEN_ATTRIBUTE}] [${MAIN_COLUMN_ATTRIBUTE}] {
  visibility: hidden !important;
}

${active} [${RIGHT_PANEL_ATTRIBUTE}][${RIGHT_PANEL_FULL_ATTRIBUTE}] {
  left: var(--dsh-chat-background-full-left, 0px) !important;
  right: auto !important;
  width: var(--dsh-chat-background-full-width, 100vw) !important;
  background-color: transparent !important;
  background-image: var(--dsh-chat-background-scrim-right), var(--dsh-chat-background-image) !important;
  background-size: auto, cover !important;
  background-position: center, center !important;
  background-repeat: no-repeat !important;
  background-attachment: fixed !important;
}

/* While switching fullscreen, freeze the rightbar panel/contents for a few
 * frames so the app cannot animate the transition (R16-01). */
${active}[${NO_ANIMATION_ATTRIBUTE}] [data-slot="rightbar"] *,
${active}[${NO_ANIMATION_ATTRIBUTE}] [${RIGHT_PANEL_ATTRIBUTE}] {
  transition: none !important;
  animation: none !important;
}

/* The layout frame gets a transition only for the duration of an open/collapse
 * click; it is not left on, otherwise dragging the sidebar edge would lag. The
 * timing matches the app content transform (0.3s cubic-bezier(.4,0,.2,1)). */
${active} [${LAYOUT_FRAME_ATTRIBUTE}][${FRAME_ANIMATING_ATTRIBUTE}] {
  transition: grid-template-columns 300ms cubic-bezier(.4, 0, .2, 1) !important;
}

/* The session list's own bottom fade ends on the fixed sidebar fill
 * (linear-gradient(to bottom, transparent, var(--dsw-specific-sidebar-fill))),
 * which becomes a light band above the account row once the sidebar is
 * transparent. Re-point its end colour at the veil so it still fades out
 * instead of leaving an edge.
 *
 * Scoped to the workspace slot inside the sidebar: a bare [class*="fade"] also
 * matches the conversation turn-rail masks and group-body masks, and painting a
 * background on those leaves visible bars (BG-03). */
${active} [data-slot="sidebar.workspaces"] [class*="fade"],
${active} [${SIDEBAR_COLUMN_ATTRIBUTE}] [class*="fade"] {
  background: linear-gradient(180deg, transparent, var(--dsh-chat-background-scrim-left, transparent)) !important;
}

/* Windows desktop draws a 40px title-bar fill on the app frame's ::before
 * (html[data-windows-titlebar] is set by the preload); a measured
 * background-color cannot see a pseudo-element, so clear it directly. */
${active}[data-windows-titlebar] [class*="frame"]::before {
  background: transparent !important;
}

/* The desktop preload samples a hidden probe span whose background is
 * var(--dsw-specific-sidebar-fill) and sends it to Electron as the native
 * title-bar overlay colour. Overriding only that probe (never the token
 * itself) makes the window-control strip transparent without changing any
 * app surface that uses the token. appending a body custom property in
 * background.js nudges the preload into re-sending the colour. */
${active} body > span[style*="dsw-specific-sidebar-fill"] {
  background-color: transparent !important;
}

/* Accessibility: when the user asks for reduced transparency or the system runs
 * forced-colors, the honest fallback is the plain theme rather than a scrim the
 * user asked not to have. */
@media (forced-colors: active) {
  ${active} {
    background-image: none !important;
  }
  ${active} [${SIDEBAR_COLUMN_ATTRIBUTE}]::before,
  ${active} [${RIGHT_COLUMN_ATTRIBUTE}]::after,
  ${active} .dshcb-turn-scrims {
    display: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  ${active} [${LAYOUT_FRAME_ATTRIBUTE}] {
    transition: none !important;
  }
}
@media (prefers-reduced-transparency: reduce) {
  ${active} {
    background-image: none !important;
  }
  ${active} [${SIDEBAR_COLUMN_ATTRIBUTE}]::before,
  ${active} [${RIGHT_COLUMN_ATTRIBUTE}]::after,
  ${active} .dshcb-turn-scrims {
    display: none;
  }
}

/* The right sidebar is its own tab host with an opaque section surface; it is
 * cleared through the stable rightbar slot outlet so the image also shows
 * there (the slot outlet is display: contents; the section is its DOM
 * descendant). Content cards inside keep their own surfaces for readability. */
${active} [data-slot="rightbar"] [class*="tabHost"] {
  background-color: transparent !important;
  background-image: none !important;
}

/* The conversation's composer seat carries a fade pad
 * (linear-gradient(180deg, transparent 0px, var(--dsw-alias-bg-base) 36px),
 * sticky at the bottom), which leaves a white band under the composer. Clear
 * it while a background is applied so the image reaches the bottom. */
${active} :is([class*="composerSeat"], [class*="composerFade"], [class*="dockFade"]) {
  background-image: none !important;
}

/* The bar under the composer: absolutely positioned inside the composer
 * wrapper, one layer below every child of that wrapper, so it paints over the
 * background image and under the usage row. isolation on the wrapper is what
 * lets the negative layer stop there; it creates a stacking context only,
 * never a containing block for fixed-position descendants. */
${active} [data-slot="conversation.composer.bar"] > * {
  position: relative !important;
  isolation: isolate !important;
}

/* Both plugin colours default per theme in the stylesheet; a picked colour
 * arrives as an inline property on <html> and replaces them. */
${active} {
  --dsh-chat-strip-bg: rgba(242, 243, 245, 0.92);
}

/* The theme service puts data-ds-dark-theme on <body>; <html> cannot be a
 * descendant of <body>, so the override is published on the body and inherited
 * down to the injected bar. A selector of the form
 * body[data-ds-dark-theme] html[...] can never match (BG-01). */
${active} body[data-ds-dark-theme] {
  --dsh-chat-strip-bg: rgba(38, 41, 48, 0.92);
}

${active} [${STRIP_ATTRIBUTE}] {
  position: absolute;
  z-index: -1;
  pointer-events: none;
  border-radius: 12px;
  background: var(--dsh-chat-strip-bg);
}

/* Settings surfaces stay readable: the section shell paints the app base.
 *
 * Deliberately limited to the settings entries: a broader shell.overlay > *
 * rule would paint an opaque background on every floating layer other plugins
 * register there (BG-15). */
${active} :is([data-slot="settings.section"], [data-slot="settings.header"], [data-slot="settings.shell"]) {
  background-color: var(--dsw-alias-bg-base) !important;
}

/* ---- settings rows ------------------------------------------------------- */

/* Inline styles cannot express :hover, focus, switch states or a track fill, so
 * the rows keep their layout in this plugin stylesheet. */

/* Settings page shell: one column of rows, like the built-in sections. The last
 * row drops its divider so the page does not end on a line. */
.dshcb-section {
  display: flex;
  flex-direction: column;
  width: 100%;
}
.dshcb-section > :last-child {
  border-bottom: none;
}

/* Sub-navigation mirrors the app’s pill tabs: the active tab is a filled
 * brand pill, the others stay quiet text buttons. */
.dshcb-tabs {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 0 14px;
}
.dshcb-tab {
  height: 32px;
  padding: 0 14px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  cursor: pointer;
}
.dshcb-tab:hover:not(.dshcb-tab-active) {
  background: var(--dsw-alias-bg-layer-1);
}
.dshcb-tab-active {
  background: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-label-primary-inverted, #fff);
}

/* One card per component on the UI tab, matching the app’s bordered
 * summary cards: 1px hairline and a large radius. */
.dshcb-card {
  margin-top: 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-lg, 12px);
  padding: 0 16px;
}
.dshcb-card .dshcb-row {
  padding: 14px 0;
}
.dshcb-card .dshcb-row:last-child {
  border-bottom: none;
}
.dshcb-tab-panel > .dshcb-row:last-child {
  border-bottom: none;
}
.dshcb-status {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.dshcb-background-block {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 0;
  border-bottom: 0.5px solid var(--dsw-alias-border-l2);
}
.dshcb-bg-preview {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 180px;
  border-radius: var(--dsw-radius-md, 8px);
  background-color: var(--dsw-alias-bg-layer-1);
  background-position: center;
  background-size: cover;
  background-repeat: no-repeat;
  overflow: hidden;
}
.dshcb-bg-empty {
  color: var(--dsw-alias-label-tertiary);
  font-size: 13px;
}
.dshcb-bg-file {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.dshcb-bg-select {
  flex: 1 1 200px;
  max-width: none;
  min-width: 0;
}
.dshcb-bg-file .dshcb-select {
  flex: 1 1 200px;
  max-width: none;
  min-width: 0;
}
.dshcb-bg-file .dshcb-button {
  flex: none;
}

/* Every setting row is a two-column module: the copy takes the free space,
 * the control block keeps its own intrinsic width and is pinned to the right.
 * Grid (not flex + space-between) is what stops a wide control from squeezing
 * the label or shifting it between window sizes, zoom levels and displays. */
.dshcb-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  column-gap: 24px;
  row-gap: 8px;
  padding: 16px 0;
  border-bottom: 0.5px solid var(--dsw-alias-border-l2);
}
.dshcb-text {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
  min-width: 0;
}
.dshcb-title {
  color: var(--dsw-alias-label-primary);
  font-size: 14px;
  font-weight: 400;
  line-height: 22px;
}
.dshcb-desc {
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  font-weight: 400;
  line-height: 18px;
}
.dshcb-notice {
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
}
.dshcb-error {
  color: var(--dsw-alias-state-error-primary);
  font-size: 12px;
  line-height: 18px;
}
/* One self-contained module per control group: it keeps its size and stays
 * right-aligned whatever the label wraps to. */
.dshcb-control {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  min-width: 0;
}
/* ---- controls ------------------------------------------------------------ */

.dshcb-button {
  flex: none;
  height: 32px;
  padding: 0 12px;
  border: 0.5px solid var(--dsw-alias-border-l1);
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  white-space: nowrap;
  cursor: pointer;
}
.dshcb-button:hover:not(:disabled) {
  background: var(--dsw-alias-bg-layer-1);
}
.dshcb-button:disabled {
  color: var(--dsw-alias-label-caption);
  cursor: default;
}
.dshcb-select {
  flex: none;
  width: 180px;
  max-width: 180px;
  height: 32px;
  padding: 0 6px;
  border: 0.5px solid var(--dsw-alias-border-l1);
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
}

/* Switch: 36x20 track with a 16px thumb. */
.dshcb-switch {
  position: relative;
  flex: none;
  width: 36px;
  height: 20px;
  padding: 0;
  border: 0.5px solid var(--dsw-alias-border-l4);
  border-radius: 999px;
  background: var(--dsw-alias-bg-module-platform);
  cursor: pointer;
  transition: background .15s;
}
.dshcb-switch::after {
  content: "";
  position: absolute;
  top: 1px;
  left: 1px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--dsw-alias-switch-thumb, #fff);
  transition: transform .15s;
}
.dshcb-switch[aria-checked="true"] {
  border-color: var(--dsw-alias-brand-primary);
  background: var(--dsw-alias-brand-primary);
}
.dshcb-switch[aria-checked="true"]::after {
  transform: translateX(16px);
}
.dshcb-switch:focus-visible,
.dshcb-range:focus-visible {
  outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 2px;
}

/* Native colour well, restyled as a swatch so the palette control matches the
 * other settings rows. */
.dshcb-color {
  appearance: none;
  -webkit-appearance: none;
  flex: none;
  width: 44px;
  height: 32px;
  padding: 2px;
  border: 0.5px solid var(--dsw-alias-border-l1);
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  cursor: pointer;
}
.dshcb-color::-webkit-color-swatch-wrapper {
  padding: 0;
}
.dshcb-color::-webkit-color-swatch {
  border: 0;
  border-radius: 6px;
}
.dshcb-color::-moz-color-swatch {
  border: 0;
  border-radius: 6px;
}
.dshcb-color:focus-visible {
  outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 2px;
}

/* Range slider. The track and thumb sizes are variables and the thumb offset
 * is derived from them; a hand-tuned pixel offset drifts once the app's font
 * metrics, page zoom or device pixel ratio change (the track's vertical
 * position depends on the native control's line box, not on this stylesheet). */
.dshcb-range {
  --dshcb-range-track-height: 4px;
  --dshcb-range-thumb-size: 14px;
  appearance: none;
  -webkit-appearance: none;
  flex: none;
  width: 132px;
  height: 20px;
  margin: 0;
  background: transparent;
  cursor: pointer;
  /* Collapse the native line box so the track cannot be pushed off-centre by
   * the inherited font size. */
  line-height: 0;
}
.dshcb-range:disabled {
  cursor: default;
}
.dshcb-range::-webkit-slider-runnable-track {
  box-sizing: border-box;
  height: var(--dshcb-range-track-height);
  border: 0.5px solid var(--dsw-alias-border-l1);
  border-radius: 999px;
  background: var(--dsw-alias-bg-module-platform);
}
.dshcb-range::-webkit-slider-thumb {
  appearance: none;
  -webkit-appearance: none;
  width: var(--dshcb-range-thumb-size);
  height: var(--dshcb-range-thumb-size);
  margin-top: calc((var(--dshcb-range-track-height) - var(--dshcb-range-thumb-size)) / 2);
  border: 0;
  border-radius: 50%;
  background: var(--dsw-alias-brand-primary);
}
.dshcb-range:disabled::-webkit-slider-thumb {
  background: var(--dsw-alias-state-idle-primary, #a2a4a6);
}
.dshcb-range::-moz-range-track {
  box-sizing: border-box;
  height: var(--dshcb-range-track-height);
  border: 0.5px solid var(--dsw-alias-border-l1);
  border-radius: 999px;
  background: var(--dsw-alias-bg-module-platform);
}
.dshcb-range::-moz-range-thumb {
  width: var(--dshcb-range-thumb-size);
  height: var(--dshcb-range-thumb-size);
  border: 0;
  border-radius: 50%;
  background: var(--dsw-alias-brand-primary);
}
.dshcb-value {
  min-width: 40px;
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  text-align: right;
}

/* Narrow settings panels: stack the control module under the copy instead of
 * letting the two columns fight for room. The module keeps its own layout, so
 * nothing moves between devices — only its position changes. */
@media (max-width: 640px) {
  .dshcb-row {
    grid-template-columns: minmax(0, 1fr);
  }
  .dshcb-control {
    justify-content: flex-start;
  }
  .dshcb-rotation-controls {
    width: 100%;
  }
}

/* ---- task progress bar --------------------------------------------------- */

/* Mounted into the composer's input dock (a full-width entry above the composer
 * card): the percentage first, bar to its right, the pair pushed to the right
 * edge of the COMPOSER CARD. The dock's parent is the whole centre column,
 * which is wider than the card, so the row adopts the card's own width variable
 * and centres itself — otherwise the bar lands at the window edge instead of
 * above the input bar. */
.dshcb-progress-row {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  width: var(--dsh-composer-card-max-width, min(calc(100% - 16px), 952px));
  max-width: 100%;
  margin-left: auto;
  margin-right: auto;
  /* Right padding is the app's own dock inset, which lines the bar's right end
   * up with the composer's send button (measured: both land on the same x at a
   * 1416-wide viewport). */
  padding: 0 var(--dsh-composer-dock-inset, 8px) 6px;
}
.dshcb-progress-value {
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  line-height: 18px;
}
.dshcb-progress-track {
  flex: none;
  width: 140px;
  height: 6px;
  border-radius: 999px;
  background: var(--dsw-alias-interactive-bg-hover);
  overflow: hidden;
}
.dshcb-progress-fill {
  height: 100%;
  border-radius: 999px;
  background: var(--dsh-progress-color, var(--dsw-alias-brand-primary));
  transition: width .2s ease;
}

/* While the estimate drives the bar (a live turn without a task list), a slow
 * pulse says "still working" without inventing a number. */
.dshcb-progress-track[data-running] .dshcb-progress-fill {
  animation: dshcb-progress-pulse 1.6s ease-in-out infinite;
}
@keyframes dshcb-progress-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: .7; }
}
/* Respect a reduced-motion preference: the percentage is still live, the pulse
 * is only decoration. */
@media (prefers-reduced-motion: reduce) {
  .dshcb-progress-track[data-running] .dshcb-progress-fill {
    animation: none;
  }
}

/* ---- total token line ---------------------------------------------------- */

/* Injected into the sidebar footer right above the account row. Type and colour
 * match that row (14px / label-primary / 22px line box); the font size comes
 * from the settings row via a custom property, so the slider re-styles it
 * without a re-render. */
[${TOKEN_NODE_ATTRIBUTE}] {
  box-sizing: border-box;
  /* Left padding is corrected at runtime against the account row. */
  padding: 6px 12px 2px 4px;
  color: var(--dsw-alias-label-primary);
  font-size: var(--dsh-token-size, 14px);
  font-weight: 400;
  font-variant-numeric: tabular-nums;
  line-height: 22px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
`.trim()

/**
 * Inject the static stylesheet once.
 * @returns cleanup removing the style element.
 */
export function installStyles() {
  const existing = document.querySelector(`style[data-plugin-css=${JSON.stringify(CSS_TAG_ID)}]`)
  if (existing !== null) return () => {}
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-chat-background'
  tag.dataset.pluginCss = CSS_TAG_ID
  tag.textContent = css
  document.head.appendChild(tag)
  return () => {
    tag.remove()
  }
}
