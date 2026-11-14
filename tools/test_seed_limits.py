#!/usr/bin/env python3
"""Unit tests for personalized kcal_intake and sex-specific grip_strength limits."""
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from seed import personal_normal_low

ROOT = Path(__file__).resolve().parent.parent


def load_params():
    rows = json.loads((ROOT / "data" / "seed" / "model_params.json").read_text(encoding="utf-8"))
    return {r["key"]: r["value"] for r in rows}


def load_defaults():
    rows = json.loads((ROOT / "data" / "seed" / "indicators.json").read_text(encoding="utf-8"))
    return {r["id"]: r["normal_low"] for r in rows}


class PersonalizedLimitsTest(unittest.TestCase):
    def setUp(self):
        self.params = load_params()
        self.defaults = load_defaults()
        self.year = 2026

    def test_female_40y_60kg_165cm(self):
        astro = {"sex": "F", "birth_year": self.year - 40, "height_cm": 165, "preflight_mass_kg": 60.0}
        self.assertEqual(personal_normal_low("kcal_intake", self.defaults["kcal_intake"], astro, self.params, self.year), 2280.0)
        self.assertEqual(personal_normal_low("grip_strength", self.defaults["grip_strength"], astro, self.params, self.year), 16.0)

    def test_male_40y_70kg_175cm(self):
        astro = {"sex": "M", "birth_year": self.year - 40, "height_cm": 175, "preflight_mass_kg": 70.0}
        self.assertEqual(personal_normal_low("kcal_intake", self.defaults["kcal_intake"], astro, self.params, self.year), 2810.0)
        self.assertEqual(personal_normal_low("grip_strength", self.defaults["grip_strength"], astro, self.params, self.year), 27.0)

    def test_missing_or_invalid_inputs_fallback(self):
        self.assertEqual(personal_normal_low("kcal_intake", self.defaults["kcal_intake"], None, self.params, self.year), 2300)
        self.assertEqual(personal_normal_low("grip_strength", self.defaults["grip_strength"], None, self.params, self.year), 16)

        bad_sex = {"sex": "X", "birth_year": self.year - 40, "height_cm": 175, "preflight_mass_kg": 70.0}
        self.assertEqual(personal_normal_low("kcal_intake", self.defaults["kcal_intake"], bad_sex, self.params, self.year), 2300)
        self.assertEqual(personal_normal_low("grip_strength", self.defaults["grip_strength"], bad_sex, self.params, self.year), 16)

        missing_height = {"sex": "M", "birth_year": self.year - 40, "height_cm": None, "preflight_mass_kg": 70.0}
        self.assertEqual(personal_normal_low("kcal_intake", self.defaults["kcal_intake"], missing_height, self.params, self.year), 2300)
        self.assertEqual(personal_normal_low("grip_strength", self.defaults["grip_strength"], missing_height, self.params, self.year), 27.0)


if __name__ == "__main__":
    unittest.main()
