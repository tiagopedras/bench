# Overnight build, 26–27 Sep 2026

Waves 5 and 6 landed on main: 11 backlog entries done and one moved forward. Wave 7 didn't start, because the last wave 6 builder finished at 06:58, after the 06:00 cut-off. On main 22 of 23 board suites pass. The one failure is the known `test_chats` timing flake. Nothing was pushed.

## Do these first

1. **Restart the board server.** `lsof -ti tcp:8765 | xargs kill`, then open To-Do Board.app. Two changes need it: chat write mode, and the brief template the agent setup reads.
2. **After the restart, open your own lists.** Delegate to should still offer the agents, and Overview should still have its Delegate to Claude column. All three of your lists pass the new "is an agent set up" test, so nothing should hide.

## Questions for you

1. When bulk editing moves cards to Done, it doesn't tick them, so a card can sit in Done unticked. Is that what you want?
2. A task tagged to an agent by hand is now handed over by the board on load. That moves the card from Backlog or To do into Doing, the same as Delegate to. Is that jump what you want?
3. Chat write mode lets a chat edit files inside its own folder. For twinkl that folder is `~/Code`, so a writing chat can edit any of your repos, though never a `todo.md`. Is that reach what you want?
4. The PA's new "How he works" section was inferred from your setup, not from anything you said: you defer by default, you underestimate your time, you hand off execution once a task is scoped. Is it right?

## Wave 5

- **The PA has a personality.** "Tone and personality" in `PA.md` is written around proactive, kind and professionally caring, with the old tone rules kept. A new "How he works" section sits after "Who he is". Check that "professionally caring" doesn't read as cold, since it rules out small talk.
- **A task tagged to an agent by hand gets handed over.** The Plan agent asks for the handover through the tick queue, and the board lays out the sub-tasks on load. The task is planned the night after.
- **Board chats can write.** A "Can write" switch appears in the chat header once a list's `claude.json` has `"work": true`, which no list has yet. `todo.md` is always refused, so list changes still go through a `pa-changes` block. `ai_chat_engine` main was moved forward to take it (`cb62a5e`).
- **Project, theme and start-date chips are Tenon's Pill.** Your-move stays the board's own chip until Tenon's Tag has a filled tone. Check the pills sit well beside the other chips.
- **The drawer's project section is React.** The steps, date pickers, dependency picker and sub-task list are still strings, so that entry stays open.

## Wave 6

- **A background plan can be read without a reload.** The drawer finds the plan even with no `Plan:` line. The agents' ticks now apply when you come back to the tab, when you leave the Agents view, and when a run you started finishes.
- **Bulk editing.** Shift-, ⌘- or Ctrl-click cards on the Board view. A bar appears to move them to a column or bucket, or delete them, as one undo step. Escape clears the selection.
- **The hosted page can open a folder on your machine.** In Chrome or Edge, "Open a folder…" on the demo's lock bar reads and saves that folder's `todo.md`. It checks the file hasn't changed on disk, keeps one backup per visit and a crash copy, and remembers the folder. It covers `todo.md` only; plans, reports and projects still need the local helper. To try it: `python3 -m http.server` from the repo root, then `/kanban/index.html`.
- **Agent setup.** The Agents tab has a card each for the PA, the Plan agent and the Implement agent. A new list shows a "Set up an agent" intro with four questions that write the bucket's brief. Until a list has an agent, its agent options stay hidden. The screenshots are `setup.png`, `q.png` and `done.png` in the session scratchpad.

## Not done

Wave 7 is the specialist agents model, handover level, run status line, output feed and failure state. Its five entries are still open, and the drawer entry is open with less left to do.
