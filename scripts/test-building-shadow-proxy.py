#!/usr/bin/env python3
"""Focused tests for deterministic, foundation-free building shadow proxies."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
CORE_PATH = ROOT / "tools" / "ai-gen" / "building-shadow-proxy-core.py"
SPEC = importlib.util.spec_from_file_location("world122_shadow_proxy_core_test", CORE_PATH)
CORE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CORE)


def rectangle(name, role, x0, y0, x1, y1, z0, z1, group=None):
    return {
        "name": name,
        "role": role,
        "group": group,
        "points": [[x0, y0], [x1, y0], [x1, y1], [x0, y1]],
        "zMin": z0,
        "zMax": z1,
    }


class BuildingShadowProxyTests(unittest.TestCase):
    def setUp(self):
        self.records = [
            rectangle("Foundation", "ground", -400, -400, 400, 400, 0, 20),
            rectangle("MainHall", "body", -150, -120, 150, 120, 20, 260),
            rectangle("NewColumn", "part", 220, -45, 280, 45, 20, 420),
            rectangle("GuideMesh", "ignore", -900, -900, 900, 900, 0, 900),
        ]

    def build(self):
        return CORE.build_shadow_proxy(
            self.records,
            800,
            800,
            20,
            band_count=4,
            cluster_gap_ratio=0.0125,
        )

    def test_foundation_is_excluded_and_new_column_is_automatic_part(self):
        result = self.build()
        excluded = {(item["name"], item["role"]) for item in result["excludedObjects"]}
        self.assertIn(("Foundation", "ground"), excluded)
        self.assertIn(("GuideMesh", "ignore"), excluded)
        self.assertEqual(result["bodyObjectCount"], 2)
        self.assertEqual(len(result["parts"]), 2)
        self.assertTrue(any(part["topRatio"] == 1 for part in result["parts"]))
        self.assertTrue(any(
            max(point[0] for point in part["polygon"]) >= 0.34
            for part in result["parts"]
        ))
        self.assertLess(max(abs(point[0]) for point in result["contactPolygon"]), 0.5)
        self.assertLess(max(abs(point[1]) for point in result["contactPolygon"]), 0.5)

    def test_output_is_deterministic(self):
        left = json.dumps(self.build(), sort_keys=True, separators=(",", ":"))
        right = json.dumps(self.build(), sort_keys=True, separators=(",", ":"))
        self.assertEqual(left, right)

    def test_no_body_after_semantic_filter_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "no renderable body meshes"):
            CORE.build_shadow_proxy(
                [rectangle("OnlyFoundation", "ground", -10, -10, 10, 10, 0, 5)],
                20,
                20,
                5,
            )


if __name__ == "__main__":
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(BuildingShadowProxyTests)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    if result.wasSuccessful():
        print("building shadow proxy geometry: OK (3 cases)")
    raise SystemExit(0 if result.wasSuccessful() else 1)
