#!/usr/bin/env python3
"""Run the project RIFE RGBA 2x pipeline for core drill worm sheets."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
TOOL = REPO / "tools" / "ai-gen" / "rife-spritesheet-interpolate.py"
SOURCE_REPORT = ROOT / "source-sheet-report.json"


def main() -> None:
    source = json.loads(SOURCE_REPORT.read_text(encoding="utf-8"))
    output_dir = ROOT / "spritesheets"
    preview_dir = ROOT / "previews" / "spritesheets"
    report_dir = ROOT / "reports" / "rife"
    output_dir.mkdir(parents=True, exist_ok=True)
    preview_dir.mkdir(parents=True, exist_ok=True)
    report_dir.mkdir(parents=True, exist_ok=True)

    consolidated: dict[str, object] = {
        "assetOnly": False,
        "runtimeIntegrationActive": True,
        "pipeline": (
            "accepted Doubao source -> BiRefNet-general -> primary-component cleanup -> "
            "fixed local-body-thickness scale -> RIFE v4.6 RGBA 2x"
        ),
        "actions": {},
        "burrowRuntimeContract": {
            "sequence": ["burrow_enter", "hidden", "burrow_exit"],
            "hiddenSourceVideoFrameRange": [64, 80],
            "note": "The worm is hidden between the enter and exit sheets; generated dirt/hole is not part of the sprite asset.",
        },
    }

    for action, spec in source["actions"].items():
        mode = "loop" if spec["repeat"] == -1 else "one-shot"
        name = f"core_drill_worm_{action}"
        report_path = report_dir / f"{action}.json"
        cmd = [
            sys.executable,
            str(TOOL),
            "--sheet",
            str(ROOT / "source-sheets-pre-interpolation" / f"{action}.png"),
            "--out",
            str(output_dir / f"{action}.png"),
            "--name",
            name,
            "--frame-width",
            str(spec["frameWidth"]),
            "--frame-height",
            str(spec["frameHeight"]),
            "--cols",
            str(spec["cols"]),
            "--frame-count",
            str(spec["frameCount"]),
            "--frame-rate",
            str(spec["sourceSheetFrameRate"]),
            "--mode",
            mode,
            "--out-cols",
            str(spec["cols"]),
            "--preview-dir",
            str(preview_dir),
            "--report",
            str(report_path),
            "--repair-red-outliers",
            "--repair-magenta-middle",
        ]
        if mode == "one-shot":
            cmd.append("--preserve-vertical-motion")

        subprocess.run(cmd, check=True)
        rife_report = json.loads(report_path.read_text(encoding="utf-8"))
        action_manifest: dict[str, object] = {
            "sourceVideo": spec["source"],
            "sourceSheet": f"source-sheets-pre-interpolation/{action}.png",
            "sheet": f"spritesheets/{action}.png",
            "preview": f"previews/spritesheets/{name}-interpolated.gif",
            "contactPreview": f"previews/spritesheets/{name}-interpolated-contact.png",
            "report": f"reports/rife/{action}.json",
            "frameWidth": spec["frameWidth"],
            "frameHeight": spec["frameHeight"],
            "cols": spec["cols"],
            "frameCount": rife_report["outputFrameCount"],
            "frameRate": rife_report["outputFrameRate"],
            "repeat": spec["repeat"],
            "validation": rife_report.get("validation", {}),
        }
        for mapping_name in (
            "contactMapping",
            "naturalCycle",
            "stableCorpseSourceFrame",
            "hiddenTransitionAfterSourceFrame",
            "hiddenTransitionBeforeSourceFrame",
        ):
            if mapping_name in spec:
                action_manifest[mapping_name] = spec[mapping_name]
        consolidated["actions"][action] = action_manifest

    (ROOT / "spritesheet-manifest.json").write_text(
        json.dumps(consolidated, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(consolidated, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
