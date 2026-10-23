#!/usr/bin/env python3
"""Signed-in Bench: who is asking, and what the shared board leaves out.

    python3 kanban/test_board_access.py

No browser. It starts kanban/server.py itself, as a process, on free ports
(never 8765 or 8766) over a throwaway data root, once with BENCH_AUTH=header
and once without, and talks to it the way nginx would: three headers saying
who is signed in. The real data/ and data/.current are never read or written.

What it holds to:

  * signed in, a request without an email is refused, on every method;
  * /whoami says who nginx said, with the name decoded from percent-encoded UTF-8;
  * the parts that only work on the owner's Mac are refused, and so is a
    POST that a form on another site could send;
  * BENCH_AUTH unset is the Mac board exactly as before, and an unknown value
    refuses to start.
"""

import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVER = os.path.join(ROOT, "kanban", "server.py")

PASS = []
FAIL = []

TIAGO = {"X-Offdesk-Email": "tiagopedras+claude@gmail.com",
         "X-Offdesk-Name": "Tiago%20Pedras", "X-Offdesk-Teams": "offdesk"}
JEROME = {"X-Offdesk-Email": "jerome@example.com",
          "X-Offdesk-Name": "J%C3%A9r%C3%B4me", "X-Offdesk-Teams": "offdesk,other"}
BOARD = {"X-Board": "1", "Content-Type": "application/json"}


def ok(label, cond, detail=""):
    (PASS if cond else FAIL).append(label if cond else
                                    (label + (" — " + detail if detail else "")))


def free_port():
    while True:
        s = socket.socket()
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
        s.close()
        if port not in (8765, 8766):
            return port


def seed(data_root, name, text="# To-do\n\n## 1. Tasks\n\n### To do\n\n- [ ] A task\n"):
    os.makedirs(os.path.join(data_root, name, "backups"), exist_ok=True)
    with open(os.path.join(data_root, name, "todo.md"), "w", encoding="utf-8") as fh:
        fh.write(text)


class Server:
    """kanban/server.py in a process of its own, over `data_root`."""

    def __init__(self, data_root, auth):
        self.port = free_port()
        self.base = "http://127.0.0.1:%d" % self.port
        env = dict(os.environ, TODOS_DATA_ROOT=data_root, TODOS_PORT=str(self.port),
                   TODOS_NO_BROWSER="1")
        env.pop("BENCH_AUTH", None)
        if auth is not None:
            env["BENCH_AUTH"] = auth
        self.proc = subprocess.Popen([sys.executable, SERVER], env=env, cwd=ROOT,
                                     stdout=subprocess.PIPE, stderr=subprocess.STDOUT)

    def wait(self):
        for _ in range(100):
            if self.proc.poll() is not None:
                return False
            try:
                socket.create_connection(("127.0.0.1", self.port), timeout=0.2).close()
                return True
            except OSError:
                time.sleep(0.1)
        return False

    def stop(self):
        if self.proc.poll() is None:
            self.proc.terminate()
            self.proc.wait(timeout=5)
        out = self.proc.stdout.read().decode("utf-8", "replace")
        self.proc.stdout.close()
        return out

    def ask(self, method, path, headers=None, body=None):
        data = body if isinstance(body, bytes) else (json.dumps(body).encode() if body is not None else None)
        req = urllib.request.Request(self.base + path, method=method, data=data,
                                     headers=headers or {})
        try:
            with urllib.request.urlopen(req) as res:
                return res.status, res.read().decode("utf-8"), res.headers
        except urllib.error.HTTPError as err:
            return err.code, err.read().decode("utf-8"), err.headers


def as_json(text):
    try:
        return json.loads(text)
    except ValueError:
        return None


