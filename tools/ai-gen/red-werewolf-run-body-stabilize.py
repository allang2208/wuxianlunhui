"""Stabilize the 12-frame RedWolfKing werewolf running loop.

This is the second pass after the coarse alpha-bottom alignment.  The coarse
pass used alpha > 10, so a faint fringe could touch the ground while the solid
body still appeared to bob.  This pass keeps every pixel and frame intact and
only applies whole-pixel vertical translations derived from the weighted alpha
centroid in the central torso band.

The most downward-shifted frame defines the shared runtime footY.  This keeps
all frames at or above the logical ground line without adding runtime bounce.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
ASSET = ROOT / "assets/enemies/red_wolf_king/werewolf_running.png"
PREVIEW = ROOT / "tools/ai-gen/red-werewolf-previews/red-werewolf-running.gif"
WORK_DIR = ROOT / "tools/ai-gen/_scratch/red-werewolf-run-body-stabilize-20260823"
BACKUP = WORK_DIR / "werewolf_running_before_body_stabilize.png"
REPORT = WORK_DIR / "report.json"

FRAME_W = 640
FRAME_H = 640
COLS = 8
ROWS = 6
FRAME_COUNT = 12
ALPHA_THRESHOLD = 10
TORSO_X0 = 192
TORSO_X1 = 448
TARGET_CENTROID_LOW = 405.0
TARGET_CENTROID_HIGH = 411.0
DISPLAY_SIZE = 235.9375


def crop_frame(sheet: Image.Image, index: int) -> Image.Image:
    x = index % COLS * FRAME_W
    y = index // COLS * FRAME_H
    return sheet.crop((x, y, x + FRAME_W, y + FRAME_H))


def alpha_metrics(frame: Image.Image) -> dict[str, float | int]:
    alpha = np.asarray(frame.getchannel("A"), dtype=np.float64)
    mask = alpha > ALPHA_THRESHOLD
    ys, _ = np.nonzero(mask)
    if not len(ys):
        raise ValueError("blank frame")

    band = alpha[:, TORSO_X0:TORSO_X1]
    band_mask = band > ALPHA_THRESHOLD
    band_ys, band_xs = np.nonzero(band_mask)
    if not len(band_ys):
        raise ValueError("blank torso band")
    weights = band[band_ys, band_xs]
    return {
        "alphaBottomInclusive": int(ys.max()),
        "torsoCentroidY": round(float(np.average(band_ys, weights=weights)), 4),
    }


def centroid_shift(centroid: float) -> int:
    target = min(TARGET_CENTROID_HIGH, max(TARGET_CENTROID_LOW, centroid))
    return int(round(target - centroid))


def translate_frame(frame: Image.Image, shift_y: int) -> Image.Image:
    output = Image.new("RGBA", (FRAME_W, FRAME_H), (0, 0, 0, 0))
    output.paste(frame, (0, shift_y))
    return output


def main() -> None:
    sheet = Image.open(ASSET).convert("RGBA")
    expected = (FRAME_W * COLS, FRAME_H * ROWS)
    if sheet.size != expected:
        raise ValueError(f"expected {expected}, got {sheet.size}")

    WORK_DIR.mkdir(parents=True, exist_ok=True)
    if not BACKUP.exists():
        shutil.copy2(ASSET, BACKUP)

    before_frames = [crop_frame(sheet, index) for index in range(FRAME_COUNT)]
    before = [alpha_metrics(frame) for frame in before_frames]
    shifts = [centroid_shift(float(metrics["torsoCentroidY"])) for metrics in before]
    after_frames = [
        translate_frame(frame, shift)
        for frame, shift in zip(before_frames, shifts, strict=True)
    ]
    after = [alpha_metrics(frame) for frame in after_frames]

    output = sheet.copy()
    for index, frame in enumerate(after_frames):
        x = index % COLS * FRAME_W
        y = index // COLS * FRAME_H
        output.paste(frame, (x, y))
    output.save(ASSET)

    PREVIEW.parent.mkdir(parents=True, exist_ok=True)
    durations = [110, 120] * 6
    after_frames[0].save(
        PREVIEW,
        save_all=True,
        append_images=after_frames[1:],
        duration=durations,
        loop=0,
        disposal=2,
    )

    before_centroids = [float(item["torsoCentroidY"]) for item in before]
    after_centroids = [float(item["torsoCentroidY"]) for item in after]
    runtime_foot_y = max(int(item["alphaBottomInclusive"]) for item in after)
    scale = DISPLAY_SIZE / FRAME_H
    report = {
        "asset": ASSET.relative_to(ROOT).as_posix(),
        "backup": BACKUP.relative_to(ROOT).as_posix(),
        "preview": PREVIEW.relative_to(ROOT).as_posix(),
        "frameCount": FRAME_COUNT,
        "alphaThreshold": ALPHA_THRESHOLD,
        "torsoBand": [TORSO_X0, TORSO_X1],
        "targetCentroidBand": [TARGET_CENTROID_LOW, TARGET_CENTROID_HIGH],
        "pixelShiftsY": shifts,
        "before": before,
        "after": after,
        "runtimeFootY": runtime_foot_y,
        "beforeTorsoRangeSourcePx": round(max(before_centroids) - min(before_centroids), 4),
        "afterTorsoRangeSourcePx": round(max(after_centroids) - min(after_centroids), 4),
        "beforeTorsoRangeGamePx": round((max(before_centroids) - min(before_centroids)) * scale, 4),
        "afterTorsoRangeGamePx": round((max(after_centroids) - min(after_centroids)) * scale, 4),
        "previewDurationsMs": durations,
        "previewTotalMs": sum(durations),
    }
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
