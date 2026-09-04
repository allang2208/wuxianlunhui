#!/usr/bin/env python3
"""Measure studio-white matte contamination before and after formal RIFE.

The approved attack contains pale muzzle smoke. Raw attack cutouts therefore
exclude the saved effect mask from the actor edge check, while the final attack
sheet reports its combined value without treating the approved effect as a
failure.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage


ROOT = Path(__file__).resolve().parent
POST = ROOT / "postprocess"
SOURCE_REPORT = POST / "formal-source-report.json"
CUTOUT_DIR = POST / "selected-cutouts"
SHEET_DIR = POST / "sheets-rife"
EFFECT_DIR = POST / "effect-masks-rife"
REPORT_PATH = POST / "white-edge-report.json"
PREVIEW_DIR = POST / "previews" / "white-edge-review"
WHITE_THRESHOLD = 235
ALPHA_MIN = 10
ALPHA_MAX = 245
MAX_RATIO = 0.005


def metrics(rgba: np.ndarray, excluded: np.ndarray | None = None) -> dict[str, int | float]:
    alpha = rgba[..., 3]
    semi = (alpha > ALPHA_MIN) & (alpha < ALPHA_MAX)
    if excluded is not None:
        semi &= ~excluded
    white = semi & np.all(rgba[..., :3] >= WHITE_THRESHOLD, axis=2)
    semi_count = int(semi.sum())
    white_count = int(white.sum())
    ratio = white_count / max(1, semi_count)
    return {
        "semiTransparentEdgePixels": semi_count,
        "whiteishSemiTransparentPixels": white_count,
        "whiteishRatio": ratio,
    }


def source_cutout_metrics(action: str) -> dict[str, object]:
    frames: dict[str, object] = {}
    for path in sorted((CUTOUT_DIR / action).glob("source-f*.png")):
        rgba = np.asarray(Image.open(path).convert("RGBA"))
        excluded = None
        effect_path = path.parent / "effect-masks" / path.name
        if effect_path.exists():
            effect = np.asarray(Image.open(effect_path).convert("L"))
            if effect.shape != rgba.shape[:2]:
                raise ValueError(f"effect mask size mismatch: {effect_path}")
            excluded = effect > 0
        frame_metrics = metrics(rgba, excluded)
        frame_metrics["approvedEffectPixelsExcluded"] = int(excluded.sum()) if excluded is not None else 0
        frames[path.stem] = frame_metrics

    ratios = [float(value["whiteishRatio"]) for value in frames.values()]
    white_pixels = [int(value["whiteishSemiTransparentPixels"]) for value in frames.values()]
    maximum = max(ratios, default=0.0)
    return {
        "frames": frames,
        "totalWhiteishSemiTransparentPixels": sum(white_pixels),
        "maximumFrameWhiteishRatio": maximum,
        "threshold": MAX_RATIO,
        "passes": maximum <= MAX_RATIO,
    }


def formal_sheet_metrics(action: str, spec: dict[str, object]) -> dict[str, object]:
    sheet = np.asarray(Image.open(SHEET_DIR / f"{action}.png").convert("RGBA"))
    width = int(spec["frameWidth"])
    height = int(spec["frameHeight"])
    count = int(spec["finalFrameCount"])
    effect_sheet_path = EFFECT_DIR / f"{action}.png"
    effect_sheet = np.asarray(Image.open(effect_sheet_path).convert("L")) if effect_sheet_path.exists() else None
    frames: dict[str, object] = {}
    cells: list[np.ndarray] = []
    foot_matte_counts: list[int] = []
    for index in range(count):
        row, col = divmod(index, 8)
        cell = sheet[row * height:(row + 1) * height, col * width:(col + 1) * width]
        cells.append(cell.copy())
        excluded = None
        if effect_sheet is not None:
            excluded = effect_sheet[row * height:(row + 1) * height, col * width:(col + 1) * width] > 0
        frame_metrics = metrics(cell, excluded)
        frame_metrics["approvedEffectPixelsExcluded"] = int(excluded.sum()) if excluded is not None else 0
        foot_matte = 0
        if action in {"running", "attacking"}:
            alpha = cell[..., 3]
            ys, xs = np.where(alpha > 32)
            if len(ys):
                visible = alpha > 0
                inside = ndimage.distance_transform_edt(visible)
                y0, y1 = int(ys.min()), int(ys.max())
                x0, x1 = int(xs.min()), int(xs.max())
                yy, xx = np.indices(alpha.shape)
                rgb = cell[..., :3].astype(np.float32)
                luma = rgb.mean(axis=2)
                chroma = rgb.max(axis=2) - rgb.min(axis=2)
                foot_matte = int((
                    visible
                    & (inside <= 6.0)
                    & (yy >= y0 + 0.72 * (y1 - y0 + 1))
                    & (xx >= x0 + 0.10 * (x1 - x0 + 1))
                    & (luma >= 150.0)
                    & (chroma <= 40.0)
                    & (alpha >= 8)
                ).sum())
        frame_metrics["neutralFootMattePixels"] = foot_matte
        foot_matte_counts.append(foot_matte)
        frames[str(index)] = frame_metrics

    ratios = [float(value["whiteishRatio"]) for value in frames.values()]
    white_pixels = [int(value["whiteishSemiTransparentPixels"]) for value in frames.values()]
    maximum = max(ratios, default=0.0)
    result: dict[str, object] = {
        "frames": frames,
        "totalWhiteishSemiTransparentPixels": sum(white_pixels),
        "maximumFrameWhiteishRatio": maximum,
        "threshold": MAX_RATIO,
        "strictScreenApplicable": True,
        "neutralFootMattePixelsTotal": sum(foot_matte_counts),
        "neutralFootMattePixelsMaximumFrame": max(foot_matte_counts, default=0),
        "neutralFootMatteStrictScreenApplicable": action in {"running", "attacking"},
        "passes": maximum <= MAX_RATIO and (
            action not in {"running", "attacking"} or sum(foot_matte_counts) == 0
        ),
    }
    if effect_sheet is not None:
        result["exemption"] = "approved pale muzzle flash and smoke excluded by the aligned formal effect mask"
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    review_indices = sorted(set(round(value) for value in np.linspace(0, count - 1, min(8, count))))
    thumb_width = 288
    thumb_height = round(height * thumb_width / width)
    label_height = 24
    contact = Image.new("RGB", (thumb_width * len(review_indices), thumb_height + label_height), "#20242a")
    draw = ImageDraw.Draw(contact)
    for position, index in enumerate(review_indices):
        cell = cells[index]
        yy, xx = np.indices(cell.shape[:2])
        shade = np.where(((xx // 16 + yy // 16) % 2)[..., None], 58, 82)
        background = np.repeat(shade, 3, axis=2).astype(np.float32)
        alpha = cell[..., 3:4].astype(np.float32) / 255.0
        rgb = cell[..., :3].astype(np.float32) * alpha + background * (1.0 - alpha)
        preview = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB")
        preview = preview.resize((thumb_width, thumb_height), Image.Resampling.LANCZOS)
        x = position * thumb_width
        contact.paste(preview, (x, 0))
        draw.text((x + 5, thumb_height + 4), f"{action} f{index}", fill="white")
    preview_path = PREVIEW_DIR / f"{action}-contact.png"
    contact.save(preview_path)
    result["checkerContact"] = str(preview_path.relative_to(ROOT)).replace("\\", "/")
    return result


def main() -> None:
    source = json.loads(SOURCE_REPORT.read_text(encoding="utf-8"))
    report: dict[str, object] = {
        "schemaVersion": 1,
        "date": "2026-09-01",
        "unitKey": "steel_shield_assault",
        "assetOnly": True,
        "runtimeIntegration": False,
        "screen": {
            "alphaRangeExclusive": [ALPHA_MIN, ALPHA_MAX],
            "whiteishRgbMinimumInclusive": WHITE_THRESHOLD,
            "maximumAllowedRatio": MAX_RATIO,
        },
        "sourceCutouts": {},
        "formalRifeSheets": {},
    }
    for action, spec in source["actions"].items():
        report["sourceCutouts"][action] = source_cutout_metrics(action)
        report["formalRifeSheets"][action] = formal_sheet_metrics(action, spec)

    failures = []
    for stage in ("sourceCutouts", "formalRifeSheets"):
        for action, result in report[stage].items():
            if result["passes"] is False:
                failures.append(f"{stage}:{action}")
    report["failures"] = failures
    report["passes"] = not failures
    REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "report": str(REPORT_PATH),
        "passes": report["passes"],
        "failures": failures,
        "sourceMaximumRatios": {
            action: result["maximumFrameWhiteishRatio"]
            for action, result in report["sourceCutouts"].items()
        },
        "formalMaximumRatios": {
            action: result["maximumFrameWhiteishRatio"]
            for action, result in report["formalRifeSheets"].items()
        },
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