def signed_in_checks(root):
    data = os.path.join(root, "signed-in")
    seed(data, "offdesk")
    srv = Server(data, "header")
    ok("signed-in server starts", srv.wait())
    try:
        # --- nobody signed in ---------------------------------------------------
        for method, path in (("GET", "/kanban/index.html"), ("GET", "/data/todo.md"),
                             ("HEAD", "/data/todo.md"), ("GET", "/datasets.json"),
                             ("GET", "/whoami"), ("POST", "/datasets"),
                             ("PUT", "/data/todo.md")):
            code, body, _ = srv.ask(method, path, headers=dict(BOARD) if method != "GET" else None,
                                    body={} if method in ("POST", "PUT") else None)
            ok("no email: %s %s is 401" % (method, path), code == 401, "got %d" % code)
        code, _, _ = srv.ask("GET", "/whoami", {"X-Offdesk-Email": "not an address"})
        ok("an email that is not one is 401", code == 401, "got %d" % code)

        # --- who is signed in ---------------------------------------------------
        code, body, _ = srv.ask("GET", "/whoami", JEROME)
        who = as_json(body) or {}
        ok("/whoami answers", code == 200, "got %d" % code)
        ok("/whoami has the email", who.get("email") == "jerome@example.com", body)
        ok("/whoami decodes the name", who.get("name") == "Jérôme", body)
        ok("/whoami has the teams", who.get("teams") == ["offdesk", "other"], body)
        code, body, _ = srv.ask("GET", "/owner.js", JEROME)
        ok("owner.js names whoever is signed in", "J\\u00e9r\\u00f4me" in body, body)
        code, body, _ = srv.ask("GET", "/profile-basics.json", JEROME)
        ok("no profile setup for a visitor", (as_json(body) or {}).get("needs_setup") is False, body)

        # --- the Mac-only parts ---------------------------------------------------
        for method, path in (("GET", "/schedule.json"), ("GET", "/usage.json"),
                             ("GET", "/agents-api/state.json"), ("POST", "/agents-api/run"),
                             ("POST", "/project/open"), ("POST", "/project-folders"),
                             ("POST", "/planning_agent/run"), ("GET", "/claude.json"),
                             ("POST", "/claude"), ("GET", "/ai-chat/ai-chat.js")):
            code, _, _ = srv.ask(method, path, dict(TIAGO, **BOARD),
                                 body={} if method == "POST" else None)
            ok("signed in: %s %s is refused" % (method, path), code == 404, "got %d" % code)
        for path in ("/settings.json", "/profile-basics.json"):
            code, _, _ = srv.ask("PUT", path, dict(TIAGO, **BOARD), body={"name": "x"})
            ok("signed in: PUT %s is refused" % path, code == 403, "got %d" % code)

        # A form on another site can POST with the cookie but not with X-Board.
        code, _, _ = srv.ask("POST", "/archive", dict(TIAGO, **{"Content-Type": "text/plain"}),
                             body=b'{"text": "x"}')
        ok("signed in: a POST without X-Board is refused", code == 403, "got %d" % code)
    finally:
        srv.stop()


def mac_checks(root):
    data = os.path.join(root, "mac")
    seed(data, "personal")
    srv = Server(data, None)
    ok("Mac server starts", srv.wait())
    try:
        code, body, _ = srv.ask("GET", "/data/todo.md")
        ok("Mac: the list reads with no headers", code == 200 and "A task" in body, "got %d" % code)
        code, _, _ = srv.ask("GET", "/whoami")
        ok("Mac: /whoami is 404", code == 404, "got %d" % code)
        code, body, _ = srv.ask("GET", "/datasets.json")
        ok("Mac: /datasets.json lists the board", (as_json(body) or {}).get("datasets") == ["personal"], body)
        code, _, _ = srv.ask("GET", "/schedule.json")
        ok("Mac: /schedule.json still answers", code == 200, "got %d" % code)
        code, _, _ = srv.ask("POST", "/archive", {"Content-Type": "text/plain"}, body=b'{"text": "x"}')
        ok("Mac: /archive still takes a POST without X-Board", code == 200, "got %d" % code)
    finally:
        srv.stop()


def refusal_checks(root):
    srv = Server(os.path.join(root, "typo"), "headers")
    started = srv.wait()
    out = srv.stop()
    ok("an unknown BENCH_AUTH refuses to start", not started and "BENCH_AUTH" in out, out[-300:])


def main():
    root = tempfile.mkdtemp(prefix="board-access-test-")
    try:
        signed_in_checks(root)
        mac_checks(root)
        refusal_checks(root)
    finally:
        shutil.rmtree(root, ignore_errors=True)

    print("\n%d passed" % len(PASS))
    for f in FAIL:
        print("  FAIL  " + f)
    if FAIL:
        print("\n%d failed\n" % len(FAIL))
        sys.exit(1)
    print("")


if __name__ == "__main__":
    main()
