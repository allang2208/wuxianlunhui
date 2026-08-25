#!/usr/bin/env python3
"""Build the two accepted H3 morph clips into matched RGBA sprite sheets.

Unlike ordinary action sheets, transformation frames must retain their changing
body scale. Every source frame therefore uses one fixed video-to-cell scale and
the endpoint camera's shared centre/foot coordinates; no per-frame bbox
normalisation is allowed.
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import av
import cv2
import numpy as np
from PIL import Image


TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))
from rmbg_cutout import get_model, predict_alpha  # noqa: E402


ROOT = Path(__file__).resolve().parent
VIDEO_DIR = ROOT / "transform" / "video"
OUT_DIR = ROOT / "generated" / "final"
PREVIEW_DIR = ROOT / "previews" / "final"

VIDEO_CENTRE_X = 672
VIDEO_FOOT_Y = 700
CELL_WIDTH = 768
CELL_HEIGHT = 512
CELL_CENTRE_X = CELL_WIDTH // 2
CELL_FOOT_Y = 500
FIXED_SCALE = 262 / 341
FRAME_COUNT = 20
ALPHA_THRESHOLD = 16
ENDPOINT_MAE = 1.0

ACTIONS = {
    "transform_to_druid": VIDEO_DIR / "black-bear-to-druid-h3.mp4",
    "transform_to_bear": VIDEO_DIR / "black-druid-to-bear-h3.mp4",
}


def decode(path: Path) -> list[Image.Image]:
    with av.open(str(path)) as container:
        return [
            Image.fromarray(frame.to_ndarray(format="rgb24"), "RGB")
            for frame in container.decode(video=0)
        ]


def find_endpoint_start(frames: list[Image.Image]) -> tuple[int, list[float]]:
    endpoint = np.asarray(frames[-1], dtype=np.int16)
    differences = [
        float(np.abs(np.asarray(frame, dtype=np.int16) - endpoint).mean())
        for frame in frames
    ]
    start = next(
        (index for index, value in enumerate(differences) if value <= ENDPOINT_MAE),
        len(frames) - 1,
    )
    return start, differences


def bbox_from_alpha(alpha: np.ndarray) -> tuple[int, int, int, int]:
    ys, xs = np.where(alpha > ALPHA_THRESHOLD)
    if not len(xs):
        raise ValueError("empty BiRefNet mask")
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def keep_subject_components(alpha: np.ndarray) -> np.ndarray:
    foreground = (alpha > 12).astype(np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(foreground, 8)
    if count <= 1:
        raise RuntimeError("BiRefNet produced no foreground component")
    largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    lx = int(stats[largest, cv2.CC_STAT_LEFT])
    ly = int(stats[largest, cv2.CC_STAT_TOP])
    lw = int(stats[largest, cv2.CC_STAT_WIDTH])
    lh = int(stats[largest, cv2.CC_STAT_HEIGHT])
    expanded = (lx - 96, ly - 96, lx + lw + 96, ly + lh + 96)
    keep = labels == largest
    for label in range(1, count):
        if label == largest or int(stats[label, cv2.CC_STAT_AREA]) < 20:
            continue
        x = int(stats[label, cv2.CC_STAT_LEFT])
        y = int(stats[label, cv2.CC_STAT_TOP])
        w = int(stats[label, cv2.CC_STAT_WIDTH])
        h = int(stats[label, cv2.CC_STAT_HEIGHT])
        if x < expanded[2] and x + w > expanded[0] and y < expanded[3] and y + h > expanded[1]:
            keep |= labels == label
    keep = cv2.dilate(keep.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
    cleaned = alpha.copy()
    cleaned[~keep] = 0
    cleaned[cleaned < 4] = 0
    return cleaned


def white_decontaminate(rgb: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    a = alpha.astype(np.float32)[..., None] / 255.0
    safe = np.maximum(a, 0.04)
    foreground = (rgb.astype(np.float32) - 255.0 * (1.0 - a)) / safe
    foreground = np.clip(foreground, 0, 255)
    foreground[a[..., 0] <= 0.01] = 0
    return foreground.astype(np.uint8)


def cutout(model, frame: Image.Image) -> tuple[np.ndarray, np.ndarray]:
    rgb = np.asarray(frame.convert("RGB"), dtype=np.uint8)
    alpha = np.squeeze(np.asarray(predict_alpha(model, frame.convert("RGB"))))
    if alpha.shape != rgb.shape[:2]:
        alpha = cv2.resize(alpha, frame.size, interpolation=cv2.INTER_LINEAR)
    if alpha.max(initial=0) <= 1.5:
        alpha = alpha * 255.0
    alpha = keep_subject_components(np.clip(alpha, 0, 255).astype(np.uint8))
    return white_decontaminate(rgb, alpha), alpha


def place(rgb: np.ndarray, alpha: np.ndarray) -> tuple[Image.Image, dict]:
    x0, y0, x1, y1 = bbox_from_alpha(alpha)
    width = max(1, round((x1 - x0) * FIXED_SCALE))
    height = max(1, round((y1 - y0) * FIXED_SCALE))
    crop_rgb = Image.fromarray(rgb[y0:y1, x0:x1], "RGB").resize(
        (width, height), Image.Resampling.LANCZOS
    )
    crop_alpha = Image.fromarray(alpha[y0:y1, x0:x1], "L").resize(
        (width, height), Image.Resampling.LANCZOS
    )
    dst_x = round(CELL_CENTRE_X + (x0 - VIDEO_CENTRE_X) * FIXED_SCALE)
    dst_y = round(CELL_FOOT_Y + (y0 - VIDEO_FOOT_Y) * FIXED_SCALE)
    if dst_x < 8 or dst_y < 8 or dst_x + width > CELL_WIDTH - 8 or dst_y + height > CELL_HEIGHT - 4:
        raise ValueError(
            f"transform content out of safe cell: {width}x{height} at ({dst_x},{dst_y})"
        )
    subject = crop_rgb.convert("RGBA")
    subject.putalpha(crop_alpha)
    cell = Image.new("RGBA", (CELL_WIDTH, CELL_HEIGHT), (0, 0, 0, 0))
    cell.alpha_composite(subject, (dst_x, dst_y))
    return cell, {
        "sourceBox": [x0, y0, x1, y1],
        "placedBox": [dst_x, dst_y, dst_x + width, dst_y + height],
    }


def preview_frame(cell: Image.Image) -> Image.Image:
    background = Image.new("RGB", cell.size, (30, 32, 38))
    background.paste(cell.convert("RGB"), (0, 0), cell.getchannel("A"))
    return background.resize((384, 256), Image.Resampling.LANCZOS)


def build_action(model, name: str, video: Path) -> dict:
    frames = decode(video)
    if len(frames) < FRAME_COUNT:
        raise ValueError(f"{video} has only {len(frames)} frames")
    endpoint_start, endpoint_differences = find_endpoint_start(frames)
    indexes = [int(round(x)) for x in np.linspace(0, endpoint_start, FRAME_COUNT)]
    # Preserve the exact encoded endpoint while spending the other cells on the
    # active morph instead of the long terminal hold common in H3 output.
    indexes[-1] = len(frames) - 1
    if len(set(indexes)) != len(indexes):
        raise ValueError(f"duplicate transform sample indexes: {indexes}")
    cells = []
    placements = []
    for number, source_index in enumerate(indexes, 1):
        rgb, alpha = cutout(model, frames[source_index])
        cell, stats = place(rgb, alpha)
        cells.append(cell)
        placements.append({"cell": number - 1, "sourceFrame": source_index, **stats})
        print(f"[black-transform] {name} BiRefNet {number}/{FRAME_COUNT} frame={source_index}", flush=True)

    columns = 5
    rows = math.ceil(FRAME_COUNT / columns)
    sheet = Image.new("RGBA", (CELL_WIDTH * columns, CELL_HEIGHT * rows), (0, 0, 0, 0))
    for index, cell in enumerate(cells):
        sheet.alpha_composite(cell, ((index % columns) * CELL_WIDTH, (index // columns) * CELL_HEIGHT))
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / f"{name}.png"
    sheet.save(out)

    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    preview = PREVIEW_DIR / f"{name}.gif"
    preview_cells = [preview_frame(cell) for cell in cells]
    preview_cells[0].save(
        preview,
        save_all=True,
        append_images=preview_cells[1:],
        duration=100,
        loop=0,
        disposal=2,
    )
    alpha_counts = []
    bboxes = []
    feet = []
    edge_hits = []
    transparent_rgb_max = 0
    for index, cell in enumerate(cells):
        pixels = np.asarray(cell)
        alpha = pixels[..., 3]
        ys, xs = np.where(alpha > ALPHA_THRESHOLD)
        alpha_counts.append(int(len(xs)))
        bboxes.append([int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())])
        feet.append(int(ys.max()))
        if ((alpha[:2] > ALPHA_THRESHOLD).any() or (alpha[-2:] > ALPHA_THRESHOLD).any()
                or (alpha[:, :2] > ALPHA_THRESHOLD).any() or (alpha[:, -2:] > ALPHA_THRESHOLD).any()):
            edge_hits.append(index)
        transparent_rgb_max = max(
            transparent_rgb_max,
            int(pixels[..., :3][alpha == 0].max(initial=0)),
        )
    return {
        "video": str(video.relative_to(ROOT)),
        "sheet": str(out.relative_to(ROOT)),
        "preview": str(preview.relative_to(ROOT)),
        "sourceFrameCount": len(frames),
        "endpointStart": endpoint_start,
        "endpointMaeThreshold": ENDPOINT_MAE,
        "endpointMaeAtStart": endpoint_differences[endpoint_start],
        "sampleIndexes": indexes,
        "frameWidth": CELL_WIDTH,
        "frameHeight": CELL_HEIGHT,
        "columns": columns,
        "rows": rows,
        "frameCount": FRAME_COUNT,
        "footY": CELL_FOOT_Y,
        "duration": 2000,
        "repeat": 0,
        "fixedScale": FIXED_SCALE,
        "alphaPixels": [min(alpha_counts), max(alpha_counts)],
        "feetRange": [min(feet), max(feet)],
        "edgeHitFrames": edge_hits,
        "transparentRgbMax": transparent_rgb_max,
        "bboxes": bboxes,
        "placements": placements,
    }


def main() -> None:
    missing = [str(path) for path in ACTIONS.values() if not path.exists()]
    if missing:
        raise FileNotFoundError("missing accepted transform video(s): " + ", ".join(missing))
    model = get_model()
    report = {name: build_action(model, name, path) for name, path in ACTIONS.items()}
    (ROOT / "transform-sheet-manifest.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
