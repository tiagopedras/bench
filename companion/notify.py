#!/usr/bin/env python3
"""Ask the board server to say something on screen.

Since 26 Oct 2026 the thing that puts a desktop banner up is the board server
(core/notify_due.py, through terminal-notifier); the Electron companion that
used to is retired. The planning agent has no UI at all, the board is a browser
tab that is usually shut, and a skill is a conversation that has already ended
by the time its result matters. So rather than each growing its own way to
speak, they all append here and the server drains the queue on its next tick,
a minute at most, while the board is running.

    python3 companion/notify.py "Plan agent" "3 plans written, 2 skipped"
    python3 companion/notify.py --view plans "Plan agent" "3 plans waiting"
    python3 companion/notify.py --task ds-audit "Due today" "The audit is owed"
    python3 companion/notify.py --dataset _test "Title" "Body"

Or from Python:

    sys.path.insert(0, ".../companion"); import notify
    notify.queue("Plan agent", "3 plans written", view="plans")

`task` and `view` say where the banner goes when it is pressed. A task is a
card's `#slug`, or its title where it has none — the two things in todo.md
stable enough to point at. A view is one of the board's own tabs, `plans`,
`board` and the rest. Give both and it opens the card on that view;
give neither and it opens the board's front page. Sending someone to a banner
they cannot follow up is most of what makes a notification annoying, so name
one wherever there is an obvious one to name.

Appending is all this does. It never posts anything itself and it takes the
queue's lock only for the moment of the write, so it is safe to call from a
script running at two in the morning with nobody logged in — and safe when the
board is not running at all, since the queue simply waits. The lock is
`notify-queue.lock` beside the queue file, taken with flock, and the server's
drain takes the same one, so an append and a drain never overlap.

What the server will not do with what you queue, however loudly you ask:

  - Post outside 08:30 to 20:00. A line queued at 02:00 waits for the morning.
  - Post more than three at once.

The one exception is the `content` list: its queue is drained with no time
window, so a notice from the 11pm run shows at once.

Weekends and public holidays are *not* excluded, unlike the morning briefing.
That briefing is a scheduled interruption about a working day, so a Saturday
rightly gets none; a queued line answers something that has just happened,
because something was set running. Holding a Saturday night's result until
Monday morning helps nobody.

So this is for things worth a banner, not for progress. A run that wrote three
plans is one line at the end, not one line a plan.
"""

import contextlib
import datetime as dt
import json
import os
import sys

try:
    import fcntl
except ImportError:          # no flock off a Unix; appends then rely on os.replace alone
    fcntl = None

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAX_QUEUED = 20


def queue_path(dataset=None):
    if not dataset:
        sys.path.insert(0, os.path.join(ROOT, "core"))
        import dataset as _dataset
        dataset = _dataset.current(os.path.join(ROOT, "data"))
    return os.path.join(ROOT, "data", dataset, "notify-queue.json")


@contextlib.contextmanager
def queue_lock(path):
    """An exclusive lock on `notify-queue.lock` beside the queue file, shared
    with the board server's drain (core/notify_due.py), so an append and a drain
    take turns. Never raises: a lock that cannot be had is no reason to lose the
    line, so the append goes ahead without it."""
    fh = None
    if fcntl is not None:
        try:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            fh = open(os.path.splitext(path)[0] + ".lock", "a")
            fcntl.flock(fh, fcntl.LOCK_EX)
        except OSError:
            if fh:
                fh.close()
            fh = None
    try:
        yield
    finally:
        if fh:
            fcntl.flock(fh, fcntl.LOCK_UN)
            fh.close()


def queue(title, body, dataset=None, task=None, view=None, path=None):
    """Append one notification. Returns the path, or None if it could not be written.

    `task` and `view` are where the banner goes when it is pressed, and are
    left out of the entry entirely when empty rather than written as null — the
    companion treats a missing key and an empty one the same way, and an entry
    with nothing to say about where it points should not carry the keys.

    `path` names the queue file outright, for a caller that already resolves
    its dataset folder itself (core/agent_runs.py, under $TODOS_DATA_ROOT).

    Never raises. A caller asking for a banner is never doing it as its main job,
    so a failure here must not take down whatever was actually being done.
    """
    path = path or queue_path(dataset)
    with queue_lock(path):
        try:
            with open(path, encoding="utf-8") as fh:
                items = json.load(fh)
            if not isinstance(items, list):
                items = []
        except (OSError, ValueError):
            items = []

        entry = {
            "title": str(title)[:120],
            "body": str(body)[:400],
            "queued": dt.datetime.now().isoformat(timespec="seconds"),
        }
        if task:
            entry["task"] = str(task)[:200]
        if view:
            entry["view"] = str(view)[:40]
        items.append(entry)
        # A queue nobody drains is a companion that is not running. Cap it so that
        # comes back as the last few lines when it starts, rather than as a month of
        # backlog fired at once.
        items = items[-MAX_QUEUED:]

        try:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            tmp = path + ".tmp"
            with open(tmp, "w", encoding="utf-8", newline="") as fh:
                json.dump(items, fh, indent=2)
            os.replace(tmp, path)
        except OSError:
            return None
    return path


def main(argv):
    opts = {"--dataset": None, "--task": None, "--view": None}
    while len(argv) > 1 and argv[0] in opts:
        opts[argv[0]], argv = argv[1], argv[2:]
    if len(argv) < 2:
        print(__doc__.strip().splitlines()[0], file=sys.stderr)
        print('usage: notify.py [--dataset NAME] [--task KEY] [--view NAME] '
              '"Title" "Body"', file=sys.stderr)
        return 2
    path = queue(argv[0], argv[1], opts["--dataset"],
                 task=opts["--task"], view=opts["--view"])
    if not path:
        print("could not write the queue", file=sys.stderr)
        return 1
    print("queued — the board server posts it within a minute, in the "
          "08:30 to 20:00 window, while the board is running")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
