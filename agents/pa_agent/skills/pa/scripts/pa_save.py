#!/usr/bin/env python3
"""The PA's one way to write a board: through the board server's own save.

Usage:
    python3 pa_save.py pull <board>    # prints the path of a copy to edit
    python3 pa_save.py push <board>    # saves the edited copy
    python3 pa_save.py drop <board>    # throws an unsaved copy away

`pull` reads the board's todo.md from the server and leaves two files in a
folder of their own: `todo.md`, which the PA edits with the Edit tool and
checks with check_todo.py, and `base.md`, the version it was read as. `push`
sends both as `{text, base}`, the way a browser tab saves, so the server
three-way merges the edit with anything somebody saved in between
(todo.merge_saves()). A save that changed the same thing as the PA's comes
back as a 409: the conflicts are printed, the server's version is left beside
the copy as `theirs.md`, nothing is written, and the exit is 1. Pull again and
redo the change on what is there now. Any other refusal is printed as the
server worded it, exit 2.

Writing todo.md straight to disk lost any save that landed between the PA's
read and its write, and a PA on the Mac had no way to reach the shared board
but root SSH. Going through the save closes both.

Which server:
    --url, or $PA_SAVE_URL, default http://127.0.0.1:8765 (the Mac board).

The board is named in an X-Offdesk-Board header on every request, and the
server holds the request to that board (pinned_board() in kanban/server.py),
so on the Mac the PA saves a board that is not the one on screen without
switching it. On the shared board nginx replaces the header with the board
the PA's token is for, so naming another one gets a refusal, never a write.
Either way the server says which board it served, and a copy of any other
board is refused here before it is edited.

The token, for the shared board only:
    --keychain-service and --keychain-account, or $PA_SAVE_KEYCHAIN_SERVICE
    and $PA_SAVE_KEYCHAIN_ACCOUNT, name a macOS Keychain item, read on every
    run with `security find-generic-password -w` and sent as a bearer token.
    It is never written to a file, printed, or passed on a command line. A
    host other than this Mac needs https and a token, or nothing is sent.

The copies live in data/.pa-save/<host>/<board>/, private like the rest of
data/ and a dot folder, so no route serves it and no board list counts it.
$PA_SAVE_DIR puts them elsewhere.
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.realpath(__file__))
BENCH_ROOT = os.environ.get("BENCH_ROOT") or os.path.abspath(os.path.join(HERE, *[".."] * 5))
DEFAULT_URL = "http://127.0.0.1:8765"
LOCAL_HOSTS = ("127.0.0.1", "localhost", "::1")
TARGET = "/data/todo.md"
TIMEOUT = 30


class Refused(Exception):
    """Something this script will not do, worded for the PA to pass on."""


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    # Signed out, nginx answers with a redirect to the sign-in page, and
    # following it would hand back a page of HTML with a 200.
    def redirect_request(self, *a, **kw):
        return None


_opener = urllib.request.build_opener(_NoRedirect)


def keychain_token(service, account):
    try:
        got = subprocess.run(["security", "find-generic-password", "-s", service, "-a", account, "-w"],
                             capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.TimeoutExpired) as err:
        raise Refused("could not read the Keychain: %s" % err)
    token = got.stdout.strip()
    if got.returncode != 0 or not token:
        raise Refused("no Keychain item for service %s, account %s" % (service, account))
    return token


class Board:
    def __init__(self, name, url, service, account):
        self.name = name
        self.url = url.rstrip("/")
        parts = urllib.parse.urlsplit(self.url)
        if parts.scheme not in ("http", "https") or not parts.hostname:
            raise Refused("%s is not a server address" % url)
        local = parts.hostname in LOCAL_HOSTS
        self.token = None
        if service or account:
            if not (service and account):
                raise Refused("the Keychain item needs both a service and an account")
            if not local and parts.scheme != "https":
                raise Refused("a token only goes to %s over https" % parts.hostname)
            self.token = keychain_token(service, account)
        elif not local:
            raise Refused("%s is not this Mac, so it needs a token from the Keychain" % parts.hostname)
        root = os.environ.get("PA_SAVE_DIR") or os.path.join(BENCH_ROOT, "data", ".pa-save")
        host = "local" if local else parts.hostname
        self.dir = os.path.join(root, host, name)
        self.copy = os.path.join(self.dir, "todo.md")
        self.base = os.path.join(self.dir, "base.md")
        self.theirs = os.path.join(self.dir, "theirs.md")

    def ask(self, method, body=None):
        """(status, headers, bytes) for one request to the list."""
        headers = {"X-Offdesk-Board": self.name}
        if self.token:
            headers["Authorization"] = "Bearer " + self.token
        data = None
        if body is not None:
            data = json.dumps(body, ensure_ascii=False).encode("utf-8")
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(self.url + TARGET, method=method, data=data, headers=headers)
        try:
            with _opener.open(req, timeout=TIMEOUT) as res:
                return res.status, res.headers, res.read()
        except urllib.error.HTTPError as err:
            return err.code, err.headers, err.read()
        except (urllib.error.URLError, OSError) as err:
            raise Refused("could not reach %s: %s" % (self.url, getattr(err, "reason", err)))


def read(path):
    try:
        with open(path, encoding="utf-8", newline="") as fh:
            return fh.read()
    except FileNotFoundError:
        return None


def write(path, text):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="") as fh:
        fh.write(text)
    os.replace(tmp, path)


def unsaved(b):
    copy, base = read(b.copy), read(b.base)
    return copy is not None and base is not None and copy != base


def refusal(status, raw):
    """The server's own words for a refusal, or the status when it sent none."""
    if status in (301, 302, 303, 307, 308):
        return "%d, sent to sign in: the token was refused or has expired" % status
    if status == 401:
        return "401, not signed in: the token was refused or has expired"
    try:
        got = json.loads(raw.decode("utf-8"))
        if isinstance(got, dict) and got.get("error"):
            return "%d, %s" % (status, got["error"])
    except (UnicodeDecodeError, ValueError):
        pass
    return "%d from the server" % status


