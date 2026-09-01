#!/usr/bin/env python3
"""Apply RIFE, or a documented native-source fallback, to approved H3 sheets."""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
TOOL = REPO / "tools" / "ai-gen" / "rife-spritesheet-interpolate.py"
SOURCE_DIR = ROOT / "runtime-source-sheets-pre-rife"
ASSET_DIR = REPO / "assets" / "companions" / "hamster_champion"
PREVIEW_DIR = ROOT / "previews" / "runtime-clock"
REPORT_DIR = ROOT / "runtime-rife-reports"
SOURCE_REPORT = ROOT / "runtime-source-sheet-report.json"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--action",
        action="append",
        choices=("idle", "running", "attacking", "dying"),
        help="rebuild only the named action; may be repeated",
    )
    args = parser.parse_args()
    selected = set(args.action or ())
    source = json.loads(SOURCE_REPORT.read_text(encoding="utf-8"))
    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    if selected and (ROOT / "runtime-rife-report.json").exists():
        combined = json.loads((ROOT / "runtime-rife-report.json").read_text(encoding="utf-8"))
    else:
        combined: dict[str, object] = {
            "runtimeIntegration": True,
            "tool": "tools/ai-gen/rife-spritesheet-interpolate.py",
            "policy": "RIFE 2x by default; native H3 source-frame fallback when interpolation changes equipment topology",
            "actions": {},
        }
    combined["policy"] = (
        "RIFE 2x by default; native H3 source-frame fallback when interpolation "
        "changes equipment topology"
    )
    for name, spec in source["actions"].items():
        if selected and name not in selected:
            continue
        mode = "loop" if spec["repeat"] == -1 else "one-shot"
        report_path = REPORT_DIR / f"{name}.json"
        final_asset_path = ASSET_DIR / f"{name}.png"
        staged_asset_path = ASSET_DIR / f".{name}.next.png"
        if spec.get("interpolationMode") == "native-source":
            shutil.copy2(SOURCE_DIR / f"{name}.png", staged_asset_path)
            staged_asset_path.replace(final_asset_path)
            action_report = {
                "name": name,
                "mode": "one-shot",
                "interpolationMode": "native-source",
                "fallbackReason": (
                    "RIFE middle frames changed the connected two-handed sword/arms, "
                    "and alpha-bottom alignment mistook the low blade tip for a foot"
                ),
                "sourceSheet": str(SOURCE_DIR / f"{name}.png"),
                "outputSheet": str(final_asset_path),
                "sourceVideo": spec["source"],
                "sourceIndices": spec["sourceIndices"],
                "sourceFrameCount": spec["sourceFrameCount"],
                "outputFrameCount": spec["finalFrameCount"],
                "frameWidth": spec["frameWidth"],
                "frameHeight": spec["frameHeight"],
                "frameRate": spec["runtimeFrameRate"],
                "syntheticFrameCount": 0,
                "originalSourceFramesPreserved": True,
                "rootAlignment": (
                    "one fixed source transform and the locked integrated foot anchor; "
                    "no per-frame vertical correction"
                ),
                "validation": spec["validation"],
            }
            report_path.write_text(
                json.dumps(action_report, ensure_ascii=False, indent=2), encoding="utf-8",
            )
            combined["actions"][name] = action_report
            continue
        command = [
            sys.executable, str(TOOL),
            "--sheet", str(SOURCE_DIR / f"{name}.png"),
            # Dev-server file watchers may briefly hold the live texture after
            # another action changes. Write a new sibling first, then atomically
            # replace the referenced asset only after the sheet is complete.
            "--out", str(staged_asset_path),
            "--name", name,
            "--frame-width", str(spec["frameWidth"]),
            "--frame-height", str(spec["frameHeight"]),
            "--cols", str(spec["cols"]),
            "--frame-count", str(spec["sourceFrameCount"]),
            "--frame-rate", str(spec["sourceSheetFrameRate"]),
            "--mode", mode,
            "--out-cols", "8",
            "--preview-dir", str(PREVIEW_DIR),
            "--report", str(report_path),
        ]
        if name != "running":
            # Sparse non-running keys retain the earlier middle-frame chroma
            # repair. Running now despills every source key before RIFE, which
            # avoids alternating clean/blue frames and keeps limbs intact.
            command.extend((
                "--despill-blue-middle",
                "--repair-magenta-middle",
                "--repair-red-outliers",
            ))
        if spec.get("preserveVerticalMotionDuringRife"):
            command.append("--preserve-vertical-motion")
        subprocess.run(command, check=True)
        staged_asset_path.replace(final_asset_path)
        action_report = json.loads(report_path.read_text(encoding="utf-8"))
        action_report["outputSheet"] = str(final_asset_path)
        report_path.write_text(
            json.dumps(action_report, ensure_ascii=False, indent=2), encoding="utf-8",
        )
        combined["actions"][name] = action_report
    (ROOT / "runtime-rife-report.json").write_text(
        json.dumps(combined, ensure_ascii=False, indent=2), encoding="utf-8",
    )
    print(f"[champion-h3] wrote {ROOT / 'runtime-rife-report.json'}")


if __name__ == "__main__":
    main()
