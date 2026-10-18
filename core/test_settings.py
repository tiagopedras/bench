#!/usr/bin/env python3
"""python3 core/test_settings.py"""

import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import settings  # noqa: E402


class SettingsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = self.tmp.name
        self._env = {k: os.environ.pop(k) for k in list(os.environ)
                     if k.startswith("BENCH_")}

    def tearDown(self):
        for k in [k for k in os.environ if k.startswith("BENCH_")]:
            del os.environ[k]
        os.environ.update(self._env)
        self.tmp.cleanup()

    def write(self, data):
        with open(os.path.join(self.root, "settings.json"), "w") as fh:
            json.dump(data, fh)

    def test_missing_file_gives_defaults(self):
        self.assertEqual(settings.load(self.root), settings.DEFAULTS)
        self.assertIsNone(settings.model_for("brief", self.root))
        self.assertEqual(settings.model_for("brief", self.root, "x"), "x")

    def test_invalid_file_gives_defaults(self):
        with open(os.path.join(self.root, "settings.json"), "w") as fh:
            fh.write("{nope")
        self.assertEqual(settings.load(self.root), settings.DEFAULTS)
        self.write(["list"])
        self.assertEqual(settings.load(self.root), settings.DEFAULTS)

    def test_env_overrides_file(self):
        self.write({"models": {"plan": "opus"}})
        os.environ["BENCH_MODEL_PLAN"] = "haiku"
        self.assertEqual(settings.model_for("plan", self.root), "haiku")

    def test_job_then_default_then_caller(self):
        self.write({"models": {"default": "sonnet", "chat": "opus"}})
        self.assertEqual(settings.model_for("chat", self.root), "opus")
        self.assertEqual(settings.model_for("plan", self.root), "sonnet")
        self.write({"models": {}})
        self.assertEqual(settings.model_for("plan", self.root, "haiku"), "haiku")

    def test_invalid_model_rejected_on_save(self):
        saved, err = settings.save(self.root, {"models": {"plan": "gpt"}})
        self.assertIsNone(saved)
        self.assertIn("one of", err)
        self.assertFalse(os.path.exists(os.path.join(self.root, "settings.json")))
        _, err = settings.save(self.root, {"models": {"nonsense": "opus"}})
        self.assertIn("unknown", err)

    def test_save_round_trip(self):
        saved, err = settings.save(self.root, {"models": {"default": "sonnet"}})
        self.assertIsNone(err)
        self.assertEqual(saved["models"]["default"], "sonnet")
        self.assertEqual(settings.load(self.root)["models"]["default"], "sonnet")

    def test_save_keeps_unknown_keys(self):
        self.write({"note": "mine", "machine": {"code_root": "~/A"},
                    "models": {"plan": "opus"}})
        settings.save(self.root, {"models": {"chat": "haiku"}})
        with open(os.path.join(self.root, "settings.json")) as fh:
            got = json.load(fh)
        self.assertEqual(got["note"], "mine")
        self.assertEqual(got["machine"], {"code_root": "~/A"})
        self.assertEqual(got["models"]["chat"], "haiku")
        self.assertEqual(got["models"]["plan"], "opus")

    def test_agents_default_to_scheduled(self):
        self.assertEqual(settings.start_for("plan", self.root), "scheduled")
        self.assertEqual(settings.start_for("implement", self.root), "scheduled")
        self.write({"agents": {"plan": {"start": "bogus"}}})
        self.assertEqual(settings.start_for("plan", self.root), "scheduled")

    def test_agents_round_trip(self):
        saved, err = settings.save(self.root, {"agents": {"plan": {"start": "now"}}})
        self.assertIsNone(err)
        self.assertEqual(saved["agents"]["plan"]["start"], "now")
        self.assertEqual(saved["agents"]["implement"]["start"], "scheduled")
        self.assertEqual(settings.start_for("plan", self.root), "now")

    def test_agents_validated(self):
        for bad in ({"agents": []}, {"agents": {"nope": {}}},
                    {"agents": {"plan": "now"}}, {"agents": {"plan": {"start": "later"}}}):
            saved, err = settings.save(self.root, bad)
            self.assertIsNone(saved)
            self.assertTrue(err, bad)
        self.assertFalse(os.path.exists(os.path.join(self.root, "settings.json")))

    def test_save_keeps_unknown_agent_keys(self):
        self.write({"agents": {"plan": {"start": "now", "note": "mine"}, "other": {"x": 1}}})
        settings.save(self.root, {"models": {"chat": "haiku"}})
        with open(os.path.join(self.root, "settings.json")) as fh:
            got = json.load(fh)
        self.assertEqual(got["agents"]["plan"], {"start": "now", "note": "mine"})
        self.assertEqual(got["agents"]["other"], {"x": 1})
        settings.save(self.root, {"agents": {"plan": {"start": "scheduled"}}})
        with open(os.path.join(self.root, "settings.json")) as fh:
            got = json.load(fh)
        self.assertEqual(got["agents"]["plan"], {"start": "scheduled", "note": "mine"})

    def test_planner_follows_plan_unless_set(self):
        self.write({"models": {"plan": "opus"}})
        self.assertEqual(settings.planner_model(self.root), "opus")
        self.write({"models": {"plan": "opus", "planner": "haiku"}})
        self.assertEqual(settings.planner_model(self.root), "haiku")
        self.assertIsNone(settings.planner_model(self.root + "/none"))

    def fences(self, data=None):
        f = os.path.join(self.root, "agents", "fences.json")
        if data is not None:
            os.makedirs(os.path.dirname(f), exist_ok=True)
            with open(f, "w") as fh:
                json.dump(data, fh)
        return f

    def read_fences(self):
        with open(self.fences()) as fh:
            return json.load(fh)

    def test_budgets_missing_file_is_no_limit(self):
        self.assertEqual(settings.budgets(self.fences()),
                         {"daily_budget": None,
                          "agent_budgets": {"plan-agent": None, "implement-agent": None}})

    def test_budgets_per_agent_round_trip(self):
        f = self.fences({"other": 1, "agent_budgets": {"someone-else": 9}})
        err = settings.save_budgets(f, {"daily_budget": 10,
                                        "agent_budgets": {"plan-agent": 2, "implement-agent": 5.5}})
        self.assertIsNone(err)
        got = settings.budgets(f)
        self.assertEqual(got["daily_budget"], 10.0)
        self.assertEqual(got["agent_budgets"], {"plan-agent": 2.0, "implement-agent": 5.5})
        self.assertEqual(self.read_fences()["other"], 1)
        self.assertEqual(self.read_fences()["agent_budgets"]["someone-else"], 9)

    def test_budgets_cleared_by_empty(self):
        f = self.fences({"daily_budget": 3, "agent_budgets": {"plan-agent": 2}, "other": 1})
        settings.save_budgets(f, {"daily_budget": "", "agent_budgets": {"plan-agent": None}})
        self.assertEqual(self.read_fences(), {"other": 1})
        settings.save_budgets(f, {"agent_budgets": {"implement-agent": 4}})
        self.assertEqual(self.read_fences(), {"other": 1, "agent_budgets": {"implement-agent": 4.0}})

    def test_budgets_untouched_when_not_sent(self):
        f = self.fences({"daily_budget": 3, "agent_budgets": {"plan-agent": 2}})
        settings.save_budgets(f, {"models": {"chat": "haiku"}})
        settings.save_budgets(f, {"agent_budgets": {"implement-agent": 1}})
        self.assertEqual(self.read_fences(), {"daily_budget": 3,
                                              "agent_budgets": {"plan-agent": 2, "implement-agent": 1.0}})

    def test_budgets_validated(self):
        f = self.fences({"daily_budget": 3})
        for bad in ({"daily_budget": "lots"}, {"daily_budget": -1}, {"daily_budget": True},
                    {"agent_budgets": []}, {"agent_budgets": {"nobody": 1}},
                    {"agent_budgets": {"plan-agent": "2"}}, {"agent_budgets": {"plan-agent": -2}}):
            self.assertTrue(settings.save_budgets(f, bad), bad)
        self.assertEqual(self.read_fences(), {"daily_budget": 3})

    def test_settings_hold_models_and_agents_only(self):
        self.assertEqual(sorted(settings.DEFAULTS), ["agents", "models", "version"])
        self.write({"machine": {"code_root": "~/Elsewhere"}})
        self.assertNotIn("machine", settings.load(self.root))

    # ---- memory_root ----------------------------------------------------

    def memory(self):
        path = os.path.join(self.root, "MEMORY")
        os.makedirs(path, exist_ok=True)
        return path

    def test_memory_root_unset_is_absent(self):
        self.write({"models": {"plan": "opus"}})
        self.assertNotIn("memory_root", settings.load(self.root))
        self.assertIsNone(settings.memory_root(self.root))
        self.write({"memory_root": "   "})
        self.assertIsNone(settings.memory_root(self.root))

    def test_memory_root_read_and_must_exist(self):
        mem = self.memory()
        self.write({"memory_root": mem})
        self.assertEqual(settings.load(self.root)["memory_root"], mem)
        self.assertEqual(settings.memory_root(self.root), mem)
        self.write({"memory_root": os.path.join(self.root, "gone")})
        self.assertIsNone(settings.memory_root(self.root))

    def test_memory_root_validated(self):
        mem = self.memory()
        self.assertIsNone(settings.validate({"memory_root": mem}))
        self.assertIsNone(settings.validate({"memory_root": ""}))
        self.assertIsNone(settings.validate({"memory_root": None}))
        self.assertIn("folder path", settings.validate({"memory_root": 3}))
        self.assertIn("full path", settings.validate({"memory_root": "MEMORY"}))
        self.assertIn("no folder", settings.validate({"memory_root": os.path.join(self.root, "gone")}))

    def test_memory_root_save_keep_and_clear(self):
        mem = self.memory()
        saved, err = settings.save(self.root, {"memory_root": mem})
        self.assertIsNone(err)
        self.assertEqual(saved["memory_root"], mem)
        settings.save(self.root, {"models": {"plan": "opus"}})
        self.assertEqual(settings.load(self.root)["memory_root"], mem)
        saved, _ = settings.save(self.root, {"memory_root": ""})
        self.assertNotIn("memory_root", saved)
        with open(os.path.join(self.root, "settings.json")) as fh:
            self.assertNotIn("memory_root", json.load(fh))

    def test_people_path_falls_back_to_the_list(self):
        mem = self.memory()
        here = os.path.join(self.root, "work", "people.md")
        self.assertEqual(settings.people_path("work", self.root), here)
        self.write({"memory_root": mem})
        self.assertEqual(settings.people_path("work", self.root), here)
        there = os.path.join(mem, "bench", "work", "people.md")
        os.makedirs(os.path.dirname(there))
        open(there, "w").close()
        self.assertEqual(settings.people_path("work", self.root), there)
        self.assertEqual(settings.people_path("home", self.root),
                         os.path.join(self.root, "home", "people.md"))

    def test_boards_md_lists_and_marks(self):
        text = settings.boards_md(["work", "home"], "work", "/C/bench/data", "/C/MEMORY")
        self.assertTrue(text.startswith(settings.BOARDS_HEADER))
        self.assertIn("Only PA changes boards", text)
        self.assertEqual(text.split("\n\n", 2)[2].splitlines(), [
            "- home: `bench/data/home/`",
            "- work (current): `bench/data/work/`"])
        # A memory folder that is not beside the repo gets full paths.
        self.assertIn("- home: `/C/bench/data/home/`",
                      settings.boards_md(["home"], None, "/C/bench/data", "/Elsewhere/MEMORY"))

    def test_boards_md_carries_marks_and_descriptions(self):
        previous = (
            "# Boards\n\nWritten by hand.\n\n"
            "- work (current): `bench/data/work/`, the live list\n"
            "- old (frozen, never write): `bench/data/old/`, kept for posterity\n"
            "- gone: `bench/data/gone/`, removed since\n")
        text = settings.boards_md(["work", "old", "home", "new"], "home",
                                  "/C/bench/data", "/C/MEMORY", previous)
        self.assertEqual(text.split("\n\n", 2)[2].splitlines(), [
            "- work: `bench/data/work/`, the live list",
            "- old (frozen, never write): `bench/data/old/`, kept for posterity",
            "- home (current): `bench/data/home/`",
            "- new: `bench/data/new/`"])
        self.assertNotIn("Written by hand", text)

    def test_write_boards_only_with_a_memory_folder(self):
        data = os.path.join(self.root, "data")
        os.makedirs(data)
        self.assertIsNone(settings.write_boards(["work"], "work", data))
        mem = self.memory()
        with open(os.path.join(data, "settings.json"), "w") as fh:
            json.dump({"memory_root": mem}, fh)
        target = settings.write_boards(["work", "home"], "work", data)
        self.assertEqual(target, os.path.join(mem, "boards.md"))
        with open(target) as fh:
            self.assertIn("- work (current): `data/work/`", fh.read())
        self.assertEqual(sorted(os.listdir(mem)), ["boards.md"])
        settings.write_boards(["home"], "home", data)
        with open(target) as fh:
            got = fh.read()
        self.assertIn("- home (current)", got)
        self.assertNotIn("work", got.split("\n\n", 2)[2])


if __name__ == "__main__":
    unittest.main()
