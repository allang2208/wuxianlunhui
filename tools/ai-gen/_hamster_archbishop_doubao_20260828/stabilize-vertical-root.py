#!/usr/bin/env python3
"""Stabilize the archbishop body's vertical root without altering pose geometry.

The crozier is deliberately excluded from the anchor. Every correction is a
whole-cell integer translation, so limb, robe, crozier, and spell trajectories
remain exactly as authored relative to one another.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import shutil
import sys
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
SOURCE_DIR = ROOT / "source-sheets-pre-interpolation"
FINAL_DIR = ROOT / "sheets" / "interpolated"
SOURCE_PREVIEW_DIR = ROOT / "previews" / "source-sheets"
FINAL_PREVIEW_DIR = ROOT / "previews" / "interpolated"
BACKUP_DIR = ROOT / "backups" / "pre-vertical-root"
REPORT_PATH = ROOT / "source-sheet-report.json"
TARGET_Y = 351
ACTION_NAMES = ("idle", "moving", "spellcast")


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot import helper: {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


HELPER = load_module(
    "archbishop_body_helper",
    REPO / "tools" / "ai-gen" / "_hamster_halberd_20260825" / "build-halberdier-sheets.py",
)
RIFE = load_module(
    "archbishop_rife_helper",
    REPO / "tools" / "ai-gen" / "rife-spritesheet-interpolate.py",
)


def body_root_y(cell: np.ndarray) -> int:
    """Return the bottom of the thick body component, excluding the crozier."""
    _, _, _, bottom = HELPER.opened_body_bbox(
        cell, HELPER.BODY_OPEN_KERNEL_OUTPUT
    )
    return int(bottom)


def shift_vertical(cell: np.ndarray, dy: int) -> np.ndarray:
    if dy == 0:
        return cell.copy()
    height = cell.shape[0]
    result = np.zeros_like(cell)
    if dy > 0:
        if np.any(cell[height - dy :, :, 3] > 0):
            raise RuntimeError(f"Vertical shift +{dy} would clip visible pixels")
        result[dy:] = cell[: height - dy]
    else:
        amount = -dy
        if np.any(cell[:amount, :, 3] > 0):
            raise RuntimeError(f"Vertical shift {dy} would clip visible pixels")
        result[: height - amount] = cell[amount:]
    result[result[..., 3] == 0, :3] = 0
    return result


def stabilize(cells: list[np.ndarray]) -> tuple[list[np.ndarray], list[int], list[int]]:
    before = [body_root_y(cell) for cell in cells]
    shifts = [TARGET_Y - value for value in before]
    if any(abs(value) > 8 for value in shifts):
        raise RuntimeError(f"Unexpected body-root correction outside safety bound: {shifts}")
    corrected = [shift_vertical(cell, dy) for cell, dy in zip(cells, shifts)]
    after = [body_root_y(cell) for cell in corrected]
    if any(value != TARGET_Y for value in after):
        raise RuntimeError(f"Body-root stabilization failed: {after}")
    return corrected, before, shifts


def save_sheet(path: Path, cells: list[np.ndarray], cols: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(RIFE.compose(cells, cols), "RGBA").save(
        path, optimize=True, compress_level=9
    )


def copy_once(source: Path, destination: Path) -> None:
    if destination.exists():
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)


def stabilize_source(report: dict[str, object]) -> None:
    for action in ACTION_NAMES:
        spec = report["actions"][action]
        sheet_path = SOURCE_DIR / f"{action}.png"
        backup_source = BACKUP_DIR / "source" / f"{action}.png"
        copy_once(sheet_path, backup_source)
        copy_once(FINAL_DIR / f"{action}.png", BACKUP_DIR / "interpolated" / f"{action}.png")
        cells = RIFE.extract_cells(
            backup_source,
            spec["frameWidth"],
            spec["frameHeight"],
            spec["cols"],
            spec["frameCount"],
        )
        cells, before, shifts = stabilize(cells)
        save_sheet(sheet_path, cells, spec["cols"])

        preview_spec = HELPER.ActionSpec(
            action,
            tuple(spec["sourceIndices"]),
            spec["sourceSheetFrameRate"],
            spec["repeat"],
            spec["horizontalMode"],
            spec["verticalMode"],
        )
        HELPER.save_previews(preview_spec, cells, SOURCE_PREVIEW_DIR)
        validation = HELPER.BASE.validate_cells(cells, spec["repeat"])
        validation.update(HELPER.body_metrics(cells))
        validation["nonzeroRgbInTransparentPixels"] = max(
            int(np.count_nonzero(cell[..., :3][cell[..., 3] == 0]))
            for cell in cells
        )
        spec["validation"] = validation
        spec["verticalRootStabilization"] = {
            "method": "whole-cell integer translation",
            "anchor": "bottom of thick body component; crozier excluded",
            "targetY": TARGET_Y,
            "bodyRootBefore": before,
            "perFrameShiftY": shifts,
            "maxAbsShift": max(abs(value) for value in shifts),
            "bodyRootAfterMin": TARGET_Y,
            "bodyRootAfterMax": TARGET_Y,
            "poseGeometryEdited": False,
        }
        print(f"source {action}: before={min(before)}..{max(before)} shifts={shifts}")

    report["verticalRootRefinement"] = {
        "actions": list(ACTION_NAMES),
        "targetY": TARGET_Y,
        "anchor": "thick body foot/robe root, excluding crozier",
        "method": "whole-cell integer translation before RIFE",
        "dyingUnchanged": True,
    }
    REPORT_PATH.write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def stabilize_final(report: dict[str, object]) -> None:
    for action in ACTION_NAMES:
        source_spec = report["actions"][action]
        rife_report_path = ROOT / f"{action}-rife-report.json"
        rife_report = json.loads(rife_report_path.read_text(encoding="utf-8"))
        sheet_path = FINAL_DIR / f"{action}.png"
        frames = RIFE.extract_cells(
            sheet_path,
            rife_report["frameWidth"],
            rife_report["frameHeight"],
            rife_report["cols"],
            rife_report["outputFrameCount"],
        )
        frames, before, shifts = stabilize(frames)
        save_sheet(sheet_path, frames, rife_report["cols"])

        mode = "loop" if source_spec["repeat"] == -1 else "one-shot"
        RIFE.write_previews(
            f"hamster-archbishop-shared-{action}",
            frames,
            source_spec["sourceSheetFrameRate"],
            mode,
            FINAL_PREVIEW_DIR,
        )

        source_cells = RIFE.extract_cells(
            SOURCE_DIR / f"{action}.png",
            source_spec["frameWidth"],
            source_spec["frameHeight"],
            source_spec["cols"],
            source_spec["frameCount"],
        )
        key_frames_preserved = all(
            np.array_equal(source, frames[index * 2])
            for index, source in enumerate(source_cells)
        )
        bboxes = [RIFE.alpha_bbox(frame) for frame in frames]
        empty = [index for index, bbox in enumerate(bboxes) if bbox is None]
        touching = [
            index
            for index, bbox in enumerate(bboxes)
            if bbox is not None
            and (
                bbox[0] <= 2
                or bbox[1] <= 2
                or bbox[2] >= frames[index].shape[1] - 3
                or bbox[3] >= frames[index].shape[0] - 3
            )
        ]
        transparent_rgb = max(
            int(np.count_nonzero(frame[..., :3][frame[..., 3] == 0]))
            for frame in frames
        )
        previous_validation = rife_report["validation"]
        pair_count = len(source_cells) if mode == "loop" else len(source_cells) - 1
        held_indices = set(previous_validation["middleFrameHeldSourceKeyFallbacks"])
        held_source_keys = [index * 2 + 1 in held_indices for index in range(pair_count)]
        validation = RIFE.validate(
            source_cells,
            frames,
            mode,
            previous_validation["middleFrameFootShifts"],
            previous_validation["middleFrameVisibleDarkPixelsRepaired"],
            previous_validation["middleFrameVisibleRedPixelsRepaired"],
            held_source_keys,
            True,
            rife_report["loopStartSourceIndex"] or 0,
        )
        if (
            empty
            or touching
            or transparent_rgb
            or not key_frames_preserved
            or validation["visibleDarkOutlierFrames"]
            or validation["visibleRedOutlierFrames"]
        ):
            raise RuntimeError(
                f"{action} post-pass failed: empty={empty}, touching={touching}, "
                f"transparent_rgb={transparent_rgb}, keys={key_frames_preserved}, "
                f"dark={validation['visibleDarkOutlierFrames']}, "
                f"red={validation['visibleRedOutlierFrames']}"
            )

        rife_report["validation"] = validation
        previous_stabilization = rife_report.get("postVerticalRootStabilization")
        if previous_stabilization is not None and not any(shifts):
            stabilization_report = previous_stabilization
            stabilization_report["idempotentRevalidationPassed"] = True
        else:
            stabilization_report = {
                "method": "whole-cell integer translation after RIFE",
                "anchor": "bottom of thick body component; crozier excluded",
                "targetY": TARGET_Y,
                "bodyRootBefore": before,
                "perFrameShiftY": shifts,
                "evenSourceKeyShiftY": shifts[::2],
                "maxAbsShift": max(abs(value) for value in shifts),
                "bodyRootAfterMin": TARGET_Y,
                "bodyRootAfterMax": TARGET_Y,
                "originalKeyFramesPreservedAtEvenIndices": key_frames_preserved,
                "poseGeometryEdited": False,
            }
        rife_report["postVerticalRootStabilization"] = stabilization_report
        rife_report_path.write_text(
            json.dumps(rife_report, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"final {action}: before={min(before)}..{max(before)} shifts={shifts}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("stage", choices=("source", "final"))
    args = parser.parse_args()
    report = json.loads(REPORT_PATH.read_text(encoding="utf-8"))
    if args.stage == "source":
        stabilize_source(report)
    else:
        stabilize_final(report)


if __name__ == "__main__":
    main()
