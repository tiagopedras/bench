/* A task on the board: eyebrow, title, chips and a progress line, on Tenon's
 * `Card`.
 *
 * `cardModel()` in 09-columns.js decides what a task says, and this draws it.
 * `cardHTML()` in the same file draws the same model as a string for the
 * matrix's hover preview, and `test_board.mjs` compares the two element for
 * element. Change what a card shows in cardModel() and both follow; change how
 * a chip or the progress line is drawn and change it in both.
 *
 * The title arrives as the plain string from todo.md and Tenon's `Markdown`
 * draws it (InlineMd.tsx), links and `[placeholder]` markers included. It sits
 * in one span, which the pinned string shapes do not have; the test steps
 * over it.
 */
import type { DragEvent, KeyboardEvent } from 'react'
import { Card, Pill, Tag } from '@tiagopedras/tenon'
import type { PillTone, TagTone } from '@tiagopedras/tenon'
import { InlineMd } from './InlineMd'

export interface Chip {
  /** One of Tenon's `Tag` tones — draws a Tenon `Tag`. Set instead of `cls`. */
  tone?: TagTone
  /** Tenon's `Pill`, the outlined chip, in this tone — for the chips that
   *  say what a task belongs to or waits for rather than a fact about it:
   *  the project, the theme and the start date. Set instead of `tone`. */
  pill?: PillTone
  /** With `pill`, one extra class the board styles on top (the project
   *  chip's hover, the start date's dashed border). Alone, the board's own
   *  `.tag` classes, now only for your move: it is solid, and neither `Tag`
   *  nor `Pill` has a filled tone. */
  cls?: string
  text: string
  title?: string
  /** Set on the project chip, which opens the project rather than the card. */
  project?: string
  /** Raw `<svg>` markup for the small avatar drawn before the text — set on
   *  the delegated chip when `[to::]` names an agent (agentAvatarHTML(),
   *  core/avatar.js), '' or unset for a person. */
  avatarHTML?: string
}

export type CardProgress = { kind: 'steps', done: number, total: number, pct: number }

/** Where an agent's run on the task stands, one line: "Plan agent · waiting
 *  for you · 02:05". `tone` is running, queued, you or failed
 *  (agentRunStatus(), kanban/js/28-agent-runs.js). */
export interface CardRunStatus { text: string, tone: string, title?: string }

export interface TaskCardModel {
  id: string
  /** `done`, `waiting`, `backlog` or `todo`, plus `onething` for the headline and
   *  `selected` while it's held for a bulk action (state.selectedIds,
   *  02-state.js) — cardModel() decides all of these, this just draws them. */
  cls: string
  /** The title as written, inline Markdown and all. */
  title: string
  chips: Chip[]
  /** Urgent and due, drawn together in the row's own corner. */
  when: Chip[]
  progress: CardProgress | null
  /** Null, or absent, for a task with no agent part open. */
  status?: CardRunStatus | null
}

export interface TaskCardProps {
  model: TaskCardModel
  /** The bucket's colour, for the stripe. */
  stripe: string
  /** The bucket's name, shown only when more than one bucket is on screen. */
  bucketLabel: string
  draggable: boolean
  dragging: boolean
  /** A picture of the card rather than one to act on: no focus, no role, no
   *  handlers. The matrix's hover preview is one, and must not land in the tab
   *  order or take a click meant for whatever is under it. */
  static?: boolean
  /** `multi` is true when the click carried shift, cmd or ctrl — the board's
   *  cue to toggle the card into state.selectedIds instead of opening it (see
   *  the onOpen wiring in 18-timeline.js's renderBoard()). Plain Enter/Space
   *  never sets it: a bulk pick is a mouse gesture, not a keyboard one. */
  onOpen?: (id: string, multi?: boolean) => void
  onDragStart?: (e: DragEvent<HTMLElement>, id: string) => void
  onDragEnd?: (e: DragEvent<HTMLElement>, id: string) => void
}

function ChipSpan({ c }: { c: Chip }) {
  const avatar = c.avatarHTML
    ? <span className="avatar" dangerouslySetInnerHTML={{ __html: c.avatarHTML }} />
    : null
  if (c.tone) return <Tag tone={c.tone} title={c.title}>{avatar}{c.text}</Tag>
  if (c.pill) return (
    <Pill tone={c.pill} className={c.cls} data-project={c.project} title={c.title}>{avatar}{c.text}</Pill>
  )
  return (
    <span className={c.cls} data-project={c.project} title={c.title}>{avatar}{c.text}</span>
  )
}

export function TaskCard(props: TaskCardProps) {
  const { model: m, stripe, bucketLabel, draggable, dragging, onOpen, onDragStart, onDragEnd } = props
  const still = !!props.static
  const open = (e: { metaKey?: boolean, ctrlKey?: boolean, shiftKey?: boolean }) => {
    if (onOpen) onOpen(m.id, !!(e.metaKey || e.ctrlKey || e.shiftKey))
  }
  const key = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open({}) }
  }

  const tags = (m.chips.length || m.when.length) ? (
    <>
      {m.chips.map((c, i) => <ChipSpan key={i} c={c} />)}
      {m.when.length ? (
        <span className="meta-when">{m.when.map((c, i) => <ChipSpan key={i} c={c} />)}</span>
      ) : null}
    </>
  ) : null

  const p = m.progress
  const s = m.status
  const prog = !p ? null : (
    <div className="prog">
      <span>{p.done + '/' + p.total + ' steps'}</span>
      <span className="bar"><i style={{ width: p.pct + '%' }} /></span>
    </div>
  )
  const run = !s ? null : (
    <div className={'runline runline--' + s.tone} title={s.title || undefined}>{s.text}</div>
  )
  const body = !prog && !run ? null : <>{run}{prog}</>

  return (
    <Card
      className={(m.cls + (dragging ? ' dragging' : '')).trim()}
      accent={stripe}
      draggable={still ? false : draggable}
      dragging={dragging}
      tabIndex={still ? undefined : 0}
      role={still ? undefined : 'button'}
      data-id={m.id}
      onClick={still ? undefined : open}
      onKeyDown={still ? undefined : key}
      onDragStart={still || !onDragStart ? undefined : e => onDragStart(e, m.id)}
      onDragEnd={still || !onDragEnd ? undefined : e => onDragEnd(e, m.id)}
      eyebrow={bucketLabel ? <span className="bucket">{bucketLabel}</span> : undefined}
      title={<InlineMd text={m.title} />}
      tags={tags}
      body={body}
    />
  )
}
