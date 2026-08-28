#!/usr/bin/env python3
"""Build the Werewolf King's runtime pounce sheet without baked horizontal motion.

The approved RIFE sheet remains the editable source of truth.  This derivative
only applies whole-pixel X translations per cell; it never rescales, rotates,
or changes the vertical leap trajectory.
"""

from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "spritesheets" / "final" / "pounce.png"
RUNTIME = ROOT / "spritesheets" / "runtime" / "pounce-root-locked.png"
GAME_ASSET = ROOT.parents[2] / "assets" / "enemies" / "werewolf_king" / "pounce.png"
REPORT = ROOT / "reports" / "sprites" / "runtime" / "pounce-root-lock.json"
CONTACT = ROOT / "previews" / "sprites" / "runtime" / "werewolf-king-pounce-root-locked-contact.png"
GIF = ROOT / "previews" / "sprites" / "runtime" / "werewolf-king-pounce-root-locked.gif"

FRAME_WIDTH = 1344
FRAME_HEIGHT = 640
COLS = 6
FRAME_COUNT = 49
TARGET_ROOT_X = FRAME_WIDTH // 2
ALPHA_THRESHOLD = 32
FRAME_RATE = 12


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest().upper()


def extract_frames(sheet: np.ndarray) -> list[np.ndarray]:
    frames: list[np.ndarray] = []
    for index in range(FRAME_COUNT):
        x = index % COLS * FRAME_WIDTH
        y = index // COLS * FRAME_HEIGHT
        frames.append(sheet[y:y + FRAME_HEIGHT, x:x + FRAME_WIDTH].copy())
    return frames


