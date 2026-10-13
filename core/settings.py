#!/usr/bin/env python3
"""One settings file per checkout, read the same way by every Python caller.

`data/settings.json` (template: `core/settings.example.json`) holds
which model each job runs on. Git ignores it. Missing,
unreadable or invalid, every function here answers as if it were empty, and
nothing raises.

    {"version": 1,
     "models": {"default": null, "plan": null, "implement": null,
                "chat": null, "brief": null, "planner": null},
     "agents": {"plan": {"start": "scheduled"},
                "implement": {"start": "scheduled"}}}

- `models`: a model per job (`plan`, `implement`, `chat`, `brief`, `planner`), then
  `default` for any job without its own. `$BENCH_MODEL_<JOB>` wins over both.
  A null means the caller keeps the model it uses today. `planner` is the
  per-bucket planners'; null follows `plan`.
- `agents`: per agent (`plan`, `implement`), `start` says what happens when a
  task is handed to it. `scheduled` waits for its hours in the board's Agents
  tab (today's behaviour); `now` has the board start a run as soon as the hand
  over is saved.

Daily budgets are kept out of this file, in the agents engine's fences file
(`data/agents/fences.json`, `$AGENTS_FENCES`), because the engine reads them
there: `daily_budget` for all agents together, and `agent_budgets` keyed by the
runner's agent id. `budgets()` and `save_budgets()` read and write those two
keys and keep every other key in that file.
"""

import copy
import json
import os
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Claude Code CLI aliases, the fixed list onboarding offers.
MODELS = ("opus", "sonnet", "haiku")
JOBS = ("plan", "implement", "chat", "brief", "planner")
AGENTS = ("plan", "implement")
STARTS = ("now", "scheduled")

# The runner ids the fences file keys a budget by. The bucket planners run as
# the Plan agent, so they spend from its budget and have none of their own.
BUDGET_AGENTS = ("plan-agent", "implement-agent")

DEFAULTS = {
    "version": 1,
    "models": {"default": None, "plan": None, "implement": None,
               "chat": None, "brief": None, "planner": None},
    "agents": {"plan": {"start": "scheduled"},
               "implement": {"start": "scheduled"}},
}


def data_root():
    return os.environ.get("TODOS_DATA_ROOT") or os.path.join(ROOT, "data")


def path(root=None):
    return os.path.join(root or data_root(), "settings.json")


def _model(value):
    return value if isinstance(value, str) and value.strip() else None


def load(root=None):
    """The settings, with defaults filling anything missing or malformed."""
    out = copy.deepcopy(DEFAULTS)
    try:
        with open(path(root), encoding="utf-8") as fh:
            raw = json.load(fh)
    except (OSError, ValueError):
        return out
    if not isinstance(raw, dict):
        return out
    models = raw.get("models")
    if isinstance(models, dict):
        for key in out["models"]:
            out["models"][key] = _model(models.get(key))
    agents = raw.get("agents")
    if isinstance(agents, dict):
        for key in AGENTS:
            entry = agents.get(key)
            if isinstance(entry, dict):
                out["agents"][key].update({k: v for k, v in entry.items() if k != "start"})
                if entry.get("start") in STARTS:
                    out["agents"][key]["start"] = entry["start"]
    return out


def start_for(agent, root=None):
    """`now` or `scheduled`: when a task handed to `agent` starts."""
    entry = load(root)["agents"].get(agent) or {}
    return entry.get("start") or "scheduled"


def model_for(job, root=None, default=None):
    """The model `job` should run on, or `default` when nothing says."""
    env = os.environ.get("BENCH_MODEL_%s" % str(job).upper(), "").strip()
    if env:
        return env
    models = load(root)["models"]
    return models.get(job) or models["default"] or default


def planner_model(root=None, default=None):
    """The model the per-bucket planners run on: their own setting when there is
    one, else the Plan agent's. They are the Plan agent's runs, one per task."""
    env = os.environ.get("BENCH_MODEL_PLANNER", "").strip()
    own = env or load(root)["models"].get("planner")
    return own or model_for("plan", root, default)


