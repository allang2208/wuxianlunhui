#!/usr/bin/env python3
"""Compose the approved frozen-abyss material into a deterministic 16-mask set.

The selected image is used only as a material and lighting source.  Geometry is
rebuilt as the project's exact 128x64 isometric cell.  One shared void master
and four fixed directional edge masters are composed according to the runtime
mask contract: +u, +v, -u, -v.

This script writes staged review artifacts only.  It never writes to assets/.
"""

from __future__ import annotations

import hashlib
import json
from collections import deque
from datetime import date
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[2]
SOURCE = (
    ROOT
    / "tools"
    / "ai-gen"
    / "_frozen_abyss_autotile_20260829"
    / "candidates_dev_s12_floor"
    / "frozen_abyss_style"
    / "frozen_abyss_style_refine_v02_raw.png"
)
FROZEN_FLOOR = ROOT / "assets" / "terrain" / "floor_snow_fresh_seamless.png"
OUTPUT = (
    ROOT
    / "tools"
    / "ai-gen"
    / "_frozen_abyss_autotile_20260829"
    / "staged_dev_refine_v02"
)
RUNTIME_ASSET = ROOT / "assets" / "terrain" / "frozen_abyss_autotile.png"

FRAME_W = 128
FRAME_H = 64
MASK_DIRECTIONS = ("+u", "+v", "-u", "-v")
EDGE_NAMES = ("bottom_right", "top_right", "top_left", "bottom_left")
PROOF_CELLS = {
    (-1, 1), (0, 0), (0, 1), (0, 2),
    (1, 0), (1, 1), (2, 0), (2, -1),
}


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _luminance(rgb: np.ndarray) -> np.ndarray:
    return rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722