def alpha_bbox(frame: np.ndarray) -> tuple[int, int, int, int]:
    ys, xs = np.where(frame[..., 3] > ALPHA_THRESHOLD)
    if not xs.size:
        raise RuntimeError("empty pounce frame")
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def core_anchor_x(frame: np.ndarray) -> int:
    """Use a weighted median through the torso/pelvis band.

    A weighted median resists the long tail and outstretched claws better than
    an alpha-bbox or whole-frame centroid while keeping the natural pose intact.
    """

    x0, y0, x1, y1 = alpha_bbox(frame)
    height = y1 - y0 + 1
    top = y0 + round(height * 0.25)
    bottom = y0 + round(height * 0.67)
    weights = frame[top:bottom + 1, :, 3].astype(np.int64).sum(axis=0)
    total = int(weights.sum())
    if total <= 0:
        return round((x0 + x1) / 2)
    return int(np.searchsorted(np.cumsum(weights), (total + 1) // 2))


def shift_x(frame: np.ndarray, delta: int) -> np.ndarray:
    output = np.zeros_like(frame)
    if delta >= 0:
        src_left = 0
        src_right = FRAME_WIDTH - delta
        dst_left = delta
        dst_right = FRAME_WIDTH
    else:
        src_left = -delta
        src_right = FRAME_WIDTH
        dst_left = 0
        dst_right = FRAME_WIDTH + delta
    if src_right <= src_left:
        raise RuntimeError(f"invalid horizontal shift: {delta}")
    output[:, dst_left:dst_right] = frame[:, src_left:src_right]
    return output


def pack(frames: list[np.ndarray]) -> np.ndarray:
    rows = math.ceil(FRAME_COUNT / COLS)
    sheet = np.zeros((rows * FRAME_HEIGHT, COLS * FRAME_WIDTH, 4), dtype=np.uint8)
    for index, frame in enumerate(frames):
        x = index % COLS * FRAME_WIDTH
        y = index // COLS * FRAME_HEIGHT
        sheet[y:y + FRAME_HEIGHT, x:x + FRAME_WIDTH] = frame
    return sheet


def checker_preview(frame: np.ndarray, size: tuple[int, int]) -> Image.Image:
    rgba = Image.fromarray(frame, "RGBA").resize(size, Image.Resampling.LANCZOS)
    yy, xx = np.indices((size[1], size[0]))
    shade = np.where((xx // 12 + yy // 12) % 2, 62, 86).astype(np.uint8)
    background = Image.fromarray(np.dstack([shade, shade, shade]), "RGB").convert("RGBA")
    background.alpha_composite(rgba)
    return background.convert("RGB")


def build_previews(frames: list[np.ndarray]) -> None:
    preview_size = (672, 320)
    previews = [checker_preview(frame, preview_size) for frame in frames]
    GIF.parent.mkdir(parents=True, exist_ok=True)
    previews[0].save(
        GIF,
        save_all=True,
        append_images=previews[1:],
        duration=round(1000 / FRAME_RATE),
        loop=0,
        disposal=2,
    )

    tile_w, tile_h, label_h = 336, 160, 22
    contact_cols = 6
    rows = math.ceil(FRAME_COUNT / contact_cols)
    contact = Image.new("RGB", (contact_cols * tile_w, rows * (tile_h + label_h)), "#20242a")
    draw = ImageDraw.Draw(contact)
    for index, frame in enumerate(frames):
        x = index % contact_cols * tile_w
        y = index // contact_cols * (tile_h + label_h)
        contact.paste(checker_preview(frame, (tile_w, tile_h)), (x, y))
        draw.text((x + 5, y + tile_h + 3), f"f{index} root x={TARGET_ROOT_X}", fill="white")
    CONTACT.parent.mkdir(parents=True, exist_ok=True)
    contact.save(CONTACT)


def main() -> None:
    source_sheet = np.asarray(Image.open(SOURCE).convert("RGBA"))
    source_frames = extract_frames(source_sheet)
    output_frames: list[np.ndarray] = []
    frame_reports: list[dict[str, int | list[int]]] = []
    for index, source in enumerate(source_frames):
        anchor = core_anchor_x(source)
        delta = TARGET_ROOT_X - anchor
        output = shift_x(source, delta)
        source_box = alpha_bbox(source)
        output_box = alpha_bbox(output)
        runtime_anchor = core_anchor_x(output)
        source_pixels = int(np.count_nonzero(source[..., 3]))
        output_pixels = int(np.count_nonzero(output[..., 3]))
        if source_pixels != output_pixels:
            raise RuntimeError(f"frame {index} was cropped by X shift {delta}")
        if source_box[1] != output_box[1] or source_box[3] != output_box[3]:
            raise RuntimeError(f"frame {index} changed vertical bounds")
        if runtime_anchor != TARGET_ROOT_X:
            raise RuntimeError(
                f"frame {index} runtime root {runtime_anchor} != target {TARGET_ROOT_X}"
            )
        output_frames.append(output)
        frame_reports.append({
            "frame": index,
            "sourceCoreAnchorX": anchor,
            "runtimeCoreAnchorX": runtime_anchor,
            "integerShiftX": delta,
            "sourceBbox": list(source_box),
            "runtimeBbox": list(output_box),
            "alphaPixels": source_pixels,
        })

    runtime_sheet = pack(output_frames)
    runtime_sheet[runtime_sheet[..., 3] == 0, :3] = 0
    RUNTIME.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(runtime_sheet, "RGBA").save(RUNTIME, optimize=True)
    GAME_ASSET.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(runtime_sheet, "RGBA").save(GAME_ASSET, optimize=True)
    build_previews(output_frames)

    report = {
        "name": "werewolf-king-pounce-runtime-root-lock",
        "sourceSheet": str(SOURCE.relative_to(ROOT.parents[2])).replace("/", "\\"),
        "runtimeSheet": str(RUNTIME.relative_to(ROOT.parents[2])).replace("/", "\\"),
        "gameAsset": str(GAME_ASSET.relative_to(ROOT.parents[2])).replace("/", "\\"),
        "method": "per-frame whole-pixel X translation using torso/pelvis alpha weighted-median anchor",
        "preserved": [
            "approved RIFE pixels",
            "frame order and count",
            "vertical leap trajectory",
            "pose-relative limb and armor motion",
        ],
        "removed": "source-video whole-canvas horizontal root motion",
        "frameWidth": FRAME_WIDTH,
        "frameHeight": FRAME_HEIGHT,
        "cols": COLS,
        "frameCount": FRAME_COUNT,
        "frameRate": FRAME_RATE,
        "targetRootX": TARGET_ROOT_X,
        "validation": {
            "emptyFrames": [],
            "croppedFrames": [],
            "verticalBoundsChangedFrames": [],
            "rootAnchorMismatchFrames": [],
            "nonzeroRgbInTransparentPixels": int(np.count_nonzero(runtime_sheet[runtime_sheet[..., 3] == 0, :3])),
            "integerTranslationOnly": True,
        },
        "frames": frame_reports,
        "sourceSha256": sha256(SOURCE),
        "runtimeSha256": sha256(RUNTIME),
        "gameAssetSha256": sha256(GAME_ASSET),
        "previewGif": str(GIF.relative_to(ROOT)).replace("/", "\\"),
        "contact": str(CONTACT.relative_to(ROOT)).replace("/", "\\"),
    }
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"runtime={RUNTIME}")
    print(f"game={GAME_ASSET}")
    print(f"report={REPORT}")
    print(f"gif={GIF}")


if __name__ == "__main__":
    main()
