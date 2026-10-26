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
      [len(banners(f, at(D(2026, 11, 2), "10:00"))), summary(banners(f, at(D(2026, 11, 3), "09:00")))],
      [0, [("Friday job", "Overdue since Fri 30 Oct \u00b7 Work")]])

w = doc("- [ ] **Weekend job** [due:: 2026-10-31] [time:: 15:00]")
check("due on a Saturday: quiet that day", banners(w, at(SAT, "15:00")), [])
check("due on a Saturday: Monday 09:00 (not its own time)", banners(w, at(D(2026, 11, 2), "09:00")), [])
check("due on a Saturday with a holiday Monday: Tuesday 09:00, as an overdue",
      summary(banners(w, at(D(2026, 11, 3), "09:00"))), [("Weekend job", "Overdue since Sat 31 Oct · Work")])
check("due on a Saturday: once", banners(w, at(D(2026, 11, 3), "09:30"), {banners(w, at(D(2026, 11, 3), "09:00"))[0]["key"]}), [])
sat = doc("- [ ] **Plain Saturday** [due:: 2026-10-24]")
check("plain Saturday: quiet on the Saturday and Sunday",
      [banners(sat, at(D(2026, 10, 24), "12:00")), banners(sat, at(D(2026, 10, 25), "12:00"))], [[], []])
mon = banners(sat, at(MON, "09:00"))
check("plain Saturday: one banner on the Monday, already saying overdue",
      summary(mon), [("Plain Saturday", "Overdue since Sat 24 Oct \u00b7 Work")])
check("plain Saturday: nothing further on the Tuesday, fired or not",
      [banners(sat, at(TUE, "09:00"), {mon[0]["key"]}), banners(sat, at(TUE, "12:00"))], [[], []])

h = doc("- [ ] **Bank holiday job** [due:: 2026-11-02]")
check("due on a holiday: quiet on it, out the next working day as overdue",
      [len(banners(h, at(D(2026, 11, 2), "12:00"))), summary(banners(h, at(D(2026, 11, 3), "09:00")))],
      [0, [("Bank holiday job", "Overdue since Mon 2 Nov \u00b7 Work")]])
