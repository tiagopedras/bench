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

/** The lists the companion can watch, in menu order. The first is the default
    when nothing is saved. Kept in step with LISTS in companion/digest.py. */
export const LISTS = ['personal', 'work-and-career', 'twinkl'] as const
export type ListName = (typeof LISTS)[number]

/** The companion's own choice, deliberately not data/.current, which is the
    board dropdown's pointer. */
export function listPath(root: string): string {
  return path.join(root, 'data', 'companion-list.json')
}

export function readList(root: string): ListName {
  try {
    const saved = (JSON.parse(fs.readFileSync(listPath(root), 'utf8')) as { list?: string }).list
    return LISTS.find((name) => name === saved) ?? LISTS[0]
  } catch {
    return LISTS[0]
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
