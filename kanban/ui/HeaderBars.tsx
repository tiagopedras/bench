/* The bars around the board, drawn by React since 1 Oct 2026: the headline,
 * the bucket and theme tab strips, the two filter chips, and the phone's
 * column strip.
 *
 * renderHeadline(), renderTabs(), renderThemeTabs(), renderScoreChip(),
 * renderAgentFilterChip() and renderColTabs() keep the orchestration: they work
 * out what each bar says from state and hand it over as props, and what a click
 * does comes back as a callback. These only draw. Class names, ids and the
 * `.on` / `.hidden` hooks are the strings' own, so board.css and the suites
 * that query them read it unchanged.
 */
import { Button, Tag, ToggleChip, ToggleGroup, type TagTone } from '@tiagopedras/tenon'
import { InlineMd } from './InlineMd'

export interface HeadlineChip { tone?: TagTone, text: string, title?: string, className?: string }

export interface HeadlineModel {
  title: string
  where: string
  chips: HeadlineChip[]
  age: string | null
  solved: boolean
}

/** The inside of `#headline`. The bar itself stays the page's, since it carries
 *  the open-the-task click, the key handling and the `.set` / `.hidden`
 *  classes, which are orchestration. `null` is the empty invitation. */
export function HeadlineBar({ model, onClear }: { model: HeadlineModel | null, onClear: () => void }) {
  if (!model) {
    return (
      <>
        <span className="hllabel">The one thing</span>
        <span className="hlempty">
          Nothing set. Drag a card here, or open a task and press <strong>Make this the headline</strong>.
        </span>
      </>
    )
  }
  return (
    <>
      <span className="hllabel">The one thing</span>
      <div className="hlmain">
        <div className="hltitle"><InlineMd text={model.title} /></div>
        <div className="hlmeta">
          <span className="hlwhere">{model.where}</span>
          {model.chips.map((c, i) => (
            <Tag key={i} tone={c.tone || 'neutral'} className={c.className} title={c.title}>{c.text}</Tag>
          ))}
        </div>
      </div>
      <div className="hlright">
        {model.age !== null && <span className="hlage">{model.age}</span>}
        {model.solved && <span className="hldone">solved — pick the next one</span>}
        <Button
          size="sm"
          className="hlclear"
          id="hlClear"
          onClick={e => { e.stopPropagation(); onClear() }}
        >Remove</Button>
      </div>
    </>
  )
}

export interface FilterTab {
  key: string
  label: string
  on: boolean
  title: string
  /** The bucket colour, for the dot. Absent on All. */
  color?: string
  /** The grey count. Absent on a theme. */
  count?: number
  className?: string
}

/** One strip of toggle pills: the bucket tabs and the theme tabs. Several can
 *  be on at once, so it is Tenon's ToggleGroup, not a SegmentedControl. */
export function FilterTabs({ tabs, label, onToggle }: {
  tabs: FilterTab[]
  label: string
  onToggle: (key: string) => void
}) {
  return (
    <ToggleGroup
      aria-label={label}
      value={tabs.filter(t => t.on).map(t => t.key)}
      onToggle={onToggle}
      options={tabs.map(t => ({
        value: t.key, label: t.label, count: t.count, colour: t.color, title: t.title, className: t.className,
      }))}
    />
  )
}

export interface FilterChip { id: string, hidden: boolean, on: boolean, text: string, title: string, onClick: () => void }

/** The two chips beside the bucket strip: how many need scoring, how many are
 *  with an agent. */
export function FilterChips({ chips }: { chips: FilterChip[] }) {
  return (
    <>
      {chips.map(c => (
        <ToggleChip
          key={c.id}
          id={c.id}
          pressed={c.on}
          hidden={c.hidden}
          title={c.title}
          onClick={c.onClick}
        >{c.text}</ToggleChip>
      ))}
    </>
  )
}

/** The phone's strip of column names. `active` is the column nearest the left
 *  edge; the page works that out from the scroll position and calls again. */
export function ColTabs({ names, active, onPick }: {
  names: string[]
  active: number
  onPick: (i: number) => void
}) {
  return (
    <>
      {names.map((n, i) => (
        <button
          key={i}
          type="button"
          className={'coltab' + (i === active ? ' on' : '')}
          data-coli={i}
          onClick={() => onPick(i)}
        >{n}</button>
      ))}
    </>
  )
}