check("due on a holiday: nothing the day after that",
      banners(h, at(D(2026, 11, 4), "09:00")), [])

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
    logs = []

    def post(title, body, task, view, group, board):
        posted.append((title, body, task, view, group, board))
        return True, "exit 0"

    def tick(now, poster=post, retries=None):
        return notify_due.run_tick(root, ["work-and-career"], now, working, poster, retries=retries, log=logs.append)

    n = tick(at(MON, "15:01"))
    check("tick: one banner, labelled with the board", (n, posted[0][:3]), (1, ("Call Ana", "Due 15:00 \u00b7 Work and career", "Call Ana")))
    check("tick: its group is its fired key", posted[0][4], "2026-10-26|Call Ana|due")
    check("tick: not again", tick(at(MON, "15:02")), 0)
    check("restart: state read back from the file, still not again", tick(at(MON, "16:00")), 0)
    check("state file keeps the key", json.load(open(os.path.join(bdir, "notify-state.json")))["fired"], ["2026-10-26|Call Ana|due"])

    # Failed posts: retried every 10 minutes at most, first failure per key logged.
    os.remove(os.path.join(bdir, "notify-state.json"))
    calls, retries = [], {}

    def failing(*a):
        calls.append(a)
        return False, "exit 1"

    tick(at(MON, "15:01"), failing, retries)
    tick(at(MON, "15:02"), failing, retries)
    tick(at(MON, "15:10"), failing, retries)
    check("failed post: not retried inside 10 minutes", len(calls), 1)
    tick(at(MON, "15:11"), failing, retries)
    tick(at(MON, "15:25"), failing, retries)
    check("failed post: retried after 10 minutes", len(calls), 3)
    check("failed post: only the first failure is logged", logs, ["notify: Call Ana failed: exit 1"])
    check("failed post: succeeds later, then never again",
          (tick(at(MON, "15:40"), post, retries), tick(at(MON, "15:50"), post, retries)), (1, 0))

    old = {"2026-10-01|x|due", "2026-10-20|y|due"}
    check("prune: entries older than 14 days go", sorted(notify_due.prune(old, MON)), ["2026-10-20|y|due"])

    # Queue.
    q = os.path.join(bdir, "notify-queue.json")
    lines = [{"title": "Plan agent", "body": "3 plans", "view": "plans"}, {"title": "A", "body": "", "task": "x"},
             {"title": "B", "body": "b", "task": "slug"}, {"body": "no title"}, {"title": "Z", "body": "left"}]
    json.dump(lines, open(q, "w"))
    check("queue: held before 08:30", (notify_due.queue_batch(bdir, "work-and-career", at(MON, "07:00")), len(json.load(open(q)))), ([], 5))
    posted.clear()
    tick(at(MON, "10:00"))
    check("queue: three taken, an empty body dropped",
          [p[:4] for p in posted if p[0] != "Call Ana"], [("Plan agent", "3 plans", None, "plans"), ("B", "b", "slug", None)])
    check("queue: the rest stays", [e.get("title") for e in json.load(open(q))], [None, "Z"])
    posted.clear()
    tick(at(MON, "10:01"))
    check("queue: next tick takes the rest, title defaulted",
          [p[:4] for p in posted], [("To-do", "no title", None, None), ("Z", "left", None, None)])

    # A line comes off only once it has posted.
    json.dump([{"title": "K", "body": "keep"}, {"title": "G", "body": "go"}], open(q, "w"))
    only_g = lambda title, body, task, view, group, board: (title == "G", "exit 1")
    retries = {}
    tick(at(MON, "11:00"), only_g, retries)
    check("queue: a line that failed to post stays, the one that posted goes",
          [e["title"] for e in json.load(open(q))], ["K"])
    seen = []
    tick(at(MON, "11:05"), lambda *a: seen.append(a[0]) or (True, ""), retries)
    check("queue: a failed line waits out its 10 minutes", seen, [])
    tick(at(MON, "11:11"), lambda *a: seen.append(a[0]) or (True, ""), retries)
    check("queue: then goes", (seen, json.load(open(q))), (["K"], []))

    # A line appended while one is being posted survives the removal.
    json.dump([{"title": "First", "body": "1"}], open(q, "w"))

    def appends_meanwhile(title, body, task, view, group, board):
        cur = json.load(open(q))
        cur.append({"title": "Arrived", "body": "mid-post"})
        json.dump(cur, open(q, "w"))
        return True, ""

    tick(at(MON, "12:00"), appends_meanwhile)
    check("queue: a line appended during a post is kept", [e["title"] for e in json.load(open(q))], ["Arrived"])
    check("queue: removal is atomic, no temp file left", os.path.exists(q + ".tmp"), False)
    json.dump([{"title": "N", "body": "night"}], open(q, "w"))
    check("queue: the content board has no window", len(notify_due.queue_batch(bdir, "content", at(MON, "02:00"))), 1)

check("url: card", notify_due.board_url("http://h/k", "My task!"), "http://h/k#!task=My%20task%21")
check("url: view and card", notify_due.board_url("http://h/k", "s", "plans"), "http://h/k#plans!task=s")
check("url: board and card", notify_due.board_url("http://h/k", "My task", None, "work-and-career"),
      "http://h/k#!board=work-and-career!task=My%20task")
check("url: view, board and card", notify_due.board_url("http://h/k", "s", "plans", "a b"), "http://h/k#plans!board=a%20b!task=s")
check("url: a board alone", notify_due.board_url("http://h/k", None, None, "content"), "http://h/k#!board=content")
check("tick: the post names its board", {p[5] for p in posted}, {"work-and-career"})
check("url: neither", notify_due.board_url("http://h/k"), "http://h/k")

os.environ["BENCH_NOTIFY"] = "0"
check("BENCH_NOTIFY=0 keeps it off", notify_due.start("/x", list, tuple, "u"), None)

print("notify_due — %s" % ("all agree" if not failures else "%d failed" % failures))
raise SystemExit(1 if failures else 0)
