/* Press and hold, in one place.
 *
 * A pointer held down 600ms on something, without moving more than 5px, is a
 * hold. It is the board card's (TaskCard.tsx) and the task drawer's sections
 * and sub-task cards (bindHold(), wired in 19-drawer.js), and they share this
 * so the timing, the slop and the click that follows a hold cannot drift apart.
 * Since 13 Oct 2026 a hold does not end on release: it becomes focus (below).
 *
 * beginHold() is the press itself and knows nothing about React or classes:
 * the caller draws the held look in onStart/onEnd, the second being the end of
 * the focus, not the release. bindHold() is the same press
 * for classic scripts, one delegated listener on a container whose contents are
 * rebuilt, which draws the look itself with `holdable` and `is-held` /
 * `is-releasing` (board.css).
 */

export const HOLD_MS = 600
export const HOLD_SLOP = 5
export const RELEASE_MS = 150

/** What inside a card takes a press for itself: the project chip, links, a
 *  checkbox. A hold only starts on the card body. */
export const OWN_PRESS = 'button,a,input,select,textarea,label,[data-project]'

/** The same for the drawer, where text can also be typed or selected. */
export const DRAWER_OWN_PRESS =
  'button,a,input,select,textarea,label,[contenteditable],[role=slider],[role=combobox],[data-tenon-grip],.subedit'

/** The press in progress, if any: a second press while one is live ends it. */
let live: (() => void) | null = null

/** The focus that is on, if any. One at a time. */
let focused: { el: HTMLElement, end: () => void } | null = null

/** Drops the click that follows a hold's release, so holding a card or a row
 *  does not also open it. Capture on the document, ahead of React's own
 *  listener, and gone again before the next task. */
function swallowNextClick() {
  const eat = (e: Event) => { e.preventDefault(); e.stopImmediatePropagation() }
  document.addEventListener('click', eat, true)
  window.setTimeout(() => document.removeEventListener('click', eat, true), 0)
}

/** The same for the click that ends up after a pointerdown that ended focus:
 *  it is eaten when the button comes up, so the press does not also open what
 *  it landed on. */
function swallowClickAfterThisPress() {
  const eat = (e: Event) => { e.preventDefault(); e.stopImmediatePropagation() }
  document.addEventListener('click', eat, true)
  const done = () => {
    window.removeEventListener('pointerup', done, true)
    window.removeEventListener('pointercancel', done, true)
    window.setTimeout(() => document.removeEventListener('click', eat, true), 0)
  }
  window.addEventListener('pointerup', done, true)
  window.addEventListener('pointercancel', done, true)
}

/* Focus: what a hold becomes. The held element stays held (ring, glow, page
 * dimmed) after the button is released, until a pointerdown lands outside it
 * or Esc is pressed. A pointerdown inside an element marked `data-focus-keep`
 * (a floating prompt) does not end it, nor does one inside the held element.
 *
 * The API, for anything that works on a focused element:
 *   window event `board:focus`    detail { el, kind, taskId, subIndex?, section? }
 *     kind 'task' (board or timeline card), 'subtask' (drawer .sub, with
 *     subIndex, its position among the drawer's sub-tasks) or 'section'
 *     (drawer .dcol > .field / details, with section, its label).
 *   window event `board:unfocus`  detail { el, kind, taskId, ... } as above
 *   BoardUI.endFocus()            ends the focus now, with the release fade
 *   BoardUI.focusedElement()      the held element, or null */
export interface FocusInfo {
  kind: 'task' | 'subtask' | 'section'
  taskId: string | null
  subIndex?: number
  section?: string
}

export function endFocus() {
  if (focused) focused.end()
}

export function focusedElement(): HTMLElement | null {
  return focused ? focused.el : null
}

export interface HoldHooks {
  /** The element held, for the focus events and for telling an outside press. */
  el: HTMLElement
  info: FocusInfo
  /** The press reached HOLD_MS without moving. */
  onStart: () => void
  /** The focus the hold became has ended: a press outside, Esc, endFocus(), a
   *  new hold, or the element going away. Not called for a press that never
   *  became a hold. */
  onEnd: () => void
}

