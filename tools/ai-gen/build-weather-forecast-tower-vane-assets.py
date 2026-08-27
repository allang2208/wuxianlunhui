#!/usr/bin/env python3
"""Split the accepted weather tower into a static body and animated vane overlay."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[2]
BODY_PATH = ROOT / "assets/terrain/weather_forecast_tower.png"
PANEL_PATH = ROOT / "assets/terrain/weather_forecast_tower_panel.png"
SHEET_PATH = ROOT / "assets/terrain/weather_forecast_tower_vane.png"
THUMB_PATH = ROOT / "assets/ui/building-thumbnails/weather_forecast_tower.png"
WORK_DIR = ROOT / "tools/ai-gen/_settlement_building_pack_20260821/weather_forecast_tower"
FRAME_DIR = WORK_DIR / "vane_frames"
BACKUP_PATH = WORK_DIR / "weather_forecast_tower_static_before_vane_split.png"
PREVIEW_PATH = WORK_DIR / "weather_forecast_tower_vane_preview.gif"
METADATA_PATH = WORK_DIR / "weather_forecast_tower_vane_metadata.json"

FRAME_COUNT = 32
SHEET_COLUMNS = 8
RUNTIME_SIZE = (606, 718)
OVERLAY_FRAME_SIZE = (160, 128)
OVERLAY_FRAME_PIVOT = (80, 64)
MODEL_UNION_BOX = (391, 96, 582, 204)
MODEL_PIVOT = (487, 156)
BODY_PIVOT = (282, 65)
OVERLAY_SCALE = 0.68
STATIC_CLEAR_RECT = (210, 22, 352, 126)
MAST_KEEP_RECT = (279, 0, 286, 136)
HUB_KEEP_RADIUS = (10, 10)


def premultiplied_resize(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    rgba = np.asarray(image.convert("RGBA"), dtype=np.float32) / 255.0
    alpha = rgba[..., 3:4]
    premultiplied = np.concatenate([rgba[..., :3] * alpha, alpha], axis=2)
    channels = [
        Image.fromarray(np.uint8(np.clip(premultiplied[..., index] * 255, 0, 255)), "L")
        .resize(size, Image.Resampling.LANCZOS)
        for index in range(4)
    ]
    resized = np.stack([np.asarray(channel, dtype=np.float32) / 255.0 for channel in channels], axis=2)
    out_alpha = resized[..., 3:4]
    rgb = np.divide(
        resized[..., :3], np.maximum(out_alpha, 1e-6),
        out=np.zeros_like(resized[..., :3]), where=out_alpha > 1e-6,
    )
    return Image.fromarray(np.uint8(np.clip(np.concatenate([rgb, out_alpha], axis=2) * 255, 0, 255)), "RGBA")


def make_static_body(source: Image.Image) -> Image.Image:
    rgba = np.asarray(source.convert("RGBA"), dtype=np.uint8).copy()
    x0, y0, x1, y1 = STATIC_CLEAR_RECT
    yy, xx = np.ogrid[:source.height, :source.width]
    region = (xx >= x0) & (xx < x1) & (yy >= y0) & (yy < y1)
    keep_mast = ((xx >= MAST_KEEP_RECT[0]) & (xx < MAST_KEEP_RECT[2])
                 & (yy >= MAST_KEEP_RECT[1]) & (yy < MAST_KEEP_RECT[3]))
    rx, ry = HUB_KEEP_RADIUS
    keep_hub = (((xx - BODY_PIVOT[0]) / rx) ** 2 + ((yy - BODY_PIVOT[1]) / ry) ** 2) <= 1.0
    clear = region & ~keep_mast & ~keep_hub & (rgba[..., 3] > 0)
    rgba[clear] = (0, 0, 0, 0)
    return Image.fromarray(rgba, "RGBA")


def aligned_overlay(frame: Image.Image) -> Image.Image:
    moving = frame.convert("RGBA").crop(MODEL_UNION_BOX)
    target_size = (
        max(1, round(moving.width * OVERLAY_SCALE)),
        max(1, round(moving.height * OVERLAY_SCALE)),
    )
    moving = premultiplied_resize(moving, target_size)
    pivot_in_crop = (
        (MODEL_PIVOT[0] - MODEL_UNION_BOX[0]) * OVERLAY_SCALE,
        (MODEL_PIVOT[1] - MODEL_UNION_BOX[1]) * OVERLAY_SCALE,
    )
    target = Image.new("RGBA", OVERLAY_FRAME_SIZE, (0, 0, 0, 0))
    target.alpha_composite(moving, (
        round(OVERLAY_FRAME_PIVOT[0] - pivot_in_crop[0]),
        round(OVERLAY_FRAME_PIVOT[1] - pivot_in_crop[1]),
    ))
    return target


def make_thumbnail(source: Image.Image) -> Image.Image:
    alpha = np.asarray(source.getchannel("A"))
    ys, xs = np.where(alpha >= 8)
    crop = source.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))
    crop.thumbnail((122, 58), Image.Resampling.LANCZOS)
    target = Image.new("RGBA", (128, 64), (0, 0, 0, 0))
    target.alpha_composite(crop, ((128 - crop.width) // 2, (64 - crop.height) // 2))
    return target


def checkerboard(size: tuple[int, int], cell: int = 12) -> Image.Image:
    target = Image.new("RGBA", size, (112, 118, 124, 255))
    draw = ImageDraw.Draw(target)
    for y in range(0, size[1], cell):
        for x in range(0, size[0], cell):
            if (x // cell + y // cell) % 2:
                draw.rectangle((x, y, x + cell - 1, y + cell - 1), fill=(148, 154, 160, 255))
    return target


def main() -> None:
    source_path = BACKUP_PATH if BACKUP_PATH.exists() else BODY_PATH
    source = Image.open(source_path).convert("RGBA")
    if source.size != RUNTIME_SIZE:
        raise SystemExit(f"unexpected runtime body size: {source.size}, expected {RUNTIME_SIZE}")
    frames = [FRAME_DIR / f"vane_{index:03d}.png" for index in range(FRAME_COUNT)]
    missing = [str(path) for path in frames if not path.exists()]
    if missing:
        raise SystemExit(f"missing rendered vane frames: {missing[:3]}")

    if not BACKUP_PATH.exists():
        source.save(BACKUP_PATH, optimize=True)
    source.save(PANEL_PATH, optimize=True)
    make_thumbnail(source).save(THUMB_PATH, optimize=True)

    body = make_static_body(source)
    body.save(BODY_PATH, optimize=True)

    overlays = [aligned_overlay(Image.open(path)) for path in frames]
    sheet = Image.new("RGBA", (OVERLAY_FRAME_SIZE[0] * SHEET_COLUMNS,
                               OVERLAY_FRAME_SIZE[1] * (FRAME_COUNT // SHEET_COLUMNS)),
                      (0, 0, 0, 0))
    for index, overlay in enumerate(overlays):
        sheet.alpha_composite(overlay, (
            (index % SHEET_COLUMNS) * OVERLAY_FRAME_SIZE[0],
            (index // SHEET_COLUMNS) * OVERLAY_FRAME_SIZE[1],
        ))
    sheet.save(SHEET_PATH, optimize=True)

    preview_frames = []
    for overlay in overlays:
        composite = body.copy()
        composite.alpha_composite(overlay, (
            BODY_PIVOT[0] - OVERLAY_FRAME_PIVOT[0],
            BODY_PIVOT[1] - OVERLAY_FRAME_PIVOT[1],
        ))
        composite = premultiplied_resize(composite, (256, 303))
        matte = checkerboard(composite.size)
        matte.alpha_composite(composite)
        preview_frames.append(matte.convert("P", palette=Image.Palette.ADAPTIVE, colors=255))
    preview_frames[0].save(
        PREVIEW_PATH, save_all=True, append_images=preview_frames[1:],
        duration=125, loop=0, disposal=2,
    )

    METADATA_PATH.write_text(json.dumps({
        "sourceBody": BODY_PATH.relative_to(ROOT).as_posix(),
        "panelTexture": PANEL_PATH.relative_to(ROOT).as_posix(),
        "overlaySheet": SHEET_PATH.relative_to(ROOT).as_posix(),
        "frameSize": list(OVERLAY_FRAME_SIZE),
        "frameCount": FRAME_COUNT,
        "sheetColumns": SHEET_COLUMNS,
        "bodyPivot": list(BODY_PIVOT),
        "overlayFramePivot": list(OVERLAY_FRAME_PIVOT),
        "modelPivot": list(MODEL_PIVOT),
        "overlayScale": OVERLAY_SCALE,
        "staticClearRect": list(STATIC_CLEAR_RECT),
        "mastKeepRect": list(MAST_KEEP_RECT),
        "runtimeContract": "static body + independent overlay; 2x2 footprint unchanged",
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(BODY_PATH)
    print(PANEL_PATH)
    print(SHEET_PATH)
    print(PREVIEW_PATH)


if __name__ == "__main__":
    main()
