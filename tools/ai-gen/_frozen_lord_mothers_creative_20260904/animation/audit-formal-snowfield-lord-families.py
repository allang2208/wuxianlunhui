#!/usr/bin/env python3
"""Offline audit for the formal snowfield-lord body-action packages.

This script deliberately stays at the asset layer: source/provenance, atlas
geometry, alpha cleanliness, RIFE key preservation, GIF timing, action clocks,
and family decode budgets.  It does not launch or exercise the game runtime.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import av
import numpy as np
from PIL import Image, ImageDraw, ImageSequence


TASK_ROOT = Path(__file__).resolve().parents[1]
REPO = TASK_ROOT.parents[2]
FORMAL = TASK_ROOT / "animation" / "formal"
REPORT_JSON = FORMAL / "standard-workflow-audit-20260905.json"
KEYFRAME_DIR = FORMAL / "audit-keyframes-20260905"


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def resolve_asset(raw: str) -> Path:
    path = Path(raw)
    if path.is_absolute():
        return path
    return (REPO if path.parts and path.parts[0] == "tools" else TASK_ROOT) / path


def split_cells(sheet: np.ndarray, width: int, height: int, cols: int, count: int) -> list[np.ndarray]:
    return [
        sheet[(i // cols) * height:(i // cols + 1) * height,
              (i % cols) * width:(i % cols + 1) * width]
        for i in range(count)
    ]


def output_event_frames(clock: dict[str, Any]) -> list[int]:
    fields: dict[str, Any] = {}
    fields.update(clock.get("events", {}))
    for key, value in clock.items():
        if key.endswith("Frame") or key.endswith("Frames") or "ConsumerFrame" in key:
            fields[key] = value
    frames: list[int] = []
    for key, value in fields.items():
        lowered = key.lower()
        if any(token in lowered for token in ("source", "consumer", "interval", "offset")):
            continue
        if not (key.endswith("Frame") or key.endswith("Frames")):
            continue
        values = value if isinstance(value, list) else [value]
        frames.extend(int(item) for item in values if isinstance(item, (int, float)))
    return sorted(set(frames))


def audit_consumer_frames(clock: dict[str, Any], errors: list[str]) -> None:
    fields: dict[str, Any] = {}
    fields.update(clock.get("events", {}))
    fields.update({k: v for k, v in clock.items() if "ConsumerFrame" in k or k.endswith("Frame") or k.endswith("Frames")})
    for key, value in fields.items():
        suffix = None
        if key.endswith("ConsumerFrameIfOneBased"):
            suffix = "ConsumerFrameIfOneBased"
            source_key = key[:-len(suffix)] + "Frame"
        elif key.endswith("ConsumerFramesIfOneBased"):
            suffix = "ConsumerFramesIfOneBased"
            source_key = key[:-len(suffix)] + "Frames"
        else:
            continue
        if source_key not in fields:
            errors.append(f"missing 0-based partner for {key}")
            continue
        left = fields[source_key] if isinstance(fields[source_key], list) else [fields[source_key]]
        right = value if isinstance(value, list) else [value]
        if len(left) != len(right) or any(int(b) != int(a) + 1 for a, b in zip(left, right)):
            errors.append(f"0/1-based mapping mismatch: {source_key} -> {key}")


def decode_video_contract(path: Path) -> tuple[int, float]:
    with av.open(str(path)) as container:
        stream = container.streams.video[0]
        fps = float(stream.average_rate)
        count = sum(1 for _ in container.decode(stream))
    return count, fps


def make_keyframe_montage(asset: str, rows: list[tuple[str, list[np.ndarray], list[int]]]) -> Path:
    thumb_w, thumb_h, label_h, pad, max_samples = 176, 128, 22, 8, 6
    width = (thumb_w + pad * 2) * max_samples
    height = (thumb_h + label_h + pad * 2) * len(rows)
    canvas = Image.new("RGB", (width, height), "#202328")
    draw = ImageDraw.Draw(canvas)
    for row_index, (action, cells, indices) in enumerate(rows):
        row_y = row_index * (thumb_h + label_h + pad * 2)
        for col_index, frame_index in enumerate(indices[:max_samples]):
            cell = Image.fromarray(cells[frame_index], "RGBA")
            checker = Image.new("RGB", cell.size, "#50545a")
            tile = 12
            checker_draw = ImageDraw.Draw(checker)
            for y in range(0, cell.height, tile):
                for x in range(0, cell.width, tile):
                    if (x // tile + y // tile) % 2:
                        checker_draw.rectangle((x, y, x + tile - 1, y + tile - 1), fill="#3d4147")
            checker.paste(cell.convert("RGB"), mask=cell.getchannel("A"))
            checker.thumbnail((thumb_w, thumb_h), Image.Resampling.LANCZOS)
            x = col_index * (thumb_w + pad * 2) + pad + (thumb_w - checker.width) // 2
            y = row_y + pad + (thumb_h - checker.height)
            canvas.paste(checker, (x, y))
            draw.text((col_index * (thumb_w + pad * 2) + pad, row_y + pad + thumb_h + 3),
                      f"{action} f{frame_index}", fill="#f2f5f7")
    KEYFRAME_DIR.mkdir(parents=True, exist_ok=True)
    output = KEYFRAME_DIR / f"{asset}-formal-keyframes.png"
    canvas.save(output, optimize=True)
    return output


def audit_action(manifest_path: Path) -> tuple[dict[str, Any], list[np.ndarray]]:
    manifest = read_json(manifest_path)
    action = manifest["action"]
    errors: list[str] = []
    warnings: list[str] = []
    evidence: dict[str, Any] = {}

    if not manifest.get("sourceVideoProvider"):
        errors.append("missing manifest field: sourceVideoProvider")
    for field in ("sourceVideo", "sourceProvenance", "sourceReference",
                  "sourceSheet", "finalSheet", "previewGif", "sourceContactSheet",
                  "finalContactSheet"):
        value = manifest.get(field)
        if not value:
            errors.append(f"missing manifest field: {field}")
        elif not resolve_asset(value).exists():
            errors.append(f"missing file for {field}: {value}")

    report_raw = manifest.get("processingReport") or manifest.get("rifeReport")
    if not report_raw:
        errors.append("missing processingReport/rifeReport")
        report = {}
    else:
        report_path = resolve_asset(report_raw)
        if not report_path.exists():
            errors.append(f"missing interpolation report: {report_raw}")
            report = {}
        else:
            report = read_json(report_path)

    layout = manifest["layout"]
    fw, fh = int(layout["frameWidth"]), int(layout["frameHeight"])
    cols, rows = int(layout["columns"]), int(layout["rows"])
    count, end = int(layout["frameCount"]), int(layout["endFrame"])
    final_path = resolve_asset(manifest["finalSheet"])
    with Image.open(final_path) as image:
        mode = image.mode
        atlas = np.asarray(image.convert("RGBA"))
    actual_h, actual_w = atlas.shape[:2]
    if mode != "RGBA":
        errors.append(f"final atlas mode is {mode}, expected RGBA")
    if actual_w != fw * cols or actual_h != fh * rows:
        errors.append(f"atlas/layout mismatch: {actual_w}x{actual_h} vs {fw * cols}x{fh * rows}")
    if max(actual_w, actual_h) > 4096:
        errors.append(f"atlas exceeds 4096: {actual_w}x{actual_h}")
    if end != count - 1 or int(manifest["interpolation"]["outputFrameCount"]) != count:
        errors.append("frameCount/endFrame/interpolation output count mismatch")

    capacity = cols * rows
    all_cells = split_cells(atlas, fw, fh, cols, capacity)
    cells = all_cells[:count]
    empty: list[int] = []
    touching: list[int] = []
    bottoms: list[int] = []
    for index, cell in enumerate(cells):
        ys, xs = np.where(cell[..., 3] > 8)
        if not len(xs):
            empty.append(index)
            continue
        bottoms.append(int(ys.max()))
        if int(xs.min()) <= 2 or int(ys.min()) <= 2 or int(xs.max()) >= fw - 3 or int(ys.max()) >= fh - 3:
            touching.append(index)
    dirty_rgb = int(np.count_nonzero(atlas[..., :3][atlas[..., 3] == 0]))
    trailing_nonempty = [count + i for i, cell in enumerate(all_cells[count:]) if np.any(cell[..., 3] > 8)]
    trailing_ratio = (capacity - count) / capacity
    if empty:
        errors.append(f"empty valid frames: {empty}")
    if touching:
        errors.append(f"touching valid frames: {touching}")
    if dirty_rgb:
        errors.append(f"nonzero RGB values under fully transparent pixels: {dirty_rgb}")
    if trailing_nonempty:
        errors.append(f"nonempty trailing cells: {trailing_nonempty}")
    if trailing_ratio > 0.125:
        errors.append(f"trailing empty ratio exceeds 12.5%: {trailing_ratio:.2%}")

    decoded_bytes = actual_w * actual_h * 4
    atlas_info = manifest.get("atlas", {})
    if int(atlas_info.get("decodedRgbaBytes", -1)) != decoded_bytes:
        errors.append("manifest decoded RGBA bytes do not match atlas dimensions")
    if int(atlas_info.get("width", -1)) != actual_w or int(atlas_info.get("height", -1)) != actual_h:
        errors.append("manifest atlas width/height do not match file")

    source_count = int(manifest["interpolation"]["sourceFrameCount"])
    source_path = resolve_asset(manifest["sourceSheet"])
    with Image.open(source_path) as image:
        source = np.asarray(image.convert("RGBA"))
    source_cols = max(1, source.shape[1] // fw)
    source_cells = split_cells(source, fw, fh, source_cols, source_count)
    mapping = manifest["interpolation"].get("keyFrameIndexMapping")
    if isinstance(mapping, str) and "* 2" in mapping:
        key_preserved = all(np.array_equal(source_cell, cells[index * 2]) for index, source_cell in enumerate(source_cells))
    elif isinstance(mapping, list):
        key_preserved = len(mapping) == count
    else:
        key_preserved = False
    if not key_preserved:
        errors.append("native key-frame mapping is not preserved exactly")

    rife_validation = report.get("validation", {})
    for key in ("middleFrameHeldSourceKeyFallbacks",):
        if rife_validation.get(key):
            errors.append(f"RIFE fallback frames present: {rife_validation[key]}")
    for key in ("visibleDarkOutlierFrames", "visibleRedOutlierFrames", "visibleBlueSpillFrames", "visibleCyanSpillFrames"):
        if rife_validation.get(key):
            errors.append(f"RIFE visible outliers in {key}: {rife_validation[key]}")

    gif_path = resolve_asset(manifest["previewGif"])
    gif_frames, gif_durations = 0, []
    with Image.open(gif_path) as gif:
        for frame in ImageSequence.Iterator(gif):
            gif_frames += 1
            gif_durations.append(int(frame.info.get("duration", gif.info.get("duration", 0))))
    duration_ms = int(manifest["clock"]["durationMs"])
    gif_duration = sum(gif_durations)
    if gif_frames != count:
        errors.append(f"GIF frame count mismatch: {gif_frames} vs {count}")
    if abs(gif_duration - duration_ms) > 10:
        errors.append(f"GIF duration mismatch: {gif_duration}ms vs {duration_ms}ms")
    timing = manifest.get("gifTimingMs")
    if timing and (len(timing) != count or abs(sum(timing) - duration_ms) > 10):
        errors.append("gifTimingMs does not reproduce the formal clock")

    clock = manifest["clock"]
    expected_rate = count * 1000 / duration_ms
    if not math.isclose(float(clock["frameRate"]), expected_rate, rel_tol=0, abs_tol=1e-6):
        errors.append("clock frameRate is not derived from frameCount/durationMs")
    wrap = bool(manifest["interpolation"].get("wrap"))
    if (int(clock["repeat"]) == -1) != wrap:
        errors.append("loop wrap/repeat contract mismatch")
    coverage = np.zeros(count, dtype=np.int16)
    for phase, interval in clock.get("phases", {}).items():
        if len(interval) != 2:
            errors.append(f"invalid phase interval: {phase}")
            continue
        start, stop = map(int, interval)
        if start < 0 or stop < start or stop >= count:
            errors.append(f"phase out of range: {phase}={interval}")
        else:
            coverage[start:stop + 1] += 1
    if len(coverage) and np.any(coverage != 1):
        errors.append("phase coverage has gaps or overlaps")
    out_events = output_event_frames(clock)
    if any(frame < 0 or frame >= count for frame in out_events):
        errors.append(f"output event frame outside valid range: {out_events}")
    audit_consumer_frames(clock, errors)

    video_path = resolve_asset(manifest["sourceVideo"])
    decoded_frames, source_fps = decode_video_contract(video_path)
    selected = [int(value) for value in manifest["selectedSourceFrames"]]
    if any(frame < 0 or frame >= decoded_frames for frame in selected):
        errors.append("selected source frame outside decoded video")
    if not math.isclose(source_fps, float(manifest["sourceVideoFps"]), rel_tol=0, abs_tol=0.01):
        errors.append(f"source FPS mismatch: decoded {source_fps} vs manifest {manifest['sourceVideoFps']}")
    if selected != sorted(set(selected)):
        warnings.append("selectedSourceFrames are intentionally non-monotonic or repeated; verify exact-reuse semantics")

    root_motion = str(manifest.get("rootMotion", ""))
    root_policy = "fixed-source-anchor" if "fixed raw-video source anchor" in root_motion else "legacy-lower-body-registration"
    if root_policy == "legacy-lower-body-registration":
        warnings.append("legacy lower-body registration retained; accepted visual contacts require manual root-motion review")

    evidence.update({
        "manifest": str(manifest_path.relative_to(TASK_ROOT)).replace("\\", "/"),
        "action": action,
        "provider": manifest.get("sourceVideoProvider"),
        "sourceVideoDecodedFrames": decoded_frames,
        "sourceVideoFps": source_fps,
        "frameSize": [fw, fh],
        "atlasSize": [actual_w, actual_h],
        "frameCount": count,
        "durationMs": duration_ms,
        "gifDurationMs": gif_duration,
        "targetBodyHeight": int(layout["targetBodyHeight"]),
        "footY": int(layout["footY"]),
        "alphaBottomRange": [min(bottoms), max(bottoms)] if bottoms else None,
        "trailingEmptyRatio": round(trailing_ratio, 6),
        "decodedRgbaMiB": round(decoded_bytes / 1024 / 1024, 4),
        "nativeKeysPreservedExactly": key_preserved,
        "outputEventFrames0Based": out_events,
        "rootPolicy": root_policy,
        "errors": errors,
        "warnings": warnings,
        "result": "pass" if not errors else "fail",
    })
    return evidence, cells


def main() -> None:
    manifest_paths = sorted(FORMAL.rglob("spritesheet-manifest.json"))
    actions: list[dict[str, Any]] = []
    family_cells: dict[str, list[tuple[str, list[np.ndarray], list[int]]]] = {}
    for path in manifest_paths:
        result, cells = audit_action(path)
        actions.append(result)
        samples = sorted(set([0, *result["outputEventFrames0Based"], len(cells) // 2, len(cells) - 1]))
        if len(samples) < 4:
            samples = sorted(set([0, len(cells) // 3, len(cells) * 2 // 3, len(cells) - 1]))
        asset = read_json(path)["asset"]
        family_cells.setdefault(asset, []).append((result["action"], cells, samples))

    family_results: list[dict[str, Any]] = []
    by_key = {(read_json(path)["asset"], read_json(path)["action"]): result
              for path, result in zip(manifest_paths, actions)}
    for path in sorted(FORMAL.glob("*/family-sprite-budget-manifest.json")):
        family = read_json(path)
        errors: list[str] = []
        heights = set()
        total = 0.0
        for sheet in family["sheets"]:
            key = (path.parent.name, sheet["action"])
            action = by_key.get(key)
            if action is None:
                errors.append(f"family entry has no action manifest: {sheet['action']}")
                continue
            heights.add(action["targetBodyHeight"])
            total += action["decodedRgbaMiB"]
            if [sheet["frameWidth"], sheet["frameHeight"]] != action["frameSize"]:
                errors.append(f"family frame size mismatch: {sheet['action']}")
            if int(sheet["frameCount"]) != action["frameCount"] or int(sheet["endFrame"]) != action["frameCount"] - 1:
                errors.append(f"family frame count mismatch: {sheet['action']}")
            if not math.isclose(float(sheet["decodedRgbaMiB"]), action["decodedRgbaMiB"], abs_tol=0.0001):
                errors.append(f"family decoded size mismatch: {sheet['action']}")
            if not resolve_asset(sheet["path"]).exists():
                errors.append(f"family sheet path missing: {sheet['action']}")
        total = round(total, 4)
        if len(heights) != 1:
            errors.append(f"family target body heights are inconsistent: {sorted(heights)}")
        if not math.isclose(float(family["decodedRgbaMiB"]), total, abs_tol=0.0001):
            errors.append(f"family decoded total mismatch: {family['decodedRgbaMiB']} vs {total}")
        if total > float(family["bossHardStopMiB"]):
            errors.append("family exceeds boss hard stop")
        if total > float(family["bossTargetMiB"]) and not family.get("targetException"):
            errors.append("family exceeds boss target without targetException")
        montage = make_keyframe_montage(path.parent.name, family_cells[path.parent.name])
        family_results.append({
            "asset": path.parent.name,
            "actionCount": len(family["sheets"]),
            "targetBodyHeight": next(iter(heights)) if len(heights) == 1 else sorted(heights),
            "decodedRgbaMiB": total,
            "bossTargetMiB": family["bossTargetMiB"],
            "bossHardStopMiB": family["bossHardStopMiB"],
            "targetException": family.get("targetException"),
            "keyframeMontage": str(montage.relative_to(TASK_ROOT)).replace("\\", "/"),
            "errors": errors,
            "result": "pass" if not errors else "fail",
        })

    error_count = sum(len(item["errors"]) for item in actions) + sum(len(item["errors"]) for item in family_results)
    warning_count = sum(len(item["warnings"]) for item in actions)
    report = {
        "version": 1,
        "scope": "offline formal sprite/source/provenance/interpolation/clock/GIF/family-budget audit; no game runtime, build or browser validation",
        "standardReferences": [
            "SKILL.md animation index",
            "skill/16b-animation-alignment-and-timing.md sections 1.1-7",
            "tools/ai-gen/WORKFLOW.md section 3.6",
            ".agents/skills/game-dev-lessons/lessons.md sections 62-65",
        ],
        "actionCount": len(actions),
        "familyCount": len(family_results),
        "errorCount": error_count,
        "warningCount": warning_count,
        "result": "pass" if error_count == 0 else "fail",
        "actions": actions,
        "families": family_results,
    }
    REPORT_JSON.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({
        "report": str(REPORT_JSON),
        "result": report["result"],
        "actions": len(actions),
        "families": len(family_results),
        "errors": error_count,
        "warnings": warning_count,
    }, ensure_ascii=False, indent=2))
    if error_count:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
