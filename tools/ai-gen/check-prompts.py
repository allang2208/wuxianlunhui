#!/usr/bin/env python3
"""Anti-regression scan for the no-light / no-shadow generation principle.

Scans the non-UI prompt templates (negative sections are skipped; icon/UI
templates are exempt) plus the world-122 item prompts and fails on any
forbidden light/shadow term in a positive prompt.

Usage:
  python check-prompts.py
"""

import argparse
import importlib.util
import os
import re
import sys

from prompt_principles import BAD_LIGHT_TERMS

DIR = os.path.dirname(os.path.abspath(__file__))
PROMPTS = os.path.join(DIR, "prompts")
SCAN_FILES = [
    "obstacle.md",
    "cover.md",
    "defense-tower.md",
    "transparent-subject.md",
    "monster-sprite.md",
]

TERM_RE = re.compile(
    r"(?<!no\s)(?<!not\s)(?<!without\s)(?:"
    + "|".join(re.escape(t) for t in BAD_LIGHT_TERMS) + ")",
    re.IGNORECASE,
)


def check_lines(lines, label, issues):
    in_neg = False
    for i, ln in enumerate(lines, 1):
        if ln.startswith("#"):
            in_neg = "负面" in ln
            continue
        if in_neg:
            continue
        if any(k in ln for k in ("禁止", "forbidden", "不要写", "禁写", "勿写")):
            continue
        if TERM_RE.search(ln):
            issues.append(f"{label}:{i}: {ln.strip()[:110]}")


def load_world122_items():
    spec = importlib.util.spec_from_file_location(
        "gen_world122_assets", os.path.join(DIR, "gen-world122-assets.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.cover_items() + mod.tower_items()


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    issues = []
    for name in SCAN_FILES:
        path = os.path.join(PROMPTS, name)
        if not os.path.exists(path):
            issues.append(f"prompts/{name}: MISSING")
            continue
        with open(path, "r", encoding="utf-8") as fh:
            check_lines(fh.read().splitlines(), f"prompts/{name}", issues)

    for it in load_world122_items():
        for m in TERM_RE.finditer(it["prompt"]):
            issues.append(f"{it['key']} positive prompt: '{m.group(0)}'")

    if issues:
        print("\n".join("  - " + i for i in issues), file=sys.stderr)
        print(f"\ncheck FAIL: {len(issues)} issue(s)", file=sys.stderr)
        sys.exit(1)
    if not args.quiet:
        print("check OK: no forbidden light/shadow terms in positive prompts")


if __name__ == "__main__":
    main()
