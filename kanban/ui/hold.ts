/* Press and hold, in one place.
 *
 * A pointer held down 600ms on something, without moving more than 5px, is a
 * hold. It is the board card's (TaskCard.tsx) and the task drawer's sections
 * and sub-task cards (bindHold(), wired in 19-drawer.js), and they share this
 * so the timing, the slop and the click that follows a hold cannot drift apart.
 *
 * beginHold() is the press itself and knows nothing about React or classes:
 * the caller draws the held look in onStart/onEnd. bindHold() is the same press
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

/** The one hold at a time: a second press while one is live ends the first. */
let live: (() => void) | null = null

/** Drops the click that follows a hold's release, so holding a card or a row
 *  does not also open it. Capture on the document, ahead of React's own
 *  listener, and gone again before the next task. */
function swallowNextClick() {
  const eat = (e: Event) => { e.preventDefault(); e.stopImmediatePropagation() }
  document.addEventListener('click', eat, true)
  window.setTimeout(() => document.removeEventListener('click', eat, true), 0)
}

export interface HoldHooks {
  /** The press reached HOLD_MS without moving. */
  onStart: () => void
  /** The press ended after a hold started, by release or by anything that
   *  cancels a press. Not called for a press that never became a hold. */
  onEnd: () => void
}

/** Starts watching a press that has just begun at (x0, y0). Returns a function
 *  that ends it early (a card unmounting mid-press). */
export function beginHold(x0: number, y0: number, hooks: HoldHooks): () => void {
  if (live) live()
  let held = false
  document.body.classList.add('card-pressing')
  const sel = window.getSelection()
  if (sel) sel.removeAllRanges()
  const finish = () => {
    window.clearTimeout(timer)
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', finish)
    window.removeEventListener('pointercancel', finish)
    window.removeEventListener('blur', finish)
    document.documentElement.removeEventListener('mouseleave', finish)
    document.body.classList.remove('card-pressing')
    if (live === finish) live = null
    if (held) {
      held = false
      swallowNextClick()
      hooks.onEnd()
    }
  }
  const move = (ev: PointerEvent) => {
    if (held) return
    if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > HOLD_SLOP) finish()
  }
  const timer = window.setTimeout(() => {
    held = true
    const s = window.getSelection()
    if (s) s.removeAllRanges()
    hooks.onStart()
  }, HOLD_MS)
  live = finish
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', finish)
  window.addEventListener('pointercancel', finish)
  window.addEventListener('blur', finish)
  document.documentElement.addEventListener('mouseleave', finish)
  return finish
}

export interface BindHoldOptions {
  /** What can be held, as a selector. The innermost match under the pointer
   *  wins, so a sub-task inside a section holds on its own. */
  selector: string
  /** Presses that start on one of these inside the target are theirs. */
  own: string
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
      onStart: () => { el.classList.add('holdable', 'is-held'); if (o.onStart) o.onStart(el) },
      onEnd: () => {
        el.classList.remove('is-held')
        el.classList.add('is-releasing')
        window.setTimeout(() => el.classList.remove('is-releasing', 'holdable'), RELEASE_MS)
        if (o.onEnd) o.onEnd(el)
      },
    })
  }
  root.addEventListener('pointerdown', press)
  return () => root.removeEventListener('pointerdown', press)
}