def validate(data):
    """An error message, or None when `data` is fit to save."""
    if not isinstance(data, dict):
        return "settings must be an object"
    models = data.get("models", {})
    if not isinstance(models, dict):
        return "models must be an object"
    for key, value in models.items():
        if key != "default" and key not in JOBS:
            return "unknown model job: %s" % key
        if value is not None and value not in MODELS:
            return "model for %s must be one of %s" % (key, ", ".join(MODELS))
    agents = data.get("agents", {})
    if not isinstance(agents, dict):
        return "agents must be an object"
    for key, entry in agents.items():
        if key not in AGENTS:
            return "unknown agent: %s" % key
        if not isinstance(entry, dict):
            return "agents.%s must be an object" % key
        if "start" in entry and entry["start"] not in STARTS:
            return "start for %s must be one of %s" % (key, ", ".join(STARTS))
    return None


def save(root, data):
    """Validate and write atomically. Returns (settings, error)."""
    err = validate(data)
    if err:
        return None, err
    # Start from what is on disk so hand-added keys survive a save.
    merged = copy.deepcopy(DEFAULTS)
    try:
        with open(path(root), encoding="utf-8") as fh:
            existing = json.load(fh)
    except (OSError, ValueError):
        existing = None
    if isinstance(existing, dict):
        for key, value in existing.items():
            if key not in ("models", "agents"):
                merged[key] = value
        if isinstance(existing.get("models"), dict):
            merged["models"].update(existing["models"])
        if isinstance(existing.get("agents"), dict):
            for key, entry in existing["agents"].items():
                if isinstance(entry, dict):
                    merged["agents"].setdefault(key, {}).update(entry)
                else:
                    merged["agents"][key] = entry
    merged["models"].update({k: v for k, v in (data.get("models") or {}).items()
                             if k in merged["models"]})
    for key, entry in (data.get("agents") or {}).items():
        merged["agents"].setdefault(key, {}).update(entry)
    merged["version"] = 1
    target = path(root)
    os.makedirs(os.path.dirname(target), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(target), prefix=".settings-")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(merged, fh, indent=2)
            fh.write("\n")
        os.replace(tmp, target)
    except OSError:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
    return load(root), None


def _dollars(value):
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def _read_fences(fences):
    try:
        with open(fences, encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def budgets(fences):
    """The daily budgets in the fences file at `fences`: `daily_budget` for all
    agents together and `agent_budgets` per agent in BUDGET_AGENTS, each in
    dollars or None for no limit."""
    data = _read_fences(fences)
    own = data.get("agent_budgets")
    own = own if isinstance(own, dict) else {}
    return {"daily_budget": _dollars(data.get("daily_budget")),
            "agent_budgets": {a: _dollars(own.get(a)) for a in BUDGET_AGENTS}}


def budgets_error(body):
    """An error message for the budget keys in `body`, or None."""
    def bad(value):
        return value not in (None, "") and (_dollars(value) is None or value < 0)
    if "daily_budget" in body and bad(body["daily_budget"]):
        return "daily_budget must be a number of dollars, or empty for no limit"
    own = body.get("agent_budgets", {})
    if not isinstance(own, dict):
        return "agent_budgets must be an object"
    for key, value in own.items():
        if key not in BUDGET_AGENTS:
            return "unknown agent for a budget: %s" % key
        if bad(value):
            return "the budget for %s must be a number of dollars, or empty for no limit" % key
    return None


def save_budgets(fences, body):
    """Set or clear whichever of `daily_budget` and `agent_budgets` `body` holds,
    keeping every other key in the fences file, and every agent `body` does not
    name. An empty or null value removes the limit. Returns an error, or None."""
    err = budgets_error(body)
    if err:
        return err
    if "daily_budget" not in body and "agent_budgets" not in body:
        return None
    data = _read_fences(fences)
    if "daily_budget" in body:
        if body["daily_budget"] in (None, ""):
            data.pop("daily_budget", None)
        else:
            data["daily_budget"] = float(body["daily_budget"])
    if "agent_budgets" in body:
        own = data.get("agent_budgets")
        own = dict(own) if isinstance(own, dict) else {}
        for key, value in body["agent_budgets"].items():
            if value in (None, ""):
                own.pop(key, None)
            else:
                own[key] = float(value)
        if own:
            data["agent_budgets"] = own
        else:
            data.pop("agent_budgets", None)
    os.makedirs(os.path.dirname(fences), exist_ok=True)
    tmp = fences + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2)
        fh.write("\n")
    os.replace(tmp, fences)
    return None
