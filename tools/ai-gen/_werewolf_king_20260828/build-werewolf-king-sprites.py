#!/usr/bin/env python3
"""Build unified transparent Werewolf King key-frame sprite sheets."""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import av
import cv2
import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parent
TOOLS_DIR = ROOT.parent
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

from rmbg_cutout import get_model, predict_alpha  # noqa: E402


VIDEO_DIR = ROOT / "videos"
FRAME_DIR = ROOT / "frames" / "birefnet"
SHEET_DIR = ROOT / "spritesheets" / "source-pre-rife"
PREVIEW_DIR = ROOT / "previews" / "sprites" / "source-pre-rife"
REPORT_DIR = ROOT / "reports" / "sprites" / "source-pre-rife"

CELL_WIDTH = 800
CELL_HEIGHT = 640
COLS = 8
TARGET_STANDING_HEIGHT = 410
TARGET_CENTER_X = CELL_WIDTH // 2
TARGET_FEET_Y = 570

ACTIONS: dict[str, dict[str, object]] = {
    "idle": {
        "video": "idle-doubao-v01.mp4",
        "frames": tuple(range(0, 120, 5)),
        "referenceFrame": 0,
        "alignment": "stable-torso-and-feet",
        "mode": "loop",
        "sourceKeyFps": 24 / 5,
    },
    "running": {
        "video": "running-doubao-v01.mp4",
        "frames": tuple(range(16, 48, 2)),
        "referenceFrame": 0,
        "alignment": "stable-torso-and-feet",
        "mode": "loop",
        "sourceKeyFps": 24 / 2,
        "excludedDuplicateEndpoint": 48,
    },
    "attacking": {
        "video": "attacking-doubao-v01.mp4",
        "frames": tuple(range(0, 97, 4)),
        "referenceFrame": 0,
        "alignment": "fixed-source-trajectory",
        "mode": "one-shot",
        "sourceKeyFps": 24 / 4,
    },
    "dying": {
        "video": "dying-doubao-v02-fixed-scale.mp4",
        "frames": tuple(range(0, 73, 4)),
        "referenceFrame": 0,
        "alignment": "fixed-source-x-grounded-y",
        "mode": "one-shot",
        "sourceKeyFps": 24 / 4,
    },
    "pounce": {
        "video": "pounce-doubao-v02-side-plane-lock.mp4",
        "frames": tuple(range(0, 97, 4)),
        "referenceFrame": 0,
        "alignment": "fixed-source-trajectory",
        "mode": "one-shot",
        "sourceKeyFps": 24 / 4,
        "targetReferenceHeight": 330,
        "targetCenterX": 288,
        "targetFeetY": 570,
        "cellWidth": 1344,
        "cellHeight": 640,
        "cols": 6,
    },
    "howl": {
        "video": "howl-doubao-v01.mp4",
        "frames": tuple(range(0, 121, 4)),
        "referenceFrame": 0,
        "alignment": "fixed-source-x-grounded-y",
        "mode": "one-shot",
        "sourceKeyFps": 24 / 4,
    },
}


def decode_video(path: Path) -> list[np.ndarray]:
    with av.open(str(path)) as container:
        stream = container.streams.video[0]
        return [
            np.asarray(frame.to_image().convert("RGB"))
            for frame in container.decode(stream)
        ]


