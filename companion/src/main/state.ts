/* The companion's own memory: which messages have been dismissed, and when it
   last sent the morning notification. Same file digest.py reads for the
   dismissed set (companion/digest.py:read_dismissed) — this is the only thing
   that writes it. */

import fs from 'node:fs'
import path from 'node:path'

export interface CompanionState {
  dismissed?: string[]
  notified?: string
  notified_at?: string
  /** Which timed meetings have already popped up today, as `date::task` —
      so a tick landing after the fire minute doesn't post the same meeting
      twice, and so a meeting popped yesterday pops again today. */
  meetingsFired?: string[]
}

export function statePath(root: string, dataset: string): string {
  return path.join(root, 'data', dataset, 'companion.json')
}

export function readState(root: string, dataset: string): CompanionState {
  try {
    return JSON.parse(fs.readFileSync(statePath(root, dataset), 'utf8')) as CompanionState
  } catch {
    return {}
  }
}

/** Never raises — a companion that cannot remember is still a companion,
    same reasoning as write_state in the old app.py. */
export function writeState(root: string, dataset: string, state: CompanionState): void {
  try {
    const target = statePath(root, dataset)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, JSON.stringify(state, null, 2))
  } catch {
    // best effort
  }
}

/** A list is a folder under data/ holding a todo.md; listBoards() finds them.
    The first, in name order, is the default when nothing is saved. Kept in step
    with chosen_list() in companion/digest.py. */
export type ListName = string

/** The companion's own choice, deliberately not data/.current, which is the
    board dropdown's pointer. */
export function listPath(root: string): string {
  return path.join(root, 'data', 'companion-list.json')
}

export function readList(root: string): ListName {
  try {
    const saved = (JSON.parse(fs.readFileSync(listPath(root), 'utf8')) as { list?: string }).list
    const boards = listBoards(root)
    return boards.find((name) => name === saved) ?? boards[0] ?? 'default'
  } catch {
    return listBoards(root)[0] ?? 'default'
  }
}

export function writeList(root: string, list: ListName): void {
  try {
    fs.mkdirSync(path.dirname(listPath(root)), { recursive: true })
    fs.writeFileSync(listPath(root), JSON.stringify({ list }, null, 2))
  } catch {
    // best effort
  }
}

/** Every board: a folder data/<name>/ that holds a todo.md, read now, sorted.
    No fixed list, so a new board is told from its first morning. */
export function listBoards(root: string): string[] {
  try {
    return fs
      .readdirSync(path.join(root, 'data'), { withFileTypes: true })
      .filter((e) => e.isDirectory() && fs.existsSync(path.join(root, 'data', e.name, 'todo.md')))
      .map((e) => e.name)
      .sort()
  } catch {
    return []
  }
}
