"""Offline structural and budget checks for the task-local sprite delivery."""
from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[3]
TOOLS = REPO / "tools/ai-gen"
KINDS = ("idle", "run", "attack", "die")


def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def cells(path: Path, width: int, height: int, cols: int, count: int) -> list[np.ndarray]:
    sheet = np.asarray(Image.open(path).convert("RGBA"))
    return [
        sheet[index // cols * height : index // cols * height + height,
              index % cols * width : index % cols * width + width].copy()
        for index in range(count)
    ]


def rgba_delta(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.abs(a.astype(np.float32) - b.astype(np.float32)).mean() / 255)


def main() -> int:
    manifest_path = ROOT / "spritesheet-manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
    runtime_active = bool(manifest.get("runtimeIntegrationActive"))
    delivery_status = (
        "runtime_integrated_pending_user_game_validation"
        if runtime_active
        else "transparent_sprites_offline_checked_pending_user_review"
    )
    budget_command = [sys.executable, str(TOOLS / "check-character-sprite-budget.py"), str(ROOT / "sprite-budget-manifest.json")]
    budget_process = subprocess.run(budget_command, capture_output=True, text=True)
    budget = json.loads(budget_process.stdout)
    write_json(ROOT / "sprite-budget-report.json", budget)

    errors: list[str] = []
    actions = {}
    for kind in KINDS:
        action = manifest["actions"][kind]
        width, height = action["frameWidth"], action["frameHeight"]
        count, cols, rows = action["frameCount"], action["cols"], action["rows"]
        output_cells = cells(ROOT / action["sheet"], width, height, cols, count)
        key_meta = json.loads((ROOT / f"source-sheets/{kind}-keys.json").read_text(encoding="utf-8-sig"))
        key_cells = cells(ROOT / action["sourceSheet"], width, height, key_meta["cols"], action["sourceKeyCount"])
        empty = [index for index, cell in enumerate(output_cells) if not np.any(cell[..., 3])]
        border_safety = []
        nonzero_transparent_rgb = 0
        visible_alpha_pixels = 0
        for cell in output_cells:
            alpha = cell[..., 3]
            ys, xs = np.nonzero(alpha)
            visible_alpha_pixels += int(np.count_nonzero(alpha))
            if len(xs):
                border_safety.append(min(int(xs.min()), int(ys.min()), width - int(xs.max()) - 1, height - int(ys.max()) - 1))
            nonzero_transparent_rgb += int(np.count_nonzero(cell[..., :3][alpha == 0]))
        key_mismatches = [
            index
            for index, key in enumerate(key_cells)
            if not np.array_equal(key, output_cells[index * 2])
        ]
        sheet_rgba = np.asarray(Image.open(ROOT / action["sheet"]).convert("RGBA"))
        padding_alpha = 0
        for index in range(count, cols * rows):
            padding = sheet_rgba[index // cols * height : index // cols * height + height,
                                 index % cols * width : index % cols * width + width, 3]
            padding_alpha += int(np.count_nonzero(padding))
        expected_count = action["sourceKeyCount"] * 2 - (0 if action["loop"] else 1)
        duration_delta = abs(sum(action["frameDurationsMs"]) - action["durationMs"])
        gif_duration_delta = abs(sum(action["gifDurationsMs"]) - action["durationMs"])
        gif = Image.open(ROOT / action["preview"])
        gif_frame_count = int(getattr(gif, "n_frames", 1))
        gif_actual_durations = []
        for frame_index in range(gif_frame_count):
            gif.seek(frame_index)
            gif_actual_durations.append(int(gif.info.get("duration", 0)))
        gif_actual_duration_delta = abs(sum(gif_actual_durations) - action["durationMs"])
        adjacent = [rgba_delta(output_cells[index], output_cells[index + 1]) for index in range(count - 1)]
        seam = rgba_delta(output_cells[-1], output_cells[0]) if action["loop"] else None
        median_adjacent = float(np.median(adjacent)) if adjacent else 0.0
        rife = json.loads((ROOT / action["rifeReport"]).read_text(encoding="utf-8-sig"))
        action_errors = []
        if empty:
            action_errors.append(f"empty active frames {empty}")
        if min(border_safety, default=-1) < 2:
            action_errors.append(f"minimum alpha border is {min(border_safety, default=-1)}px")
        if nonzero_transparent_rgb:
            action_errors.append(f"transparent RGB samples: {nonzero_transparent_rgb}")
        if key_mismatches:
            action_errors.append(f"source keys changed at even outputs {key_mismatches}")
        if padding_alpha:
            action_errors.append(f"padding alpha pixels: {padding_alpha}")
        if count != expected_count or action["endFrame"] != count - 1:
            action_errors.append("frame count/endFrame rule mismatch")
        if duration_delta > 0.01 or gif_duration_delta > 10.01 or gif_actual_duration_delta > 10.01:
            action_errors.append(
                f"duration mismatch {duration_delta:.3f}ms / GIF metadata {gif_duration_delta:.3f}ms / GIF file {gif_actual_duration_delta:.3f}ms"
            )
        if gif_frame_count != count or gif_actual_durations != action["gifDurationsMs"]:
            action_errors.append("runtime-clock GIF frames or per-frame durations differ from the sprite manifest")
        if rife["mode"] != ("loop" if action["loop"] else "one-shot"):
            action_errors.append("RIFE mode mismatch")
        if not rife["validation"]["originalKeyFramesPreservedAtEvenIndices"]:
            action_errors.append("RIFE did not preserve original keys")
        if rife["validation"]["emptyFrames"] or rife["validation"]["touchingFrames"]:
            action_errors.append("RIFE reported empty or touching frames")
        errors.extend(f"{kind}: {message}" for message in action_errors)
        actions[kind] = {
            "frameCount": count,
            "endFrame": action["endFrame"],
            "activeEmptyFrames": empty,
            "minimumTransparentBorderPx": min(border_safety, default=None),
            "paddingCells": cols * rows - count,
            "paddingAlphaPixels": padding_alpha,
            "layoutUnusedCellFraction": (cols * rows - count) / (cols * rows),
            "activeCellTransparentPixelFraction": 1 - visible_alpha_pixels / (width * height * count),
            "nonzeroRgbValuesInTransparentPixels": nonzero_transparent_rgb,
            "sourceKeyMismatchesAtEvenOutputs": key_mismatches,
            "durationMs": sum(action["frameDurationsMs"]),
            "gifDurationMs": sum(action["gifDurationsMs"]),
            "gifFileFrameCount": gif_frame_count,
            "gifFileDurationMs": sum(gif_actual_durations),
            "gifFileDurationsMatchManifest": gif_actual_durations == action["gifDurationsMs"],
            "loopSeamRgbaDelta": seam,
            "medianAdjacentRgbaDelta": median_adjacent,
            "loopSeamToMedianRatio": (seam / median_adjacent if seam is not None and median_adjacent else None),
            "rifeMode": rife["mode"],
            "rifePipelineVersion": rife["pipelineVersion"],
            "rifeHeldSourceKeyFallbacks": rife["validation"]["middleFrameHeldSourceKeyFallbacks"],
            "errors": action_errors,
        }
    if not budget["budgetPassed"]:
        errors.extend(f"budget: {message}" for message in budget["errors"])
    largest = sorted(budget["textures"], key=lambda item: item["MiB"], reverse=True)
    budget_review = {
        "classification": (
            "within_target"
            if budget["closureMiB"] <= budget["limits"]["targetMiB"]
            else "above_target_within_review_limit"
            if budget["closureMiB"] <= budget["limits"]["reviewLimitMiB"]
            else "above_review_limit"
        ),
        "targetMiB": budget["limits"]["targetMiB"],
        "reviewLimitMiB": budget["limits"]["reviewLimitMiB"],
        "closureMiB": budget["closureMiB"],
        "overTargetMiB": max(0, budget["closureMiB"] - budget["limits"]["targetMiB"]),
        "largestSheets": largest[:2],
        "reason": "The fixed-scale two-crew long gun requires wide cells; attack retains source-native flash/smoke and death retains both separate prone bodies. Layout padding is already minimized, and reducing body scale or deleting native event poses would violate the approved engineering-line scale/action record.",
        "integrationBoundary": (
            "User explicitly authorized runtime import of the above-target, within-limit crowd asset."
            if runtime_active
            else "Candidate remains task-local. A later runtime import still requires explicit user approval of this above-target crowd asset."
        ),
    }
    report = {
        "unitKey": manifest["unitKey"],
        "scope": "Offline PNG layout, alpha safety, key preservation, timing, RIFE reports and crowd budget only; no game/runtime test.",
        "runtimeIntegrationActive": runtime_active,
        "testsRun": False,
        "actions": actions,
        "budgetReport": "sprite-budget-report.json",
        "budget": budget,
        "budgetReview": budget_review,
        "errors": errors,
        "offlineSpriteChecksPassed": not errors,
    }
    write_json(ROOT / "sprite-validation-report.json", report)
    if errors:
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 1

    manifest["formalBudgetCheckRun"] = True
    manifest["formalBudgetPassed"] = True
    manifest["budgetReview"] = budget_review
    manifest["offlineSpriteChecksRun"] = True
    manifest["offlineSpriteChecksPassed"] = True
    manifest["validationReport"] = "sprite-validation-report.json"
    manifest["status"] = delivery_status
    write_json(manifest_path, manifest)

    plan_path = ROOT / "sprite-production-plan.json"
    plan = json.loads(plan_path.read_text(encoding="utf-8-sig"))
    plan["formalBudgetCheckRun"] = True
    plan["formalBudgetPassed"] = True
    plan["offlineSpriteChecksPassed"] = True
    plan["productionStatus"] = delivery_status
    write_json(plan_path, plan)

    source_path = ROOT / "manifest.json"
    source = json.loads(source_path.read_text(encoding="utf-8-sig"))
    source["status"] = delivery_status
    source["budget"]["formalChecksRun"] = True
    source["budget"]["formalChecksPassed"] = True
    source["budget"]["review"] = budget_review
    source["spriteProducts"]["status"] = delivery_status
    source["spriteProducts"]["validationReport"] = "sprite-validation-report.json"
    write_json(source_path, source)

    task_path = ROOT.parent / "task-index.json"
    task = json.loads(task_path.read_text(encoding="utf-8-sig"))
    task["status"] = delivery_status
    task["animationGate"]["status"] = delivery_status
    task["animationGate"]["formalBudgetCheckRun"] = True
    task["animationGate"]["formalBudgetPassed"] = True
    task["animationGate"]["offlineSpriteChecksPassed"] = True
    task["animationGate"]["spriteValidationReport"] = "animations-v08-doubao-20260904/sprite-validation-report.json"
    write_json(task_path, task)
    print(f"Offline sprite checks passed; crowd closure {budget['closureMiB']:.3f} MiB.", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