def normalize_alpha(raw: np.ndarray) -> np.ndarray:
    alpha = np.asarray(raw).squeeze()
    if alpha.dtype != np.uint8:
        if float(alpha.max()) <= 1.0:
            alpha = alpha * 255.0
        alpha = np.clip(alpha, 0, 255).astype(np.uint8)
    alpha[alpha <= 3] = 0

    # Keep the connected actor and its antialiased fringe, dropping the floor
    # shadow and any detached page/video artifacts.
    count, labels, stats, _ = cv2.connectedComponentsWithStats(
        (alpha > 12).astype(np.uint8), 8
    )
    if count <= 1:
        raise RuntimeError("BiRefNet produced no foreground component")
    main = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    keep = cv2.dilate((labels == main).astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
    alpha[~keep] = 0
    return alpha


def decontaminate_white(rgb: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    output = rgb.astype(np.float32).copy()
    a = alpha.astype(np.float32) / 255.0
    semi = (a > 0.01) & (a < 0.995)
    if semi.any():
        inverse = 1.0 - a[semi]
        foreground = (output[semi] - inverse[:, None] * 255.0) / np.maximum(
            a[semi][:, None], 1e-3
        )
        output[semi] = np.clip(foreground, 0, 255)
    output[alpha == 0] = 0
    return np.clip(output, 0, 255).astype(np.uint8)


def alpha_bbox(alpha: np.ndarray, threshold: int = 16) -> tuple[int, int, int, int]:
    ys, xs = np.where(alpha > threshold)
    if not xs.size:
        raise RuntimeError("empty alpha frame")
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def torso_center_x(alpha: np.ndarray, box: tuple[int, int, int, int]) -> float:
    x0, y0, x1, y1 = box
    height = y1 - y0 + 1
    band_top = y0 + round(height * 0.24)
    band_bottom = y0 + round(height * 0.60)
    band = alpha[band_top:band_bottom + 1].astype(np.float32)
    weights = band.sum(axis=0)
    if float(weights.sum()) <= 0:
        return (x0 + x1) / 2.0
    return float(np.dot(np.arange(alpha.shape[1]), weights) / weights.sum())


def cutout(model, rgb: np.ndarray) -> tuple[np.ndarray, dict[str, float | int]]:
    alpha = normalize_alpha(predict_alpha(model, Image.fromarray(rgb, "RGB")))
    box = alpha_bbox(alpha)
    clean_rgb = decontaminate_white(rgb, alpha)
    rgba = np.dstack([clean_rgb, alpha])
    return rgba, {
        "left": box[0],
        "top": box[1],
        "right": box[2],
        "bottom": box[3],
        "width": box[2] - box[0] + 1,
        "height": box[3] - box[1] + 1,
        "torsoCenterX": torso_center_x(alpha, box),
    }


def metrics_from_rgba(rgba: np.ndarray) -> dict[str, float | int]:
    alpha = rgba[..., 3]
    box = alpha_bbox(alpha)
    return {
        "left": box[0],
        "top": box[1],
        "right": box[2],
        "bottom": box[3],
        "width": box[2] - box[0] + 1,
        "height": box[3] - box[1] + 1,
        "torsoCenterX": torso_center_x(alpha, box),
    }


def warp(
    rgba: np.ndarray,
    *,
    scale: float,
    translate_x: float,
    translate_y: float,
    cell_width: int,
    cell_height: int,
) -> np.ndarray:
    matrix = np.array(
        [[scale, 0.0, translate_x], [0.0, scale, translate_y]],
        dtype=np.float32,
    )
    cell = cv2.warpAffine(
        rgba,
        matrix,
        (cell_width, cell_height),
        flags=cv2.INTER_LANCZOS4,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=(0, 0, 0, 0),
    )
    cell[cell[..., 3] <= 3] = 0
    cell[cell[..., 3] == 0, :3] = 0
    return cell


def checker(cell: np.ndarray) -> Image.Image:
    yy, xx = np.indices(cell.shape[:2])
    shade = np.where(((xx // 24 + yy // 24) % 2)[..., None], 58, 82)
    background = np.repeat(shade, 3, axis=2).astype(np.float32)
    alpha = cell[..., 3:4].astype(np.float32) / 255.0
    composite = cell[..., :3].astype(np.float32) * alpha + background * (1.0 - alpha)
    return Image.fromarray(np.clip(composite, 0, 255).astype(np.uint8), "RGB")


def compose(
    cells: list[np.ndarray], cell_width: int, cell_height: int, cols: int
) -> np.ndarray:
    rows = math.ceil(len(cells) / cols)
    sheet = np.zeros((rows * cell_height, cols * cell_width, 4), dtype=np.uint8)
    for index, cell in enumerate(cells):
        row, col = divmod(index, cols)
        sheet[
            row * cell_height:(row + 1) * cell_height,
            col * cell_width:(col + 1) * cell_width,
        ] = cell
    return sheet


def build_action(model, name: str, spec: dict[str, object]) -> dict[str, object]:
    video_path = VIDEO_DIR / str(spec["video"])
    source_frames = decode_video(video_path)
    indices = tuple(int(index) for index in spec["frames"])
    reference_index = int(spec["referenceFrame"])
    required = tuple(dict.fromkeys((reference_index, *indices)))
    if max(required) >= len(source_frames):
        raise RuntimeError(f"{name}: source frame selection exceeds video")

    action_frame_dir = FRAME_DIR / name
    action_frame_dir.mkdir(parents=True, exist_ok=True)
    cutouts: dict[int, np.ndarray] = {}
    metrics: dict[int, dict[str, float | int]] = {}
    for source_index in required:
        cutout_path = action_frame_dir / f"source-{source_index:03d}-birefnet.png"
        if cutout_path.exists():
            rgba = np.asarray(Image.open(cutout_path).convert("RGBA")).copy()
            frame_metrics = metrics_from_rgba(rgba)
            print(f"[werewolf-sprite] {name} reuse BiRefNet f{source_index}", flush=True)
        else:
            rgba, frame_metrics = cutout(model, source_frames[source_index])
            Image.fromarray(rgba, "RGBA").save(cutout_path)
            print(f"[werewolf-sprite] {name} BiRefNet f{source_index}", flush=True)
        cutouts[source_index] = rgba
        metrics[source_index] = frame_metrics

    reference = metrics[reference_index]
    cell_width = int(spec.get("cellWidth", CELL_WIDTH))
    cell_height = int(spec.get("cellHeight", CELL_HEIGHT))
    cols = int(spec.get("cols", COLS))
    target_reference_height = float(
        spec.get("targetReferenceHeight", TARGET_STANDING_HEIGHT)
    )
    target_center_x = float(spec.get("targetCenterX", TARGET_CENTER_X))
    target_feet_y = float(spec.get("targetFeetY", TARGET_FEET_Y))
    scale = target_reference_height / float(reference["height"])
    fixed_tx = target_center_x - float(reference["torsoCenterX"]) * scale
    fixed_ty = target_feet_y - float(reference["bottom"]) * scale

    cells: list[np.ndarray] = []
    for source_index in indices:
        frame_metrics = metrics[source_index]
        if spec["alignment"] == "stable-torso-and-feet":
            tx = target_center_x - float(frame_metrics["torsoCenterX"]) * scale
            ty = target_feet_y - float(frame_metrics["bottom"]) * scale
        elif spec["alignment"] == "fixed-source-x-grounded-y":
            tx = fixed_tx
            ty = target_feet_y - float(frame_metrics["bottom"]) * scale
        else:
            tx = fixed_tx
            ty = fixed_ty
        cells.append(
            warp(
                cutouts[source_index],
                scale=scale,
                translate_x=tx,
                translate_y=ty,
                cell_width=cell_width,
                cell_height=cell_height,
            )
        )

    SHEET_DIR.mkdir(parents=True, exist_ok=True)
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    sheet_path = SHEET_DIR / f"{name}.png"
    Image.fromarray(
        compose(cells, cell_width, cell_height, cols), "RGBA"
    ).save(sheet_path, optimize=True)

    preview_frames = [
        checker(cell).resize((400, 320), Image.Resampling.LANCZOS) for cell in cells
    ]
    frame_rate = float(spec["sourceKeyFps"])
    frame_ms = round(1000 / frame_rate)
    playback = preview_frames * (3 if spec["mode"] == "loop" else 1)
    preview_path = PREVIEW_DIR / f"{name}-source-keys.gif"
    playback[0].save(
        preview_path,
        save_all=True,
        append_images=playback[1:],
        duration=frame_ms,
        loop=0,
        disposal=2,
    )

    alpha_counts: list[int] = []
    bottoms: list[int] = []
    touching: list[int] = []
    transparent_rgb: list[int] = []
    output_boxes: list[list[int]] = []
    for output_index, cell in enumerate(cells):
        ys, xs = np.where(cell[..., 3] > 8)
        alpha_counts.append(int(xs.size))
        transparent_rgb.append(int(np.count_nonzero(cell[..., :3][cell[..., 3] == 0])))
        if xs.size:
            box = [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]
            output_boxes.append(box)
            bottoms.append(box[3])
            if (
                box[0] <= 2
                or box[1] <= 2
                or box[2] >= cell_width - 3
                or box[3] >= cell_height - 3
            ):
                touching.append(output_index)
        else:
            output_boxes.append([])

    report: dict[str, object] = {
        "action": name,
        "video": str(video_path.relative_to(ROOT)),
        "sourceFrames": list(indices),
        "referenceFrame": reference_index,
        "excludedDuplicateEndpoint": spec.get("excludedDuplicateEndpoint"),
        "mode": spec["mode"],
        "alignment": spec["alignment"],
        "cellWidth": cell_width,
        "cellHeight": cell_height,
        "cols": cols,
        "frameCount": len(cells),
        "frameRate": frame_rate,
        "targetReferenceHeight": target_reference_height,
        "targetCenterX": target_center_x,
        "targetFeetY": target_feet_y,
        "referenceSourceHeight": reference["height"],
        "fixedScale": scale,
        "fixedTranslateX": fixed_tx,
        "fixedTranslateY": fixed_ty,
        "alphaPixelsPerFrame": alpha_counts,
        "alphaBottomMin": min(bottoms),
        "alphaBottomMax": max(bottoms),
        "outputBoxes": output_boxes,
        "emptyFrames": [i for i, count in enumerate(alpha_counts) if count < 50],
        "touchingFrames": touching,
        "transparentRgbNonZeroMax": max(transparent_rgb),
        "sheet": str(sheet_path.relative_to(ROOT)),
        "previewGif": str(preview_path.relative_to(ROOT)),
        "pipeline": "BiRefNet main actor + white decontamination + unified fixed body scale",
    }
    (REPORT_DIR / f"{name}.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False), flush=True)
    return report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", choices=tuple(ACTIONS))
    args = parser.parse_args()
    selected = {args.only: ACTIONS[args.only]} if args.only else ACTIONS
    model = get_model()
    reports = {
        name: build_action(model, name, spec) for name, spec in selected.items()
    }
    if not args.only:
        (REPORT_DIR / "source-build-index.json").write_text(
            json.dumps(reports, ensure_ascii=False, indent=2), encoding="utf-8"
        )


if __name__ == "__main__":
    main()