def cmd_pull(b, args):
    if unsaved(b) and not args.discard:
        raise Refused("%s holds an edit that was never saved. Push it, or pull --discard to lose it" % b.copy)
    status, headers, raw = b.ask("GET")
    if status != 200:
        raise Refused(refusal(status, raw))
    served = headers.get("X-Bench-Board")
    if served != b.name:
        raise Refused("asked for %s and the server sent %s, so nothing was pulled"
                      % (b.name, served or "a list without saying which"))
    text = raw.decode("utf-8")
    os.makedirs(b.dir, exist_ok=True)
    if os.path.exists(b.theirs):
        os.remove(b.theirs)
    write(b.base, text)
    write(b.copy, text)
    print(b.copy)
    return 0


def cmd_push(b, args):
    text, base = read(b.copy), read(b.base)
    if text is None or base is None:
        raise Refused("nothing pulled for %s yet" % b.name)
    if text == base:
        shutil.rmtree(b.dir, ignore_errors=True)
        print("nothing changed on %s, nothing saved" % b.name)
        return 0
    status, _, raw = b.ask("PUT", {"text": text, "base": base})
    try:
        got = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        got = {}
    if status == 200 and isinstance(got, dict) and got.get("ok"):
        if got.get("board") != b.name:
            # Cannot happen while the server honours the pin, and worth saying
            # loudly if it ever does, since the edit has landed somewhere.
            print("saved, but into %s rather than %s" % (got.get("board"), b.name), file=sys.stderr)
            return 2
        shutil.rmtree(b.dir, ignore_errors=True)
        print("saved %s%s" % (b.name, ", merged with a save made since the pull" if got.get("merged") else ""))
        return 0
    if status == 409 and isinstance(got, dict) and got.get("conflicts"):
        if isinstance(got.get("current"), str):
            write(b.theirs, got["current"])
        print("not saved: somebody changed the same thing on %s since the pull" % b.name, file=sys.stderr)
        for c in got["conflicts"]:
            where = c.get("task") or "the top or bottom of the file"
            if c.get("step"):
                where += " > " + c["step"]
            print("  %s: %s" % (where, c.get("field") or "the whole task"), file=sys.stderr)
        print("Their version is %s. Pull again and redo the change." % b.theirs, file=sys.stderr)
        return 1
    if status == 409:
        print("not saved: %s" % refusal(status, raw), file=sys.stderr)
        return 1
    raise Refused("not saved: " + refusal(status, raw))


def cmd_drop(b, args):
    shutil.rmtree(b.dir, ignore_errors=True)
    print("dropped the copy of %s" % b.name)
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name, fn, about in (("pull", cmd_pull, "read the board into a copy to edit"),
                            ("push", cmd_push, "save the edited copy"),
                            ("drop", cmd_drop, "throw the copy away")):
        p = sub.add_parser(name, help=about)
        p.add_argument("board", help="the board's name, its folder under data/")
        p.add_argument("--url", default=os.environ.get("PA_SAVE_URL") or DEFAULT_URL)
        p.add_argument("--keychain-service", default=os.environ.get("PA_SAVE_KEYCHAIN_SERVICE") or "")
        p.add_argument("--keychain-account", default=os.environ.get("PA_SAVE_KEYCHAIN_ACCOUNT") or "")
        if name == "pull":
            p.add_argument("--discard", action="store_true", help="pull over an edit that was never saved")
        p.set_defaults(func=fn)
    args = ap.parse_args(argv)
    try:
        b = Board(args.board, args.url, args.keychain_service, args.keychain_account)
        return args.func(b, args)
    except Refused as err:
        print("pa_save: %s" % err, file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
