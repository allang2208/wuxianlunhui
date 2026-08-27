#!/usr/bin/env python3
"""Build BiRefNet-cut v03 werewolf sheets and 2x RIFE previews from H3 videos."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from PIL import Image


TASK = Path(__file__).resolve().parent
REPO = TASK.parents[2]
REBUILD = REPO / "tools" / "ai-gen" / "rebuild-h3-birefnet.py"
RIFE_SHEET = REPO / "tools" / "ai-gen" / "rife-spritesheet-interpolate.py"
RIFE_EXE = (
    REPO.parent / "_tmp" / "elise_audit" / "rife"
    / "rife-ncnn-vulkan-20221029-windows" / "rife-ncnn-vulkan.exe"
)
KEY_DIR = TASK / "sheets" / "source-keyframes-v02"
FINAL_DIR = TASK / "sheets" / "interpolated-v02"
PREVIEW_DIR = TASK / "previews" / "sprites-v02"
REPORT_DIR = TASK / "reports" / "sprites-v02"


SPECS = {
    "idle": {
        "video": "werewolf-howl-h3-v01.mp4",
        "output": "werewolf_idle.png",
        "frames": [108, 111, 114, 117, 120, 123, 120, 117, 114, 111],
        "target_h": 290,
        "scale": 0.912,
        "center_x": 320,
        "keep_dx": False,
        "mode": "loop",
        "source_fps": 6.0,
        "key_cols": 5,
        "out_cols": 10,
    },
    "transform": {
        "video": "transform-h3-v02.mp4",
        "output": "transform.png",
        "frames": [0, 12, 24, 36, 48, 60, 72, 84, 96, 108, 123],
        "target_h": 262,
        "scale": 0.91,
        "center_x": 320,
        "keep_dx": False,
        "mode": "one-shot",
        "source_fps": 5.25,
        "key_cols": 4,
        "out_cols": 5,
    },
    "run": {
        "video": "werewolf-run-h3-v02.mp4",
        "output": "werewolf_running.png",
        "frames": [16, 18, 20, 22, 24, 26, 28, 30, 32, 34],
        "target_h": 290,
        "scale": 0.918,
        "center_x": 320,
        "keep_dx": False,
        "mode": "loop",
        "source_fps": 12.0,
        "key_cols": 5,
        "out_cols": 10,
    },
    "attack": {
        "video": "werewolf-attack-h3-v02.mp4",
        "output": "werewolf_attacking.png",
        "frames": [0, 6, 12, 18, 24, 30, 36, 42, 48, 54, 60],
        "target_h": 290,
        "scale": 1.066,
        "center_x": 220,
        "keep_dx": True,
        "mode": "one-shot",
        "source_fps": 9.5,
        "key_cols": 4,
        "out_cols": 5,
    },
    "howl": {
        "video": "werewolf-howl-h3-v01.mp4",
        "output": "werewolf_howling.png",
        "frames": [0, 12, 24, 36, 48, 60, 72, 84, 96, 108, 123],
        "target_h": 290,
        "scale": 0.912,
        "center_x": 320,
        "keep_dx": False,
        "mode": "one-shot",
        "source_fps": 7.0,
        "key_cols": 4,
        "out_cols": 5,
    },
    "dying": {
        "video": "werewolf-dying-h3-v01.mp4",
        "output": "werewolf_dying.png",
        "frames": [0, 5, 10, 15, 20, 25, 30, 35, 40, 44, 48],
        "target_h": 290,
        "scale": 0.912,
        "center_x": 320,
        "keep_dx": True,
        "motion_anchor": "bbox",
        "mode": "one-shot",
        "source_fps": 5.5,
        "key_cols": 4,
        "out_cols": 5,
    },
    "pounce": {
        "video": "werewolf-pounce-v06-scale-fixed.mp4",
        "output": "werewolf_pouncing_v06.png",
        "key_output": "pounce-v06-keyframes.png",
        "frames": [0, 18, 24, 30, 33, 36, 39, 42, 48, 54, 60, 66, 72, 84],
        "target_h": 290,
        "scale": 1.066,
        "center_x": 165,
        "keep_dx": True,
        "motion_anchor": "bbox",
        "keep_dy": True,
        "mode": "one-shot",
        "source_fps": 7.5,
        "key_cols": 4,
        "out_cols": 5,
        "cell": 640,
        "foot_y": 590,
        "native_replacements": {9: 34, 11: 37},
    },
}


def run(command: list[str]) -> None:
    print("[werewolf-v02]", " ".join(command), flush=True)
    subprocess.run(command, check=True)


def main() -> None:
    if not RIFE_EXE.exists():
        raise SystemExit(f"RIFE missing: {RIFE_EXE}")
    for directory in (KEY_DIR, FINAL_DIR, PREVIEW_DIR, REPORT_DIR):
        directory.mkdir(parents=True, exist_ok=True)

    report_path = TASK / "werewolf-v02-sprite-build-report.json"
    if report_path.exists():
        build_report = json.loads(report_path.read_text(encoding="utf-8"))
    else:
        build_report = {
            "identityMother": "../_red_wolf_king_style_refresh_20260827/red-werewolf-mother-v03-druid-medusa-realistic.png",
            "cell": 640,
            "footY": 590,
            "targetWerewolfContentHeight": 290,
            "actions": {},
        }
    requested = set(sys.argv[1:])
    unknown = requested.difference(SPECS)
    if unknown:
        raise SystemExit(f"unknown actions: {sorted(unknown)}")
    for name, spec in SPECS.items():
        if requested and name not in requested:
            continue
        key_sheet = KEY_DIR / spec.get("key_output", f"{name}-keyframes.png")
        final_sheet = FINAL_DIR / spec["output"]
        cell = spec.get("cell", 640)
        foot_y = spec.get("foot_y", 590)
        rebuild = [
            sys.executable, str(REBUILD),
            "--video", str(TASK / "videos" / spec["video"]),
            "--out", str(key_sheet),
            "--frames", ",".join(map(str, spec["frames"])),
            "--cols", str(spec["key_cols"]),
            "--cell", str(cell),
            "--center-x", str(spec["center_x"]),
            "--feet-y", str(foot_y),
            "--target-h", str(spec["target_h"]),
            "--scale", str(spec["scale"]),
            "--hard-edge", "245",
            "--edge-dark", "18",
            "--zero-transparent-rgb",
            "--bg-color", "#00E5FF",
            "--bg-dist", "52",
        ]
        if spec["keep_dx"]:
            rebuild.append("--keep-dx")
            rebuild += ["--motion-anchor", spec.get("motion_anchor", "legs")]
        if spec.get("keep_dy"):
            rebuild.append("--keep-dy")
        run(rebuild)

        rife_report = REPORT_DIR / f"{name}-rife.json"
        run([
            sys.executable, str(RIFE_SHEET),
            "--sheet", str(key_sheet),
            "--out", str(final_sheet),
            "--name", f"red-werewolf-v02-{name}",
            "--frame-width", str(cell),
            "--frame-height", str(cell),
            "--cols", str(spec["key_cols"]),
            "--frame-count", str(len(spec["frames"])),
            "--frame-rate", str(spec["source_fps"]),
            "--mode", spec["mode"],
            "--out-cols", str(spec["out_cols"]),
            "--preview-dir", str(PREVIEW_DIR),
            "--report", str(rife_report),
            "--rife", str(RIFE_EXE),
            "--repair-red-outliers",
        ])
        native_replacements = spec.get("native_replacements", {})
        if native_replacements:
            repair_frames = [spec["frames"][0], *native_replacements.values()]
            repair_sheet = KEY_DIR / f"{name}-native-replacements.png"
            repair_rebuild = [
                sys.executable, str(REBUILD),
                "--video", str(TASK / "videos" / spec["video"]),
                "--out", str(repair_sheet),
                "--frames", ",".join(map(str, repair_frames)),
                "--cols", str(len(repair_frames)),
                "--cell", str(cell),
                "--center-x", str(spec["center_x"]),
                "--feet-y", str(foot_y),
                "--target-h", str(spec["target_h"]),
                "--scale", str(spec["scale"]),
                "--hard-edge", "245",
                "--edge-dark", "18",
                "--zero-transparent-rgb",
                "--bg-color", "#00E5FF",
                "--bg-dist", "52",
                "--keep-dx",
                "--motion-anchor", spec.get("motion_anchor", "legs"),
            ]
            if spec.get("keep_dy"):
                repair_rebuild.append("--keep-dy")
            run(repair_rebuild)
            with Image.open(repair_sheet) as repair_image, Image.open(final_sheet) as final_image:
                repaired = final_image.convert("RGBA")
                for repair_cell_index, output_index in enumerate(native_replacements, start=1):
                    source_cell = repair_image.crop((
                        repair_cell_index * cell, 0,
                        (repair_cell_index + 1) * cell, cell,
                    ))
                    repaired.paste(
                        source_cell,
                        ((output_index % spec["out_cols"]) * cell,
                         (output_index // spec["out_cols"]) * cell),
                    )
                repaired.save(final_sheet, optimize=True)
        report = json.loads(rife_report.read_text(encoding="utf-8"))
        if native_replacements:
            report["nativeSourceFrameReplacements"] = {
                str(output_index): source_frame
                for output_index, source_frame in native_replacements.items()
            }
            report["validation"]["rifeFramesReplacedWithNativeSource"] = sorted(native_replacements)
            rife_report.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        build_report["actions"][name] = {
            "sourceVideo": f"videos/{spec['video']}",
            "sourceFrames": spec["frames"],
            "sourceKeySheet": str(key_sheet.relative_to(TASK)).replace("\\", "/"),
            "spriteSheet": str(final_sheet.relative_to(TASK)).replace("\\", "/"),
            "previewGif": f"previews/sprites-v02/red-werewolf-v02-{name}.gif",
            "frameSize": [cell, cell],
            "frameCount": report["outputFrameCount"],
            "grid": [spec["out_cols"], report["rows"]],
            "footY": foot_y,
            "mode": spec["mode"],
            "validation": report["validation"],
        }

    report_path.write_text(json.dumps(build_report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(build_report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
