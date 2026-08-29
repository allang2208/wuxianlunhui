#!/usr/bin/env python3
"""Build transparent key-frame sheets from the approved Doubao beetle videos.

The approved videos use a known pure-blue plate.  Alpha is recovered by blue
screen inversion, then the largest high-confidence subject component is kept so
the disconnected Doubao watermark and codec flecks never enter the sprite.
All actions share one fixed scale.  Each action uses one fixed transform so the
attack lunge and death collapse retain their authored trajectories.
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import av
import cv2
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage


ROOT = Path(__file__).resolve().parent
if str(ROOT.parent) not in sys.path:
    sys.path.insert(0, str(ROOT.parent))

from rmbg_cutout import get_model, predict_alpha

CELL_W = 512
CELL_H = 512
SHEET_COLS = 8
CONTACT_COLS = 4
TARGET_CORE_W = 230.0
TARGET_CORE_X = 256
TARGET_FOOT_Y = 430
BLUE_PLATE = np.array([0.0, 0.0, 255.0], dtype=np.float32)

ACTIONS = {
    "idle": {
        "video": "idle-doubao-v01.mp4",
        "frames": list(range(48, 102, 6)),
        "frame_rate": 4.0,
        "mode": "loop",
    },
    "walking": {
        "video": "moving-doubao-v01.mp4",
        "frames": list(range(0, 115, 6)),
        "frame_rate": 10.0,
        "mode": "loop",
    },
    "attacking": {
        "video": "attacking-doubao-v01.mp4",
        "frames": list(range(0, 121, 8)),
        "frame_rate": 8.0,
        "mode": "one-shot",
    },
    "dying": {
        "video": "dying-doubao-v01.mp4",
        "frames": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 120],
        "frame_rate": 6.5,
        "mode": "one-shot",
    },
}
SEMANTIC_CUTOUT_ACTIONS = {"walking", "dying"}


def largest_component(mask: np.ndarray) -> np.ndarray:
    count, labels, stats, _ = cv2.connectedComponentsWithStats(
        mask.astype(np.uint8), 8
    )
    if count <= 1:
        return np.zeros_like(mask, dtype=bool)
    keep = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    return labels == keep


def recover_rgba(rgb: np.ndarray) -> np.ndarray:
    work = rgb.astype(np.float32)
    blue_excess = work[..., 2] - np.maximum(work[..., 0], work[..., 1])
    alpha = 255.0 - np.clip(blue_excess, 0.0, 255.0)
    alpha[alpha < 5] = 0
    alpha[alpha > 242] = 255

    # Seed from the opaque beetle, then restore only its attached soft edges.
    component = largest_component(alpha > 150)
    component = cv2.dilate(
        component.astype(np.uint8),
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (17, 17)),
    ) > 0
    alpha[~component] = 0

    a = alpha / 255.0
    foreground = np.zeros_like(work)
    visible = a > 0.015
    foreground[visible] = (
        work[visible] - (1.0 - a[visible, None]) * BLUE_PLATE[None, :]
    ) / np.maximum(a[visible, None], 1e-3)
    foreground = np.clip(foreground, 0, 255).astype(np.uint8)

    # Despill remaining plate chroma without deleting edge alpha.  First cap
    # cyan excess against red, then cap blue-only excess against red/green.
    red = foreground[..., 0].astype(np.int16)
    green = foreground[..., 1].astype(np.int16)
    blue = foreground[..., 2].astype(np.int16)
    cyan = visible & (green > red + 18) & (blue > red + 18)
    if cyan.any():
        cyan_cap = np.clip(red[cyan] + 18, 0, 255).astype(np.uint8)
        foreground[..., 1][cyan] = np.minimum(
            foreground[..., 1][cyan], cyan_cap
        )
        foreground[..., 2][cyan] = np.minimum(
            foreground[..., 2][cyan], cyan_cap
        )
    peak = np.maximum(foreground[..., 0], foreground[..., 1]).astype(np.int16)
    blue = foreground[..., 2].astype(np.int16)
    blue_only = visible & (blue > peak + 8)
    foreground[..., 2][blue_only] = np.clip(
        peak[blue_only] + 8, 0, 255
    ).astype(np.uint8)
    foreground[alpha == 0] = 0
    return np.dstack([foreground, alpha.astype(np.uint8)])


def keep_semantic_subject(alpha: np.ndarray) -> np.ndarray:
    foreground = (alpha > 10).astype(np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(foreground, 8)
    if count <= 1:
        raise RuntimeError("BiRefNet produced no foreground component")
    largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    x = int(stats[largest, cv2.CC_STAT_LEFT])
    y = int(stats[largest, cv2.CC_STAT_TOP])
    w = int(stats[largest, cv2.CC_STAT_WIDTH])
    h = int(stats[largest, cv2.CC_STAT_HEIGHT])
    expanded = (x - 28, y - 28, x + w + 28, y + h + 28)
    keep = labels == largest
    for label in range(1, count):
        if label == largest or int(stats[label, cv2.CC_STAT_AREA]) < 8:
            continue
        lx = int(stats[label, cv2.CC_STAT_LEFT])
        ly = int(stats[label, cv2.CC_STAT_TOP])
        lw = int(stats[label, cv2.CC_STAT_WIDTH])
        lh = int(stats[label, cv2.CC_STAT_HEIGHT])
        if (
            lx < expanded[2]
            and lx + lw > expanded[0]
            and ly < expanded[3]
            and ly + lh > expanded[1]
        ):
            keep |= labels == label
    keep = cv2.dilate(keep.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
    cleaned = alpha.copy()
    cleaned[~keep] = 0
    cleaned[cleaned < 4] = 0
    return cleaned


def recover_birefnet_rgba(rgb: np.ndarray, model) -> np.ndarray:
    alpha = np.asarray(predict_alpha(model, Image.fromarray(rgb, "RGB")))
    alpha = np.squeeze(alpha)
    if alpha.shape != rgb.shape[:2]:
        alpha = cv2.resize(
            alpha, (rgb.shape[1], rgb.shape[0]), interpolation=cv2.INTER_LINEAR
        )
    if alpha.max(initial=0) <= 1.5:
        alpha = alpha * 255.0
    alpha = keep_semantic_subject(np.clip(alpha, 0, 255).astype(np.uint8))

    # Low-alpha chroma inversion creates clipped yellow/green colors that RIFE
    # amplifies.  Keep semantic alpha, but fill soft-edge RGB from the nearest
    # reliable opaque beetle pixel instead of dividing the blue plate out.
    return stabilize_semantic_edges(np.dstack([rgb.copy(), alpha]))


def stabilize_semantic_edges(rgba: np.ndarray) -> np.ndarray:
    result = rgba.copy()
    alpha = result[..., 3]
    reliable = alpha > 180
    if not reliable.any():
        result[alpha == 0, :3] = 0
        return despill_placed_rgba(result)
    _, indices = ndimage.distance_transform_edt(~reliable, return_indices=True)
    nearest_rgb = result[..., :3][indices[0], indices[1]]
    soft = (alpha > 0) & ~reliable
    result[..., :3][soft] = nearest_rgb[soft]
    result[alpha == 0, :3] = 0
    return despill_placed_rgba(result)


def despill_placed_rgba(rgba: np.ndarray) -> np.ndarray:
    """Close blue/cyan excess reintroduced by Lanczos placement."""
    result = rgba.copy()
    visible = result[..., 3] > 0
    red = result[..., 0].astype(np.int16)
    green = result[..., 1].astype(np.int16)
    blue = result[..., 2].astype(np.int16)
    cyan = visible & (green > red + 12) & (blue > red + 12)
    if cyan.any():
        cap = np.clip(red[cyan] + 12, 0, 255).astype(np.uint8)
        result[..., 1][cyan] = np.minimum(result[..., 1][cyan], cap)
        result[..., 2][cyan] = np.minimum(result[..., 2][cyan], cap)
    peak = np.maximum(result[..., 0], result[..., 1]).astype(np.int16)
    blue = result[..., 2].astype(np.int16)
    blue_only = visible & (blue > peak + 6)
    result[..., 2][blue_only] = np.clip(
        peak[blue_only] + 6, 0, 255
    ).astype(np.uint8)
    result[result[..., 3] == 0, :3] = 0
    return result


def alpha_bbox(rgba: np.ndarray, threshold: int = 4) -> list[int]:
    ys, xs = np.where(rgba[..., 3] > threshold)
    if not len(xs):
        raise RuntimeError("empty recovered subject")
    return [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]


def core_geometry(rgba: np.ndarray) -> tuple[float, float, int]:
    rgb = rgba[..., :3]
    alpha = rgba[..., 3]
    core = (alpha > 225) & (rgb.mean(axis=2) < 195)
    core = cv2.morphologyEx(
        core.astype(np.uint8),
        cv2.MORPH_OPEN,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (13, 13)),
    ) > 0
    core = largest_component(core)
    ys, xs = np.where(core)
    if not len(xs):
        ys, xs = np.where(alpha > 180)
    if not len(xs):
        raise RuntimeError("empty core geometry")
    return float(xs.mean()), float(ys.mean()), int(xs.max() - xs.min() + 1)


def decode(path: Path) -> list[np.ndarray]:
    container = av.open(str(path))
    frames = [
        np.asarray(frame.to_image().convert("RGB"))
        for frame in container.decode(video=0)
    ]
    container.close()
    return frames


def checker(cell: np.ndarray) -> Image.Image:
    yy, xx = np.indices((CELL_H, CELL_W))
    pattern = ((xx // 24 + yy // 24) & 1)[..., None]
    low = np.array([58, 62, 68], dtype=np.uint8)
    high = np.array([92, 97, 104], dtype=np.uint8)
    base = Image.fromarray(
        np.where(pattern, high, low).astype(np.uint8), "RGB"
    ).convert("RGBA")
    base.alpha_composite(Image.fromarray(cell, "RGBA"))
    return base.convert("RGB").resize((256, 256), Image.Resampling.LANCZOS)


def main() -> None:
    decoded: dict[str, list[np.ndarray]] = {}
    recovered: dict[str, list[np.ndarray]] = {}
    semantic_model = get_model()
    for action, cfg in ACTIONS.items():
        video = cfg["video"]
        decoded.setdefault(video, decode(ROOT / "videos" / video))
        if max(cfg["frames"]) >= len(decoded[video]):
            raise RuntimeError(
                f"{action}: source index exceeds {len(decoded[video])} decoded frames"
            )
        recover = recover_birefnet_rgba if action in SEMANTIC_CUTOUT_ACTIONS else None
        recovered[action] = [
            recover(decoded[video][index], semantic_model)
            if recover is not None
            else recover_rgba(decoded[video][index])
            for index in cfg["frames"]
        ]

    # The shared body scale is permanently anchored to the approved video's
    # original first frame, independent of any later loop-window selection.
    reference_core = core_geometry(
        recover_rgba(decoded["idle-doubao-v01.mp4"][0])
    )
    scale = TARGET_CORE_W / reference_core[2]

    key_dir = ROOT / "spritesheets" / "key"
    frame_root = ROOT / "spritesheets" / "frames"
    preview_dir = ROOT / "spritesheets" / "previews" / "key"
    report_dir = ROOT / "spritesheets" / "reports"
    for path in (key_dir, frame_root, preview_dir, report_dir):
        path.mkdir(parents=True, exist_ok=True)

    manifest: dict[str, object] = {
        "pipeline": "pure-blue inverse matte for idle/attack; BiRefNet-general semantic alpha for walking/dying",
        "cellWidth": CELL_W,
        "cellHeight": CELL_H,
        "targetCoreWidth": TARGET_CORE_W,
        "targetFootY": TARGET_FOOT_Y,
        "sharedScale": scale,
        "actions": {},
    }

    for action, cfg in ACTIONS.items():
        frames = recovered[action]
        first_core_x, _, _ = core_geometry(frames[0])
        first_bbox = alpha_bbox(frames[0])
        matrix = np.array(
            [
                [scale, 0.0, TARGET_CORE_X - scale * first_core_x],
                [0.0, scale, TARGET_FOOT_Y - scale * first_bbox[3]],
            ],
            dtype=np.float32,
        )

        cells: list[np.ndarray] = []
        bboxes: list[list[int]] = []
        for rgba in frames:
            rgb = cv2.warpAffine(
                rgba[..., :3], matrix, (CELL_W, CELL_H), flags=cv2.INTER_LANCZOS4
            )
            alpha = cv2.warpAffine(
                rgba[..., 3], matrix, (CELL_W, CELL_H), flags=cv2.INTER_LANCZOS4
            )
            alpha[alpha < 3] = 0
            rgb[alpha == 0] = 0
            cell = despill_placed_rgba(np.dstack([rgb, alpha]))
            if action in SEMANTIC_CUTOUT_ACTIONS:
                cell = stabilize_semantic_edges(cell)
            bboxes.append(alpha_bbox(cell))
            cells.append(cell)

        rows = math.ceil(len(cells) / SHEET_COLS)
        sheet = np.zeros(
            (rows * CELL_H, SHEET_COLS * CELL_W, 4), dtype=np.uint8
        )
        frame_dir = frame_root / action
        frame_dir.mkdir(parents=True, exist_ok=True)
        for position, cell in enumerate(cells):
            row, col = divmod(position, SHEET_COLS)
            sheet[
                row * CELL_H:(row + 1) * CELL_H,
                col * CELL_W:(col + 1) * CELL_W,
            ] = cell
            Image.fromarray(cell, "RGBA").save(
                frame_dir
                / f"key-{position:02d}-source-{cfg['frames'][position]:03d}.png"
            )
        Image.fromarray(sheet, "RGBA").save(
            key_dir / f"{action}.png", optimize=True
        )

        preview_frames = [checker(cell) for cell in cells]
        duration_ms = round(1000 / cfg["frame_rate"])
        preview_frames[0].save(
            preview_dir / f"{action}-key.gif",
            save_all=True,
            append_images=preview_frames[1:],
            duration=duration_ms,
            loop=0,
            disposal=2,
        )
        contact_rows = math.ceil(len(preview_frames) / CONTACT_COLS)
        contact = Image.new(
            "RGB", (CONTACT_COLS * 256, contact_rows * 256), (30, 30, 30)
        )
        draw = ImageDraw.Draw(contact)
        for position, (source_index, preview) in enumerate(
            zip(cfg["frames"], preview_frames)
        ):
            row, col = divmod(position, CONTACT_COLS)
            x, y = col * 256, row * 256
            contact.paste(preview, (x, y))
            draw.text((x + 8, y + 8), f"source {source_index}", fill="white")
        contact.save(preview_dir / f"{action}-key-contact.png", optimize=True)

        report = {
            "action": action,
            "video": cfg["video"],
            "sourceFrames": cfg["frames"],
            "frameCount": len(cells),
            "frameRate": cfg["frame_rate"],
            "mode": cfg["mode"],
            "cellWidth": CELL_W,
            "cellHeight": CELL_H,
            "cols": SHEET_COLS,
            "rows": rows,
            "sharedScale": scale,
            "firstSourceCoreX": first_core_x,
            "firstSourceFootY": first_bbox[3],
            "placedAlphaBboxes": bboxes,
            "emptyFrames": [],
            "touchingFrames": [
                index
                for index, (left, top, right, bottom) in enumerate(bboxes)
                if left <= 0 or top <= 0 or right >= CELL_W - 1 or bottom >= CELL_H - 1
            ],
        }
        (report_dir / f"{action}-key.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        manifest["actions"][action] = report

    (ROOT / "spritesheets" / "key-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(
        json.dumps(
            {
                action: {
                    "frames": len(recovered[action]),
                    "mode": cfg["mode"],
                    "frameRate": cfg["frame_rate"],
                }
                for action, cfg in ACTIONS.items()
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
