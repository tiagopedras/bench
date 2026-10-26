#!/usr/bin/env python3
"""notify_due.py on a fake clock and a fake calendar.

    python3 core/test_notify_due.py

Nothing here posts a banner: `post` is a list that remembers what it was given.
"""

import datetime as dt
import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import notify_due
import todo

D = dt.date
failures = 0


def check(name, got, want):
    global failures
    if got != want:
        print("FAIL %s\n     got  %r\n     want %r" % (name, got, want))
        failures += 1


# 2026-10-26 is a Monday. Mon 2 Nov is made a holiday, as is Sat/Sun as ever.
HOLIDAYS = {D(2026, 11, 2)}


def working(day):
    return day.weekday() < 5 and day not in HOLIDAYS


def at(day, hhmm="09:00"):
    h, m = hhmm.split(":")
    return dt.datetime.combine(day, dt.time(int(h), int(m)))


def doc(*lines):
    return "\n".join(["# To-do", "", "## 1. Work", "", "### Doing", ""] + list(lines) + [""])


def banners(text, now, fired=()):
    return notify_due.due_banners(todo.parse_doc(text), now, working, set(fired), "Work")


def summary(bs):
    return [(b["title"], b["body"]) for b in bs]


MON, TUE, FRI, SAT = D(2026, 10, 26), D(2026, 10, 27), D(2026, 10, 30), D(2026, 10, 31)

t = doc("- [ ] **Call Ana** [due:: 2026-10-26] [time:: 15:00]")
check("timed task: nothing before its time", banners(t, at(MON, "14:59")), [])
check("timed task: fires at its time", summary(banners(t, at(MON, "15:00"))), [("Call Ana", "Due 15:00 · Work")])

u = doc("- [ ] **Send report** [due:: 2026-10-26]")
check("untimed: quiet before 09:00", banners(u, at(MON, "08:59")), [])
check("untimed: 09:00", summary(banners(u, at(MON, "09:00"))), [("Send report", "Due today · Work")])

s = doc("- [ ] **Parent** `#parent`", "  - [ ] Book room [due:: 2026-10-26] [time:: 10:15]", "  - [ ] No date of its own")
b = banners(s, at(MON, "10:15"))
check("sub-task: own date and time, linked to its task", [(x["title"], x["body"], x["task"]) for x in b],
      [("Book room", "Due 10:15 · Work", "parent")])
check("sub-task: a parent's date is not copied down",
      banners(doc("- [ ] **P** [due:: 2026-10-26]", "  - [ ] child"), at(MON, "09:00"))[0]["title"], "P")

r = doc("- [ ] **1:1** [due:: 2026-10-28] `repeat:wed-9:15`")
check("repeat task: the rule's time", summary(banners(r, at(D(2026, 10, 28), "09:15"))), [("1:1", "Due 09:15 · Work")])
r2 = doc("- [ ] **1:1** [due:: 2026-10-21] `repeat:wed-9:15`")
check("repeat task: a stale date rolls to the next occurrence",
      summary(banners(r2, at(D(2026, 10, 28), "09:20"))), [("1:1", "Due 09:15 · Work")])

done = doc("- [x] **Done one** [due:: 2026-10-26] `done:2026-10-26`", "- [ ] **Open** [due:: 2026-10-26]", "  - [x] ticked step [due:: 2026-10-26]",
           "### Done", "- [ ] **In Done** [due:: 2026-10-26]")
check("done tasks, tasks under Done and ticked sub-tasks are skipped",
      [x["title"] for x in banners(done, at(MON, "12:00"))], ["Open"])

o = doc("- [ ] **Late** [due:: 2026-10-26]")
first = banners(o, at(MON, "09:00"))
check("overdue: due banner on the day", [x["body"] for x in first], ["Due today · Work"])
check("overdue: the day after, one more", [x["body"] for x in banners(o, at(TUE, "09:00"), {first[0]["key"]})],
      ["Overdue since Mon 26 Oct · Work"])
check("overdue: not before 09:00", banners(o, at(TUE, "08:00")), [])
over = banners(o, at(TUE, "09:00"))
check("overdue: silent after that", banners(o, at(D(2026, 10, 28), "09:00"), {over[0]["key"]}), [])
check("overdue: silent the day after that, even unfired", banners(o, at(D(2026, 10, 28), "12:00")), [])

f = doc("- [ ] **Friday job** [due:: 2026-10-30]")
check("Friday due: fires Friday", len(banners(f, at(FRI, "09:00"))), 1)
check("Friday due: quiet on Saturday and Sunday",
      [banners(f, at(SAT, "10:00")), banners(f, at(D(2026, 11, 1), "10:00"))], [[], []])
check("Friday due: overdue lands on Tuesday when Monday is a holiday",
      [len(banners(f, at(D(2026, 11, 2), "10:00"))), len(banners(f, at(D(2026, 11, 3), "09:00")))], [0, 1])