/** Starts watching a press that has just begun at (x0, y0). Returns a function
 *  that ends it early (a card unmounting mid-press or while focused). */
export function beginHold(x0: number, y0: number, hooks: HoldHooks): () => void {
  if (live) live()
  let held = false
  let focusOn = false
  document.body.classList.add('card-pressing')
  const sel = window.getSelection()
  if (sel) sel.removeAllRanges()
  const detail = () => ({ el: hooks.el, ...hooks.info })

  const stopPress = () => {
    window.clearTimeout(timer)
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', release)
    window.removeEventListener('pointercancel', release)
    window.removeEventListener('blur', release)
    document.documentElement.removeEventListener('mouseleave', release)
    document.body.classList.remove('card-pressing')
    if (live === cancel) live = null
  }
  const outside = (e: PointerEvent) => {
    const t = e.target as Element | null
    if (t && t.closest && (hooks.el.contains(t) || t.closest('[data-focus-keep]'))) return
    /* The press that ends focus does nothing else: not a hold, not a drag, not
       a click on what it landed on. */
    e.preventDefault()
    e.stopImmediatePropagation()
    end()
    swallowClickAfterThisPress()
  }
  const esc = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return
    e.preventDefault()
    e.stopImmediatePropagation()
    end()
  }
  const end = () => {
    if (!focusOn) return
    focusOn = false
    held = false
    window.removeEventListener('pointerdown', outside, true)
    window.removeEventListener('keydown', esc, true)
    if (focused && focused.end === end) focused = null
    hooks.onEnd()
    window.dispatchEvent(new CustomEvent('board:unfocus', { detail: detail() }))
  }
  /* The button comes up (or anything that cancels a press): a press that was
     a hold carries on as focus. */
  const release = () => {
    stopPress()
    if (held) swallowNextClick()
  }
  const cancel = () => {
    stopPress()
    end()
  }
  const move = (ev: PointerEvent) => {
    if (held) return
    if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > HOLD_SLOP) release()
  }
  const timer = window.setTimeout(() => {
    held = true
    const s = window.getSelection()
    if (s) s.removeAllRanges()
    if (focused) focused.end()
    focusOn = true
    focused = { el: hooks.el, end }
    window.addEventListener('pointerdown', outside, true)
    window.addEventListener('keydown', esc, true)
    hooks.onStart()
    window.dispatchEvent(new CustomEvent('board:focus', { detail: detail() }))
  }, HOLD_MS)
  live = cancel
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', release)
  window.addEventListener('pointercancel', release)
  window.addEventListener('blur', release)
  document.documentElement.addEventListener('mouseleave', release)
  return cancel
}

export interface BindHoldOptions {
  /** What can be held, as a selector. The innermost match under the pointer
   *  wins, so a sub-task inside a section holds on its own. */
  selector: string
  /** Presses that start on one of these inside the target are theirs. */
  own: string
  /** Says what was held, for the focus events: the drawer knows the open task. */
  describe: (el: HTMLElement) => FocusInfo
  onStart?: (el: HTMLElement) => void
  onEnd?: (el: HTMLElement) => void
}

/** Delegated hold for classic scripts: listens on `root` once, so contents
 *  rebuilt under it keep working. Returns the function that unbinds it. */
export function bindHold(root: HTMLElement, o: BindHoldOptions): () => void {
  const press = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return
    const t = e.target as Element
    const el = t.closest<HTMLElement>(o.selector)
    if (!el || !root.contains(el)) return
    const own = t.closest(o.own)
    if (own && own !== el && el.contains(own)) return
    beginHold(e.clientX, e.clientY, {
      el,
      info: o.describe(el),
      onStart: () => { el.classList.remove('is-releasing'); el.classList.add('holdable', 'is-held'); if (o.onStart) o.onStart(el) },
      onEnd: () => {
        el.classList.remove('is-held')
        el.classList.add('is-releasing')
        window.setTimeout(() => { if (!el.classList.contains('is-held')) el.classList.remove('is-releasing', 'holdable') }, RELEASE_MS)
        if (o.onEnd) o.onEnd(el)
      },
    })
  }
  root.addEventListener('pointerdown', press)
  return () => root.removeEventListener('pointerdown', press)
}
