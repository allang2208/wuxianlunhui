#!/usr/bin/env python3
"""Rank same-phase loop windows for the accepted MiniMax H3 running candidate."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
BASE_PATH = ROOT / "select-running-loop-v03.py"
SPEC = importlib.util.spec_from_file_location("sniper_loop_ranker", BASE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Cannot import {BASE_PATH}")
RANKER = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = RANKER
SPEC.loader.exec_module(RANKER)

RANKER.VIDEO = ROOT / "videos" / "running-h3-v02.mp4"
RANKER.OUT = ROOT / "previews" / "diagnostics" / "loop-h3-v02"
RANKER.SEARCH_START = 8
RANKER.SEARCH_END = 108
RANKER.MIN_PERIOD = 16
RANKER.MAX_PERIOD = 40


if __name__ == "__main__":
    RANKER.main()
