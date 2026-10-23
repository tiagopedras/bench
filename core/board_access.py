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
"""

import os
import re

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
