#!/usr/bin/env python3
"""Who is signed in, and which boards they may see, when Bench is shared.

Off by default. `$BENCH_AUTH` unset or empty is the Mac board as it has always
been: nobody signs in, every board is visible, and `data/.current` says which
one is on screen. `BENCH_AUTH=header` is the server behind nginx. nginx asks
the sign-in service who the visitor is and passes the answer on in three
headers, and kanban/server.py refuses any request that arrives without one.
Any other value refuses to start, so a typo cannot leave a public board open.

    X-Offdesk-Email   the person's address, the identity everything keys on
    X-Offdesk-Name    their name, percent-encoded UTF-8
    X-Offdesk-Teams   the team ids they belong to, comma separated

Team membership comes from that header and from nowhere else. The list of
who is in which team is the sign-in service's (teams.json in
ai-agency-server), so Bench keeps no copy that could disagree with it.

Each board says who may see it in `data/<board>/access.json`:

    {"owner": "a@example.com", "people": ["b@example.com"], "teams": ["offdesk"]}

Written by the server when a board is made or its sharing changes, and by
scripts/set-board-access.py for a board that existed before sign-in did.
With sign-in on, a board without the file, or with one that does not parse, is
visible to nobody: a board is opened up on purpose, never by accident. With it
off the file is not read at all.

Which board each person has on screen is theirs alone, in
`data/users/<email>.json`, so one person switching boards does not switch
anybody else's.
"""

import json
import os
import re
import tempfile

FILE = "access.json"
USERS = "users"
# Folders under data/ that are not boards and must never become one: a board
# called `users` would hold everyone's choice of board, and `agents` holds the
# agents engine's budgets.
RESERVED = (USERS, "agents")

EMAIL_RE = re.compile(r"^[^@\s,]+@[^@\s,]+\.[^@\s,]+$")
TEAM_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")


def mode():
    """"header" when Bench is signed in to through nginx, None when it is not.

    Raises ValueError for anything else, which the server turns into a refusal
    to start."""
    raw = (os.environ.get("BENCH_AUTH") or "").strip()
    if not raw:
        return None
    if raw == "header":
        return "header"
    raise ValueError("BENCH_AUTH=%s is not a mode Bench knows; use header, or unset it" % raw)


def email(raw):
    """An address as compared everywhere here, or None when it is not one."""
    s = str(raw or "").strip().lower()
    if len(s) > 254 or not EMAIL_RE.match(s):
        return None
    return s


def teams(raw):
    """Team ids out of a comma list, or out of a list, cleaned and deduplicated."""
    parts = raw.split(",") if isinstance(raw, str) else (raw or [])
    out = []
    for p in parts:
        t = str(p).strip().lower()
        if TEAM_RE.match(t) and t not in out:
            out.append(t)
    return out


def path(board_dir):
    return os.path.join(board_dir, FILE)


def read(board_dir):
    """The board's access as {owner, people, teams}, or None when it has none.

    A file that does not parse, or names no owner, counts as none."""
    try:
        with open(path(board_dir), encoding="utf-8") as fh:
            raw = json.load(fh)
    except (OSError, ValueError):
        return None
    if not isinstance(raw, dict) or not email(raw.get("owner")):
        return None
    people = raw.get("people") if isinstance(raw.get("people"), list) else []
    return {
        "owner": email(raw.get("owner")),
        "people": [e for e in (email(p) for p in people) if e],
        "teams": teams(raw.get("teams") if isinstance(raw.get("teams"), list) else []),
    }


def clean(owner, people=(), team_ids=()):
    """An access record from what a form or a command sent, or (None, error)."""
    o = email(owner)
    if not o:
        return None, "the owner needs to be an email address"
    if not isinstance(people, (list, tuple)) or not isinstance(team_ids, (list, tuple)):
        return None, "people and teams need to be lists"
    out = []
    for p in people:
        e = email(p)
        if not e:
            return None, "%s is not an email address" % str(p)[:80]
        if e != o and e not in out:
            out.append(e)
    ts = []
    for t in team_ids:
        got = teams([t])
        if not got:
            return None, "%s is not a team id" % str(t)[:80]
        if got[0] not in ts:
            ts.append(got[0])
    return {"owner": o, "people": out, "teams": ts}, None


def write(board_dir, record):
    """Write access.json whole, through a temp file so a crash leaves the old one."""
    os.makedirs(board_dir, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=board_dir, prefix=".access-")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump({"owner": record["owner"], "people": list(record["people"]),
                       "teams": list(record["teams"])}, fh, indent=2)
            fh.write("\n")
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path(board_dir))
    except OSError:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def can_see(access, who):
    """Whether `who` ({email, teams}) may see a board with this access record."""
    if not access or not who or not who.get("email"):
        return False
    if who["email"] == access["owner"] or who["email"] in access["people"]:
        return True
    return bool(set(who.get("teams") or ()) & set(access["teams"]))


def user_path(data_root, address):
    """data/users/<email>.json. The address is already checked by email(), so
    the only characters left that could matter in a file name are swapped."""
    slug = re.sub(r"[^a-z0-9@._+-]", "_", address).lstrip(".")
    return os.path.join(data_root, USERS, slug + ".json")


def read_current(data_root, address):
    """The board this person last had on screen, or "" for none recorded."""
    try:
        with open(user_path(data_root, address), encoding="utf-8") as fh:
            got = json.load(fh)
    except (OSError, ValueError):
        return ""
    return str(got.get("current") or "") if isinstance(got, dict) else ""


def write_current(data_root, address, name):
    target = user_path(data_root, address)
    os.makedirs(os.path.dirname(target), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(target), prefix=".user-")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump({"current": name}, fh)
            fh.write("\n")
        os.replace(tmp, target)
    except OSError:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
