#!/usr/bin/env python3
"""Build normalized key-frame sheets for the approved Rotbog Beetle videos.

The source plate is a known pure-blue background.  Recovering alpha from that
plate keeps the translucent flight wings, while primary-component filtering
removes the disconnected Doubao watermark without relying on a semantic matte.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import av
import cv2
import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent
CELL_H = 640
TARGET_CORE_W = 300.0
BG = np.array([0.0, 0.0, 255.0], dtype=np.float32)

ACTIONS = {
    "idle": {
        "video": "idle-doubao-v01.mp4",
        "frames": list(range(0, 113, 8)),
        "cell_w": 640, "target_x": 320, "target_y": 420,
        "fps": 7.5, "mode": "loop",
    },
    "walking": {
        "video": "moving-doubao-v01.mp4",
        "frames": list(range(0, 115, 6)),
        "cell_w": 640, "target_x": 320, "target_y": 420,
        "fps": 10.0, "mode": "loop",
    },
    "attacking": {
        "video": "attack-horn-sweep-doubao-v01.mp4",
        "frames": [8, 16, 24, 32, 40, 48, 56, 64, 72, 80, 88, 96, 104, 112, 120],
        "cell_w": 768, "target_x": 384, "target_y": 410,
        "fps": 9.375, "mode": "one-shot", "contact_source_position": 8,
    },
    "charge": {
        "video": "charge-doubao-v03.mp4",
        "frames": list(range(0, 121, 8)),
        "cell_w": 1536, "target_x": 190, "target_y": 405,
        "fps": 6.6666667, "mode": "one-shot",
    },
    "summon": {
        "video": "summon-command-h3-v01.mp4",
        "frames": [0, 6, 12, 18, 24, 30, 36, 42, 48, 54, 60, 66, 72, 78, 84, 90, 96, 102, 112, 123],
        "cell_w": 768, "target_x": 384, "target_y": 410,
        "fps": 9.0909091, "mode": "one-shot", "release_source_position": 10,
    },
    "phase_open": {
        "video": "phase-open-elytra-h3-v01.mp4",
        "frames": [0, 6, 12, 18, 24, 30, 36, 42, 48, 54, 60, 66, 72, 84, 96, 108, 123],
        "cell_w": 896, "target_x": 448, "target_y": 415,
        "fps": 7.7272727, "mode": "one-shot", "scale_group": "phase",
    },
    "enraged_idle": {
        "video": "phase-open-elytra-h3-v01.mp4",
        "frames": [64, 70, 76, 82, 88, 94, 100, 106, 112, 118],
        "cell_w": 896, "target_x": 448, "target_y": 415,
        "fps": 7.5, "mode": "loop", "scale_group": "phase",
    },
    "dying": {
        "video": "dying-h3-v01.mp4",
        "frames": [0, 5, 10, 15, 18, 21, 24, 27, 30, 36, 48, 72, 96, 123],
        "cell_w": 896, "target_x": 448, "target_y": 365,
        "fps": 7.7777778, "mode": "one-shot",
    },
}


def largest_component(mask: np.ndarray) -> np.ndarray:
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 8)
    if count <= 1:
        return np.zeros_like(mask, dtype=bool)
    keep = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    return labels == keep


def recover_rgba(rgb: np.ndarray) -> np.ndarray:
    work = rgb.astype(np.float32)
    spill = work[..., 2] - np.maximum(work[..., 0], work[..., 1])
    alpha = 255.0 - np.clip(spill, 0.0, 255.0)
    alpha[alpha < 5] = 0
    alpha[alpha > 242] = 255

    # The beetle is the largest non-blue component; disconnected generated
    # watermarks and isolated codec flecks are intentionally excluded.
    # H.264 can lift the nominal blue plate enough to create a faint frame-sized
    # component.  A high-confidence seed isolates the opaque beetle first;
    # dilation then restores its antialiased and translucent edge pixels.
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
        work[visible] - (1.0 - a[visible, None]) * BG[None, :]
    ) / np.maximum(a[visible, None], 1e-3)
    foreground = np.clip(foreground, 0, 255).astype(np.uint8)

    # Remove the last blue/cyan plate excess while leaving alpha untouched.
    peak = np.maximum(foreground[..., 0], foreground[..., 1]).astype(np.int16)
    blue = foreground[..., 2].astype(np.int16)
    cap = visible & (blue > peak + 8)
    foreground[..., 2][cap] = np.clip(peak[cap] + 8, 0, 255).astype(np.uint8)
    foreground[alpha == 0] = 0
    return np.dstack([foreground, alpha.astype(np.uint8)])


def core_geometry(rgba: np.ndarray) -> tuple[float, float, int]:
    rgb = rgba[..., :3]
    alpha = rgba[..., 3]
    core = (alpha > 225) & (rgb.mean(axis=2) < 195)
    core = cv2.morphologyEx(
        core.astype(np.uint8), cv2.MORPH_OPEN,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (13, 13)),
    ) > 0
    core = largest_component(core)
    ys, xs = np.where(core)
    if not len(xs):
        ys, xs = np.where(alpha > 180)
    if not len(xs):
        raise RuntimeError("empty recovered subject")
    return float(xs.mean()), float(ys.mean()), int(xs.max() - xs.min() + 1)


def decode(path: Path) -> list[np.ndarray]:
    container = av.open(str(path))
    frames = [np.asarray(frame.to_image().convert("RGB")) for frame in container.decode(video=0)]
    container.close()
    return frames


def checker(cell: np.ndarray, scale: float = 0.5) -> Image.Image:
    h, w = cell.shape[:2]
    yy, xx = np.indices((h, w))
    pat = ((xx // 24 + yy // 24) & 1)[..., None]
    lo = np.array([58, 62, 68], dtype=np.uint8)
    hi = np.array([92, 97, 104], dtype=np.uint8)
    base = Image.fromarray(np.where(pat, hi, lo).astype(np.uint8), "RGB").convert("RGBA")
    base.alpha_composite(Image.fromarray(cell, "RGBA"))
    image = base.convert("RGB")
    if scale != 1:
        image = image.resize((round(w * scale), round(h * scale)), Image.Resampling.LANCZOS)
    return image


def main() -> None:
    decoded: dict[str, list[np.ndarray]] = {}
    recovered: dict[str, list[np.ndarray]] = {}
    geometries: dict[str, list[tuple[float, float, int]]] = {}
    scales: dict[str, float] = {}

    for name, cfg in ACTIONS.items():
        video = cfg["video"]
        decoded.setdefault(video, decode(ROOT / "videos" / video))
        frames = [recover_rgba(decoded[video][index]) for index in cfg["frames"]]
        recovered[name] = frames
        geometries[name] = [core_geometry(frame) for frame in frames]
        group = cfg.get("scale_group", name)
        if group not in scales:
            # phase_open begins closed and is the scale reference for its open-wing loop.
            scales[group] = TARGET_CORE_W / geometries[name][0][2]

    out_key = ROOT / "spritesheets" / "key"
    out_frames = ROOT / "spritesheets" / "frames"
    out_previews = ROOT / "spritesheets" / "previews"
    out_reports = ROOT / "spritesheets" / "reports"
    for path in (out_key, out_frames, out_previews, out_reports):
        path.mkdir(parents=True, exist_ok=True)

    manifest: dict[str, object] = {"pipeline": "pure-blue inverse matte + main component", "actions": {}}
    for name, cfg in ACTIONS.items():
        frames = recovered[name]
        cores = geometries[name]
        scale = scales[cfg.get("scale_group", name)]
        source_core_x, source_core_y, _ = cores[0]
        cell_w = cfg["cell_w"]
        cells: list[np.ndarray] = []
        bboxes: list[list[int]] = []
        for rgba in frames:
            matrix = np.array([
                [scale, 0.0, cfg["target_x"] - scale * source_core_x],
                [0.0, scale, cfg["target_y"] - scale * source_core_y],
            ], dtype=np.float32)
            rgb = cv2.warpAffine(rgba[..., :3], matrix, (cell_w, CELL_H), flags=cv2.INTER_LANCZOS4)
            alpha = cv2.warpAffine(rgba[..., 3], matrix, (cell_w, CELL_H), flags=cv2.INTER_LANCZOS4)
            alpha[alpha < 3] = 0
            rgb[alpha == 0] = 0
            cell = np.dstack([rgb, alpha])
            ys, xs = np.where(alpha > 4)
            if not len(xs):
                raise RuntimeError(f"{name}: empty placed frame")
            bboxes.append([int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())])
            cells.append(cell)

        cols = 5
        rows = math.ceil(len(cells) / cols)
        sheet = np.zeros((rows * CELL_H, cols * cell_w, 4), dtype=np.uint8)
        frame_dir = out_frames / name
        frame_dir.mkdir(parents=True, exist_ok=True)
        for position, cell in enumerate(cells):
            row, col = divmod(position, cols)
            sheet[row * CELL_H:(row + 1) * CELL_H, col * cell_w:(col + 1) * cell_w] = cell
            Image.fromarray(cell, "RGBA").save(frame_dir / f"key-{position:02d}-source-{cfg['frames'][position]:03d}.png")
        Image.fromarray(sheet, "RGBA").save(out_key / f"{name}.png", optimize=True)

        previews = [checker(cell) for cell in cells]
        duration = round(1000 / cfg["fps"])
        previews[0].save(out_previews / f"{name}-key.gif", save_all=True,
                         append_images=previews[1:], duration=duration, loop=0, disposal=2)
        thumb_w, thumb_h = previews[0].size
        contact = Image.new("RGB", (cols * thumb_w, rows * thumb_h), (30, 30, 30))
        draw = ImageDraw.Draw(contact)
        for position, (source_index, preview) in enumerate(zip(cfg["frames"], previews)):
            row, col = divmod(position, cols)
            x, y = col * thumb_w, row * thumb_h
            contact.paste(preview, (x, y))
            draw.text((x + 8, y + 8), f"source {source_index}", fill="white")
        contact.save(out_previews / f"{name}-key-contact.png", optimize=True)

        report = {
            "name": name, "video": cfg["video"], "sourceFrames": cfg["frames"],
            "frameCount": len(cells), "frameRate": cfg["fps"], "mode": cfg["mode"],
            "cellWidth": cell_w, "cellHeight": CELL_H, "cols": cols, "rows": rows,
            "scale": scale, "targetCore": [cfg["target_x"], cfg["target_y"]],
            "sourceCore": [source_core_x, source_core_y], "placedAlphaBboxes": bboxes,
            "contactSourcePosition": cfg.get("contact_source_position"),
            "releaseSourcePosition": cfg.get("release_source_position"),
        }
        (out_reports / f"{name}-key.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        manifest["actions"][name] = report

    (ROOT / "spritesheets" / "key-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps({name: {"frames": len(recovered[name]), "scale": scales[cfg.get('scale_group', name)]}
                      for name, cfg in ACTIONS.items()}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