w = doc("- [ ] **Weekend job** [due:: 2026-10-31] [time:: 15:00]")
check("due on a Saturday: quiet that day", banners(w, at(SAT, "15:00")), [])
check("due on a Saturday: Monday 09:00 (not its own time)", banners(w, at(D(2026, 11, 2), "09:00")), [])
check("due on a Saturday with a holiday Monday: Tuesday 09:00, as an overdue",
      summary(banners(w, at(D(2026, 11, 3), "09:00"))), [("Weekend job", "Overdue since Sat 31 Oct · Work")])
check("due on a Saturday: once", banners(w, at(D(2026, 11, 3), "09:30"), {banners(w, at(D(2026, 11, 3), "09:00"))[0]["key"]}), [])

h = doc("- [ ] **Bank holiday job** [due:: 2026-11-02]")
check("due on a holiday: quiet on it, out the next working day",
      [len(banners(h, at(D(2026, 11, 2), "12:00"))), len(banners(h, at(D(2026, 11, 3), "09:00")))], [0, 1])

c = doc("- [ ] **Morning** [due:: 2026-10-26] [time:: 09:30]", "- [ ] **Noon** [due:: 2026-10-26] [time:: 12:00]",
        "- [ ] **Later** [due:: 2026-10-26] [time:: 17:00]")
check("catch-up: a late start sends what was owed earlier today, in order, and not what is still to come",
      [x["title"] for x in banners(c, at(MON, "13:00"))], ["Morning", "Noon"])
check("catch-up: nothing from earlier days is replayed", banners(o, at(D(2026, 10, 28), "13:00")), [])

# Restart: state on disk, no double-fire.
with tempfile.TemporaryDirectory() as root:
    bdir = os.path.join(root, "work-and-career")
    os.makedirs(bdir)
    with open(os.path.join(bdir, "todo.md"), "w") as fh:
        fh.write(t)
    posted = []

    def post(title, body, task, view, group):
        posted.append((title, body, task, view, group))
        return True

    n = notify_due.run_tick(root, ["work-and-career"], at(MON, "15:01"), working, post)
    check("tick: one banner, labelled with the board", (n, posted[0][:3]), (1, ("Call Ana", "Due 15:00 · Work and career", "Call Ana")))
    check("tick: its group is its fired key", posted[0][4], "2026-10-26|Call Ana|due")
    n = notify_due.run_tick(root, ["work-and-career"], at(MON, "15:02"), working, post)
    check("tick: not again", n, 0)
    n = notify_due.run_tick(root, ["work-and-career"], at(MON, "16:00"), working, post)
    check("restart: state read back from the file, still not again", n, 0)
    check("state file keeps the key", json.load(open(os.path.join(bdir, "notify-state.json")))["fired"], ["2026-10-26|Call Ana|due"])

    failed = []
    n = notify_due.run_tick(root, ["work-and-career"], at(TUE, "09:00"), working, lambda *a: failed.append(a) and False)
    check("a banner that fails to post is tried again", (n, len(failed)), (0, 1))

    old = {"2026-10-01|x|due", "2026-10-20|y|due"}
    check("prune: entries older than 14 days go", sorted(notify_due.prune(old, MON)), ["2026-10-20|y|due"])

    # Queue drain.
    q = os.path.join(bdir, "notify-queue.json")
    lines = [{"title": "Plan agent", "body": "3 plans", "view": "plans"}, {"title": "A", "body": "", "task": "x"},
             {"title": "B", "body": "b", "task": "slug"}, {"body": "no title"}, {"title": "Z", "body": "left"}]
    json.dump(lines, open(q, "w"))
    got = notify_due.drain_queue(bdir, "work-and-career", at(MON, "07:00"))
    check("queue: held before 08:30", (got, len(json.load(open(q)))), ([], 5))
    got = notify_due.drain_queue(bdir, "work-and-career", at(MON, "10:00"))
    check("queue: three taken, an empty body dropped", got, [("Plan agent", "3 plans", None, "plans"), ("B", "b", "slug", None)])
    check("queue: the rest stays", [e.get("title") for e in json.load(open(q))], [None, "Z"])
    got = notify_due.drain_queue(bdir, "work-and-career", at(MON, "10:01"))
    check("queue: next tick takes the rest, title defaulted", got, [("To-do", "no title", None, None), ("Z", "left", None, None)])
    json.dump([{"title": "N", "body": "night"}], open(q, "w"))
    check("queue: the content board has no window", len(notify_due.drain_queue(bdir, "content", at(MON, "02:00"))), 1)

check("url: card", notify_due.board_url("http://h/k", "My task!"), "http://h/k#!task=My%20task%21")
check("url: view and card", notify_due.board_url("http://h/k", "s", "plans"), "http://h/k#plans!task=s")
check("url: neither", notify_due.board_url("http://h/k"), "http://h/k")

os.environ["BENCH_NOTIFY"] = "0"
check("BENCH_NOTIFY=0 keeps it off", notify_due.start("/x", list, tuple, "u"), None)

print("notify_due — %s" % ("all agree" if not failures else "%d failed" % failures))
raise SystemExit(1 if failures else 0)
