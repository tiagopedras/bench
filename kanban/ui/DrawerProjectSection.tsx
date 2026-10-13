/* The drawer's Project field, on React since 26 Sep 2026 — see IMPROVEMENTS.md,
 * "The drawer, the header chrome and the conflict modal are still strings".
 *
 * projectSection()/bindProjectSection() (kanban/js/19-drawer.js) built this as
 * one HTML string and rewired three buttons by id on every openDrawer() call.
 * This component draws the same two states — no folder yet, or a folder with
 * its blurb and when-edited line read off disk after the panel is up — and
 * keeps the same classNames (`pcard`, `pcbody`, `pactions`, `ppick`, ...) so
 * board.css didn't need to change for it.
 *
 * Two things still live outside it, on purpose:
 * - `data-project` on the folder button is read by a delegated document
 *   click handler (19-drawer.js), the same one every project chip on a card
 *   answers to, so it stays a plain attribute rather than an onClick prop.
 * - The "Use an existing folder" picker (drawProjectPicker(), still string
 *   HTML) writes into the `#f-projpicker` div this component renders but
 *   never touches again once painted, the same way a caller has always
 *   queried into a mounted Textarea's placeholder.
 */
export interface DrawerProjectSectionMeta {
  /** mdInline()'d already — this component only drops it into the page. */
  blurbHTML?: string
  /** "N files · edited ..." joined the way loadTaskProject() always has. */
  whenText?: string
}

export interface DrawerProjectSectionProps {
  /** The raw ref (`taskProject(t)`) — null/empty means no folder yet. */
  project: string
  /** Basename for an external path, the ref itself for one under data/projects/. */
  title: string
  /** Where it actually lives, for the path line under the title. */
  where: string
  /** A helper server is reachable — false on a static/demo copy. */
  live: boolean
  /** `live && !readOnly` — whether Start/Use/Approve may run at all. */
  canEdit: boolean
  /** Undefined while loadTaskProject()'s read is still in flight. */
  meta?: DrawerProjectSectionMeta
  /** The empty-state paragraph, pre-rendered by emptyState() so the backtick
      syntax it names stays in one place. */
  emptyHTML: string
  onStartProject: () => void
  onPickFolder: () => void
  onOpenFolder: () => void
}

export function DrawerProjectSection(p: DrawerProjectSectionProps) {
  if (!p.project) {
    return (
      <>
        <div dangerouslySetInnerHTML={{ __html: p.emptyHTML }} />
        {p.canEdit && (
          <>
            <div className="pactions">
              <button type="button" className="btn small" id="f-projstart" onClick={p.onStartProject}>Start a project</button>
              <button type="button" className="btn outline small" id="f-projpick" onClick={p.onPickFolder}>Use an existing folder</button>
            </div>
            <div className="ppick hidden" id="f-projpicker" />
          </>
        )}
      </>
    )
  }
  return (
    <>
      <div className="pcard" id="taskProjCard">
        <button type="button" className="pcbody" data-project={p.project}>
          <span className="pctitle">{p.title}</span>
          <code className="pcpath">{p.where}</code>
          <span className="pcblurb" id="taskProjBlurb" dangerouslySetInnerHTML={{ __html: p.meta?.blurbHTML || '' }} />
          <span className="pcmeta" id="taskProjWhen">{p.meta?.whenText || ''}</span>
        </button>
      </div>
      {p.live && (
        <div className="pactions">
          <button type="button" className="btn outline small" id="f-projopen" onClick={p.onOpenFolder}>Open folder</button>
        </div>
      )}
    </>
  )
}
