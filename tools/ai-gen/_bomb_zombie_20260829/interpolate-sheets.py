#!/usr/bin/env python3
"""Run the required RIFE v4.6 2x pass for all bomb-zombie source sheets."""

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
        "pipeline": "Doubao Seedance 2.0 Mini -> BiRefNet-general -> fixed effective-body scale -> RIFE v4.6 RGBA 2x",
        "actions": {},
    }
    for action in ("idle", "walking", "attacking", "dying"):
        spec = source["actions"][action]
        mode = "loop" if spec["repeat"] == -1 else "one-shot"
        name = f"bomb_zombie_{action}"
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
            "8",
            "--preview-dir",
            str(preview_dir),
            "--report",
            str(report_path),
            "--repair-red-outliers",
            "--repair-magenta-middle",
        ]
        subprocess.run(cmd, check=True)
        rife_report = json.loads(report_path.read_text(encoding="utf-8"))
        consolidated["actions"][action] = {
            "sheet": f"spritesheets/{action}.png",
            "preview": f"previews/spritesheets/{name}-interpolated.gif",
            "report": f"reports/rife/{action}.json",
            "frameWidth": spec["frameWidth"],
            "frameHeight": spec["frameHeight"],
            "cols": 8,
            "frameCount": rife_report["outputFrameCount"],
            "frameRate": rife_report["outputFrameRate"],
            "repeat": spec["repeat"],
            "validation": rife_report.get("validation", {}),
        }

    release = source["actions"]["attacking"]["releaseMapping"]
    consolidated["actions"]["attacking"]["releaseMapping"] = release
    consolidated["attackContract"] = {
        "characterSequence": [
            "take_from_satchel",
            "ignite_fuse",
            "single_underhand_throw",
            "recover_empty_handed",
        ],
        "projectileOwnership": "future runtime",
        "landingFuseMs": 2000,
        "videoExplosion": False,
    }
    out = ROOT / "spritesheet-manifest.json"
    out.write_text(
        json.dumps(consolidated, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(consolidated, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
