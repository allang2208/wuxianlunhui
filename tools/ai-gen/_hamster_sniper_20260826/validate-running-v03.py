#!/usr/bin/env python3
"""Enhanced validation for running v03, including whole-frame dark flashes."""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parent
DIAG_PATH = ROOT / "diagnose-running-flicker.py"
SPEC = importlib.util.spec_from_file_location("running_diag", DIAG_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Cannot import {DIAG_PATH}")
DIAG = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = DIAG
SPEC.loader.exec_module(DIAG)

def dark_stats(cell: np.ndarray) -> dict[str, int]:
    mask = (cell[..., 3] > 96) & (np.max(cell[..., :3], axis=2) < 64)
    count, _, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 8)
    largest = int(stats[1:, cv2.CC_STAT_AREA].max()) if count > 1 else 0
    return {"pixels": int(mask.sum()), "largestComponent": largest}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--name", default="running-v03")
    parser.add_argument("--source-count", type=int, default=16)
    args = parser.parse_args()
    final_count = args.source_count * 2
    source_path = ROOT / "source-sheets-pre-interpolation" / f"{args.name}.png"
    final_path = ROOT / "sheets" / "interpolated" / f"{args.name}.png"
    gif_path = ROOT / "previews" / "interpolated" / f"{args.name}-interpolated.gif"
    output_path = ROOT / f"{args.name}-final-validation.json"

    source = DIAG.split_sheet(source_path, args.source_count)
    final = DIAG.split_sheet(final_path, final_count)
    metrics = [DIAG.metrics(cell) for cell in final]
    dark = [dark_stats(cell) for cell in final]

    odd = []
    for index in range(1, final_count, 2):
        left = index - 1
        right = (index + 1) % final_count
        neighbor_luma = (
            metrics[left]["foregroundLumaMean"] + metrics[right]["foregroundLumaMean"]
        ) / 2.0
        neighbor_dark = (dark[left]["pixels"] + dark[right]["pixels"]) / 2.0
        neighbor_component = (
            dark[left]["largestComponent"] + dark[right]["largestComponent"]
        ) / 2.0
        odd.append({
            "index": index,
            "lumaRatio": metrics[index]["foregroundLumaMean"] / neighbor_luma,
            "darkPixelRatio": dark[index]["pixels"] / neighbor_dark,
            "largestDarkComponentRatio": dark[index]["largestComponent"] / neighbor_component,
        })

    source_pairs = []
    for index in range(args.source_count):
        right = (index + 1) % args.source_count
        source_pairs.append({
            "from": index,
            "to": right,
            "visibleDelta": DIAG.visible_delta(source[index], source[right]),
            "bottom35AlphaIou": DIAG.alpha_iou(source[index], source[right], 0.35),
        })
    non_seam_deltas = np.asarray([pair["visibleDelta"] for pair in source_pairs[:-1]])
    seam_delta = source_pairs[-1]["visibleDelta"]

    gif = Image.open(gif_path)
    gif_frames = []
    for index in range(gif.n_frames):
        gif.seek(index)
        gif_frames.append(np.asarray(gif.convert("RGB")).copy())
    gif_compare = []
    for index, cell in enumerate(final):
        expected = np.asarray(
            DIAG.checker(cell).resize((384, 384), Image.Resampling.LANCZOS)
        ).astype(np.int16)
        absolute = np.abs(expected - gif_frames[index].astype(np.int16))
        gif_compare.append({
            "index": index,
            "meanAbsoluteRgbDelta": float(absolute.mean()),
            "pixelsWithChannelDeltaOver30": int(np.count_nonzero(np.max(absolute, axis=2) > 30)),
        })

    failures = []
    for item in odd:
        if not 0.85 <= item["lumaRatio"] <= 1.15:
            failures.append(f"f{item['index']} whole-frame luma ratio {item['lumaRatio']:.3f}")
        if item["darkPixelRatio"] > 1.25 and item["largestDarkComponentRatio"] > 1.25:
            failures.append(
                f"f{item['index']} dark block ratios pixels={item['darkPixelRatio']:.3f} "
                f"component={item['largestDarkComponentRatio']:.3f}"
            )
    if max(item["meanAbsoluteRgbDelta"] for item in gif_compare) > 0.2:
        failures.append("GIF encoding differs materially from checker-composited PNG frames")
    seam_limit = float(np.percentile(non_seam_deltas, 95) * 1.15)
    if seam_delta > seam_limit:
        failures.append(f"loop seam delta {seam_delta:.3f} exceeds limit {seam_limit:.3f}")

    report = {
        "status": "pass" if not failures else "fail",
        "failures": failures,
        "thresholds": {
            "wholeFrameLumaRatio": [0.85, 1.15],
            "darkPixelAndComponentRatioMax": 1.25,
            "darkPixelDefinition": "alpha > 96 and max(RGB) < 64",
            "loopSeamLimit": seam_limit,
        },
        "oddFrameDiagnostics": odd,
        "sourcePairDiagnostics": source_pairs,
        "loopSeamDelta": seam_delta,
        "nonSeamDeltaP95": float(np.percentile(non_seam_deltas, 95)),
        "gifEncodingComparison": gif_compare,
    }
    output_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
