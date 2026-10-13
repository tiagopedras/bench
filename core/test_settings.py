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


if __name__ == "__main__":
    unittest.main()
