#!/usr/bin/env python3
"""Normalize selected Elise animation sheets without flattening pose changes.

Every frame in a selected state receives one shared scale factor. Content is
scaled around its torso center and its own measured foot line, so crouching,
running extension, and weapon arcs keep their authored relative proportions.
The frame grid and animation configuration remain unchanged.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]


def bbox(rgba: np.ndarray, threshold: int = 16) -> tuple[int, int, int, int]:
    ys, xs = np.where(rgba[..., 3] > threshold)
    if not len(xs):
        raise RuntimeError("empty frame")
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def torso_x(rgba: np.ndarray) -> float:
    mask = rgba[..., 3] > 32
    ys, xs = np.where(mask)
    if not len(xs):
        return rgba.shape[1] / 2
    top, bottom = int(ys.min()), int(ys.max())
    height = bottom - top + 1
    band = mask[top + round(height * 0.30):top + round(height * 0.58) + 1]
    _, bx = np.where(band)
    return float(np.median(bx)) if len(bx) else float(np.median(xs))


def resize_premultiplied(crop: np.ndarray, width: int, height: int) -> np.ndarray:
    source = crop.astype(np.float32) / 255.0
    alpha = source[..., 3]
    premul = source[..., :3] * alpha[..., None]
    resized_alpha = cv2.resize(alpha, (width, height), interpolation=cv2.INTER_LANCZOS4)
    resized_rgb = cv2.resize(premul, (width, height), interpolation=cv2.INTER_LANCZOS4)
    resized_alpha = np.clip(resized_alpha, 0.0, 1.0)
    out_rgb = np.zeros_like(resized_rgb)
    visible = resized_alpha > (1.0 / 255.0)
    out_rgb[visible] = resized_rgb[visible] / resized_alpha[visible, None]
    out = np.dstack([np.clip(out_rgb, 0.0, 1.0), resized_alpha])
    return np.clip(np.rint(out * 255.0), 0, 255).astype(np.uint8)


def normalize_sheet(source: Path, output: Path, spec: dict, factor: float) -> dict:
    fw = int(spec["frameWidth"])
    fh = int(spec["frameHeight"])
    cols = int(spec["cols"])
    rows = int(spec["rows"])
    frame_count = int(spec["frameCount"])
    sheet = np.asarray(Image.open(source).convert("RGBA"))
    if sheet.shape[1] != fw * cols or sheet.shape[0] != fh * rows:
        raise RuntimeError(f"grid mismatch for {source}")
    result = np.zeros_like(sheet)
    before_heights: list[int] = []
    after_heights: list[int] = []
    feet: list[int] = []
    touching: list[int] = []

    for index in range(frame_count):
        col, row = index % cols, index // cols
        cell = sheet[row * fh:(row + 1) * fh, col * fw:(col + 1) * fw]
        x0, y0, x1, y1 = bbox(cell)
        anchor_x = torso_x(cell)
        foot_y = y1
        crop = cell[y0:y1 + 1, x0:x1 + 1]
        new_w = max(1, round(crop.shape[1] * factor))
        new_h = max(1, round(crop.shape[0] * factor))
        scaled = resize_premultiplied(crop, new_w, new_h)
        local_anchor_x = (anchor_x - x0) * factor
        dx = round(anchor_x - local_anchor_x)
        dy = foot_y - new_h + 1
        if dx < 2 or dy < 2 or dx + new_w > fw - 2 or dy + new_h > fh - 2:
            raise RuntimeError(
                f"{source.name} f{index} clips after scale {factor}: "
                f"{new_w}x{new_h} at ({dx},{dy}) in {fw}x{fh}"
            )
        result[row * fh + dy:row * fh + dy + new_h, col * fw + dx:col * fw + dx + new_w] = scaled
        placed = result[row * fh:(row + 1) * fh, col * fw:(col + 1) * fw]
        px0, py0, px1, py1 = bbox(placed)
        before_heights.append(y1 - y0 + 1)
        after_heights.append(py1 - py0 + 1)
        feet.append(py1)
        if px0 <= 2 or py0 <= 2 or px1 >= fw - 3 or py1 >= fh - 3:
            touching.append(index)

    output.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(result, "RGBA").save(output, optimize=True, compress_level=9)
    return {
        "source": str(source),
        "output": str(output),
        "factor": factor,
        "frameCount": frame_count,
        "beforeHeight": [min(before_heights), max(before_heights)],
        "afterHeight": [min(after_heights), max(after_heights)],
        "feet": [min(feet), max(feet)],
        "touchingFrames": touching,
    }


def parse_state(value: str) -> tuple[str, float]:
    if "=" not in value:
        raise argparse.ArgumentTypeError("use STATE=FACTOR, for example run=0.943")
    state, raw_factor = value.split("=", 1)
    factor = float(raw_factor)
    if not state or not 0.5 <= factor <= 1.5:
        raise argparse.ArgumentTypeError("state is required and factor must be 0.5..1.5")
    return state, factor


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out-dir", type=Path, required=True)
    parser.add_argument("--state", action="append", type=parse_state, required=True)
    args = parser.parse_args()

    config = json.loads((ROOT / "data" / "companion-config.json").read_text(encoding="utf-8"))
    elise = next(item for item in config["companions"] if item["id"] == "warrior_bruno")
    reports = []
    for state, factor in args.state:
        if state not in elise["animations"]:
            raise RuntimeError(f"unknown Elise animation state: {state}")
        spec = elise["animations"][state]
        source = ROOT / spec["src"]
        output = args.out_dir / source.name
        report = normalize_sheet(source, output, spec, factor)
        report["state"] = state
        reports.append(report)
        print(json.dumps(report, ensure_ascii=False), flush=True)
    (args.out_dir / "scale_report.json").write_text(
        json.dumps(reports, ensure_ascii=False, indent=2), encoding="utf-8"
    )


if __name__ == "__main__":
    main()