def _central_dark_component(rgb: np.ndarray) -> tuple[int, int, int, int]:
    """Find the central pit without treating the pale generated backdrop as art."""
    height, width = rgb.shape[:2]
    lum = _luminance(rgb)
    mask = lum < 160
    mask[: int(height * 0.24)] = False
    mask[int(height * 0.76) :] = False
    mask[:, : int(width * 0.14)] = False
    mask[:, int(width * 0.86) :] = False

    center_window = lum[
        int(height * 0.42) : int(height * 0.58),
        int(width * 0.42) : int(width * 0.58),
    ]
    rel_y, rel_x = np.unravel_index(np.argmin(center_window), center_window.shape)
    seed_x = rel_x + int(width * 0.42)
    seed_y = rel_y + int(height * 0.42)
    if not mask[seed_y, seed_x]:
        raise RuntimeError("Could not locate the central dark abyss component")

    seen = np.zeros(mask.shape, dtype=np.uint8)
    queue: deque[tuple[int, int]] = deque([(seed_x, seed_y)])
    seen[seed_y, seed_x] = 1
    xs: list[int] = []
    ys: list[int] = []
    while queue:
        x, y = queue.popleft()
        xs.append(x)
        ys.append(y)
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < width and 0 <= ny < height and mask[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = 1
                queue.append((nx, ny))
    if len(xs) < 1000:
        raise RuntimeError("Detected abyss component is unexpectedly small")
    return int(min(xs)), int(min(ys)), int(max(xs) + 1), int(max(ys) + 1)


def _crop_exact_two_to_one(image: Image.Image) -> tuple[Image.Image, dict[str, int]]:
    rgb = np.asarray(image.convert("RGB"), dtype=np.float32)
    x0, y0, x1, y1 = _central_dark_component(rgb)
    cx = (x0 + x1) / 2
    cy = (y0 + y1) / 2
    component_w = x1 - x0
    component_h = y1 - y0
    crop_h = max(component_h, component_w / 2) * 1.055
    crop_w = crop_h * 2
    left = int(round(cx - crop_w / 2))
    top = int(round(cy - crop_h / 2))
    right = int(round(cx + crop_w / 2))
    bottom = int(round(cy + crop_h / 2))
    if left < 0 or top < 0 or right > image.width or bottom > image.height:
        raise RuntimeError("Automatic abyss crop exceeds the source canvas")
    crop = image.crop((left, top, right, bottom)).resize(
        (FRAME_W, FRAME_H), Image.Resampling.LANCZOS
    )
    return crop, {
        "componentX": x0,
        "componentY": y0,
        "componentWidth": component_w,
        "componentHeight": component_h,
        "cropX": left,
        "cropY": top,
        "cropWidth": right - left,
        "cropHeight": bottom - top,
    }


def _diamond_alpha(overdraw: float = 2.4) -> np.ndarray:
    yy, xx = np.mgrid[0:FRAME_H, 0:FRAME_W]
    cx = (FRAME_W - 1) / 2
    cy = (FRAME_H - 1) / 2
    normalized = np.abs(xx - cx) / (FRAME_W / 2) + np.abs(yy - cy) / (FRAME_H / 2)
    # A 1.2px vertical / 2.4px horizontal overdraw closes raster gaps where two
    # connected diamonds touch.  It remains inside the 128x64 frame bounds.
    return np.where(normalized <= 1 + overdraw / FRAME_H, 255, 0).astype(np.uint8)


def _smoothstep(edge0: float, edge1: float, value: np.ndarray) -> np.ndarray:
    t = np.clip((value - edge0) / (edge1 - edge0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def _make_masters(canonical: Image.Image) -> tuple[Image.Image, list[Image.Image]]:
    source = np.asarray(canonical.convert("RGB"), dtype=np.float32)
    alpha = _diamond_alpha()

    center_patch = source[27:39, 52:76]
    patch_lum = _luminance(center_patch)
    dark_pixels = center_patch[patch_lum <= np.percentile(patch_lum, 45)]
    void_rgb = np.median(dark_pixels, axis=0)
    # Preserve the approved cold near-black while avoiding compression-black voids.
    void_rgb = np.clip(void_rgb * np.array([0.92, 0.96, 1.02]), [13, 15, 18], [30, 34, 40])
    void_arr = np.zeros((FRAME_H, FRAME_W, 4), dtype=np.uint8)
    void_arr[..., :3] = np.round(void_rgb).astype(np.uint8)
    void_arr[..., 3] = alpha
    void = Image.fromarray(void_arr, "RGBA")

    yy, xx = np.mgrid[0:FRAME_H, 0:FRAME_W]
    dx = (xx - (FRAME_W - 1) / 2) / (FRAME_W / 2)
    dy = (yy - (FRAME_H - 1) / 2) / (FRAME_H / 2)
    side_values = (
        dx + dy,   # +u: bottom-right edge
        dx - dy,   # +v: top-right edge
        -dx - dy,  # -u: top-left edge
        -dx + dy,  # -v: bottom-left edge
    )
    strict_ownership = (
        (dx > 0) & (dy > 0),
        (dx > 0) & (dy < 0),
        (dx < 0) & (dy < 0),
        (dx < 0) & (dy > 0),
    )
    pos_x = _smoothstep(-0.10, 0.08, dx)
    neg_x = _smoothstep(-0.10, 0.08, -dx)
    pos_y = _smoothstep(-0.10, 0.08, dy)
    neg_y = _smoothstep(-0.10, 0.08, -dy)
    soft_ownership = (
        pos_x * pos_y,
        pos_x * neg_y,
        neg_x * neg_y,
        neg_x * pos_y,
    )
    # Dark cliff/void pixels may feather across a quadrant boundary, while pale
    # snow is held to strict ownership so it cannot curl into a connected edge.
    bright_weight = _smoothstep(145.0, 205.0, _luminance(source))

    masters: list[Image.Image] = []
    for side_value, strict, soft in zip(side_values, strict_ownership, soft_ownership):
        inward = 1.0 - side_value
        # Use the approved source at the rim, then feather into the shared void.
        edge_opacity = 1.0 - _smoothstep(0.28, 0.70, inward)
        ownership = soft * (1.0 - bright_weight) + strict * bright_weight
        edge_opacity *= ownership
        edge_alpha = np.round(edge_opacity * alpha).astype(np.uint8)
        rgba = np.empty((FRAME_H, FRAME_W, 4), dtype=np.uint8)
        rgba[..., :3] = np.round(source).astype(np.uint8)
        rgba[..., 3] = edge_alpha
        masters.append(Image.fromarray(rgba, "RGBA"))
    return void, masters


def _compose_frame(mask: int, void: Image.Image, edges: list[Image.Image]) -> Image.Image:
    frame = void.copy()
    for bit, edge in enumerate(edges):
        if (mask & (1 << bit)) == 0:
            frame.alpha_composite(edge)
    return frame


def _snow_background(size: tuple[int, int], seed: int = 122202) -> Image.Image:
    width, height = size
    if not FROZEN_FLOOR.exists():
        raise FileNotFoundError(FROZEN_FLOOR)
    tile = Image.open(FROZEN_FLOOR).convert("RGB")
    background = Image.new("RGB", (width, height))
    offset_x = seed % tile.width
    offset_y = (seed // 7) % tile.height
    for y in range(-offset_y, height, tile.height):
        for x in range(-offset_x, width, tile.width):
            background.paste(tile, (x, y))
    # Keep labels and near-black void readable without changing the floor hue.
    veil = Image.new("RGB", (width, height), (225, 232, 242))
    return Image.blend(background, veil, 0.12).convert("RGBA")


def _font(size: int) -> ImageFont.ImageFont:
    candidates = (
        Path("C:/Windows/Fonts/consola.ttf"),
        Path("C:/Windows/Fonts/arial.ttf"),
    )
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


def _save_contact_sheet(frames: list[Image.Image], path: Path) -> None:
    scale = 2
    cell_w = FRAME_W * scale + 36
    cell_h = FRAME_H * scale + 46
    sheet = _snow_background((cell_w * 4 + 28, cell_h * 4 + 28))
    draw = ImageDraw.Draw(sheet)
    font = _font(22)
    for mask, frame in enumerate(frames):
        col = mask % 4
        row = mask // 4
        x = 14 + col * cell_w + 18
        y = 14 + row * cell_h + 30
        enlarged = frame.resize((FRAME_W * scale, FRAME_H * scale), Image.Resampling.NEAREST)
        sheet.alpha_composite(enlarged, (x, y))
        label = f"{mask:02d}  {mask:04b}"
        draw.text((x, y - 27), label, font=font, fill=(27, 36, 48, 255))
    sheet.convert("RGB").save(path, quality=95)


def _save_master_preview(void: Image.Image, edges: list[Image.Image], path: Path) -> None:
    items = [("void", void)] + list(zip(EDGE_NAMES, edges))
    scale = 3
    cell_w = FRAME_W * scale + 24
    width = cell_w * len(items) + 24
    height = FRAME_H * scale + 70
    sheet = _snow_background((width, height), seed=122203)
    draw = ImageDraw.Draw(sheet)
    font = _font(20)
    for index, (name, image) in enumerate(items):
        x = 12 + index * cell_w + 12
        y = 48
        enlarged = image.resize((FRAME_W * scale, FRAME_H * scale), Image.Resampling.NEAREST)
        sheet.alpha_composite(enlarged, (x, y))
        draw.text((x, 16), name, font=font, fill=(25, 34, 47, 255))
    sheet.convert("RGB").save(path, quality=95)


def _save_seam_proof(frames: list[Image.Image], path: Path) -> list[dict[str, int]]:
    scale = 3
    placements: list[tuple[int, int, int, int, int]] = []
    records: list[dict[str, int]] = []
    steps = ((1, 0), (0, 1), (-1, 0), (0, -1))
    for u, v in PROOF_CELLS:
        mask = 0
        for bit, (du, dv) in enumerate(steps):
            if (u + du, v + dv) in PROOF_CELLS:
                mask |= 1 << bit
        # Match frozen-arena-terrain.js exactly:
        # u => (+64,+32), v => (+64,-32).
        x = (u + v) * (FRAME_W // 2)
        y = (u - v) * (FRAME_H // 2)
        placements.append((y, x, mask, u, v))
        records.append({"u": u, "v": v, "mask": mask})

    min_x = min(x - FRAME_W // 2 for _, x, _, _, _ in placements)
    max_x = max(x + FRAME_W // 2 for _, x, _, _, _ in placements)
    min_y = min(y - FRAME_H // 2 for y, _, _, _, _ in placements)
    max_y = max(y + FRAME_H // 2 for y, _, _, _, _ in placements)
    pad = 42
    canvas = _snow_background(((max_x - min_x) * scale + pad * 2,
                               (max_y - min_y) * scale + pad * 2), seed=122204)
    for y, x, mask, _, _ in sorted(placements):
        px = (x - FRAME_W // 2 - min_x) * scale + pad
        py = (y - FRAME_H // 2 - min_y) * scale + pad
        enlarged = frames[mask].resize((FRAME_W * scale, FRAME_H * scale), Image.Resampling.NEAREST)
        canvas.alpha_composite(enlarged, (px, py))
    canvas.convert("RGB").save(path, quality=95)
    return sorted(records, key=lambda item: (item["v"], item["u"]))


def main() -> None:
    if not SOURCE.exists():
        raise FileNotFoundError(SOURCE)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    frame_dir = OUTPUT / "frames"
    master_dir = OUTPUT / "masters"
    frame_dir.mkdir(exist_ok=True)
    master_dir.mkdir(exist_ok=True)

    source = Image.open(SOURCE).convert("RGB")
    canonical, crop_info = _crop_exact_two_to_one(source)
    canonical.save(OUTPUT / "frozen_abyss_material_canonical_128x64.png")
    void, edges = _make_masters(canonical)
    void.save(master_dir / "frozen_abyss_void.png")
    for bit, (direction, edge_name, edge) in enumerate(zip(MASK_DIRECTIONS, EDGE_NAMES, edges)):
        edge.save(master_dir / f"frozen_abyss_edge_{bit}_{edge_name}.png")

    frames = [_compose_frame(mask, void, edges) for mask in range(16)]
    atlas = Image.new("RGBA", (FRAME_W * 4, FRAME_H * 4), (0, 0, 0, 0))
    for mask, frame in enumerate(frames):
        frame.save(frame_dir / f"frozen_abyss_mask_{mask:02d}.png")
        atlas.alpha_composite(frame, ((mask % 4) * FRAME_W, (mask // 4) * FRAME_H))
    atlas.save(OUTPUT / "frozen_abyss_autotile_4x4.png")

    _save_contact_sheet(frames, OUTPUT / "frozen_abyss_autotile_contact_sheet.jpg")
    _save_master_preview(void, edges, OUTPUT / "frozen_abyss_five_masters.jpg")
    proof_records = _save_seam_proof(frames, OUTPUT / "frozen_abyss_autotile_seam_proof.jpg")
    staged_atlas = OUTPUT / "frozen_abyss_autotile_4x4.png"
    runtime_installed = (
        RUNTIME_ASSET.exists()
        and _sha256(RUNTIME_ASSET) == _sha256(staged_atlas)
    )

    manifest = {
        "asset": "frozen_abyss_autotile",
        "status": "runtime_installed" if runtime_installed else "staged_pending_runtime_asset_approval",
        "date": date.today().isoformat(),
        "selectedSource": str(SOURCE.relative_to(ROOT)).replace("\\", "/"),
        "selectedSourceSha256": _sha256(SOURCE),
        "sourceGeneration": {
            "model": "flux2-dev-depth",
            "style": "world122-building-v5",
            "steps": 48,
            "cfg": 3.5,
            "depthStrength": 0.75,
            "denoise": 0.30,
            "seed": 122202,
        },
        "geometry": {
            "frameWidth": FRAME_W,
            "frameHeight": FRAME_H,
            "atlasColumns": 4,
            "atlasRows": 4,
            "maskBits": [
                {"bit": bit, "direction": direction, "screenEdge": edge_name}
                for bit, (direction, edge_name) in enumerate(zip(MASK_DIRECTIONS, EDGE_NAMES))
            ],
            "connectedBitMeaning": "1 removes that directional edge; 0 draws it",
        },
        "composition": {
            "sharedVoidMaster": "masters/frozen_abyss_void.png",
            "directionalEdgeMasters": [
                f"masters/frozen_abyss_edge_{bit}_{name}.png"
                for bit, name in enumerate(EDGE_NAMES)
            ],
            "method": "deterministic shared master composition; no per-mask generation or rotation",
            "crop": crop_info,
        },
        "outputs": {
            "atlas": "frozen_abyss_autotile_4x4.png",
            "frames": "frames/frozen_abyss_mask_00.png ... frozen_abyss_mask_15.png",
            "contactSheet": "frozen_abyss_autotile_contact_sheet.jpg",
            "fiveMasters": "frozen_abyss_five_masters.jpg",
            "seamProof": "frozen_abyss_autotile_seam_proof.jpg",
        },
        "reviewBackdrop": str(FROZEN_FLOOR.relative_to(ROOT)).replace("\\", "/"),
        "seamProofCells": proof_records,
        "runtimeAsset": str(RUNTIME_ASSET.relative_to(ROOT)).replace("\\", "/"),
        "runtimeInstalled": runtime_installed,
    }
    (OUTPUT / "frozen_abyss_autotile_staged_manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    main()
