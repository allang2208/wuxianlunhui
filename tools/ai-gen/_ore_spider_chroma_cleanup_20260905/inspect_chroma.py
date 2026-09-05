#!/usr/bin/env python3
"""Audit visible green-screen residue in the installed Ore Spider sheets."""

from __future__ import annotations

import hashlib
import io
import json
import subprocess
from collections import Counter
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[3]
ASSET_DIR = ROOT / "assets" / "enemies" / "ore_spider"
OUT_DIR = Path(__file__).resolve().parent / "audit"
SHEETS = {
    "idle": ("idle.png", 1),
    "walking": ("walking.png", 14),
    "attacking": ("attacking.png", 28),
    "slam": ("attacking-2.png", 18),
    "dying": ("dying.png", 12),
}
CELL = 512
COLS = 8


def rgba_bytes_from_head(relative_path: str) -> bytes | None:
    result = subprocess.run(
        ["git", "cat-file", "blob", f"HEAD:{relative_path}"],
        cwd=ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    return result.stdout if result.returncode == 0 else None


def split_cells(sheet: np.ndarray, count: int) -> list[np.ndarray]:
    return [sheet[(i // COLS) * CELL:(i // COLS + 1) * CELL,
                  (i % COLS) * CELL:(i % COLS + 1) * CELL].copy()
            for i in range(count)]


def green_masks(frame: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    rgb = frame[..., :3].astype(np.int16)
    alpha = frame[..., 3]
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    excess = g - np.maximum(r, b)
    # The approved creature palette is violet crystal + coal/brown limbs. Green
    # dominance is therefore a reliable chroma-residue signal for this asset.
    suspect = (alpha > 3) & (g >= 28) & (excess >= 7)
    strong = (alpha > 12) & (g >= 40) & (excess >= 14)
    return suspect, strong


def checker(size: tuple[int, int], tile: int = 12) -> Image.Image:
    w, h = size
    yy, xx = np.indices((h, w))
    mask = ((xx // tile + yy // tile) % 2).astype(bool)
    rgb = np.empty((h, w, 3), dtype=np.uint8)
    rgb[mask] = (43, 48, 54)
    rgb[~mask] = (76, 82, 88)
    return Image.fromarray(rgb, "RGB").convert("RGBA")


def composite(frame: np.ndarray) -> Image.Image:
    bg = checker((CELL, CELL))
    fg = Image.fromarray(frame, "RGBA")
    bg.alpha_composite(fg)
    return bg


def make_green_contact(action: str, cells: list[np.ndarray], picks: list[int]) -> None:
    scale = 0.55
    thumb = round(CELL * scale)
    label_h = 34
    canvas = Image.new("RGB", (thumb * len(picks), (thumb + label_h) * 2), (18, 21, 25))
    draw = ImageDraw.Draw(canvas)
    font = ImageFont.truetype("C:/Windows/Fonts/consola.ttf", 17)
    for col, index in enumerate(picks):
        frame = cells[index]
        normal = composite(frame).resize((thumb, thumb), Image.Resampling.LANCZOS).convert("RGB")
        suspect, strong = green_masks(frame)
        marked = np.array(composite(frame).convert("RGB"))
        marked[suspect] = np.rint(marked[suspect] * .35 + np.array([255, 0, 210]) * .65).astype(np.uint8)
        marked[strong] = (255, 35, 210)
        marked_im = Image.fromarray(marked, "RGB").resize((thumb, thumb), Image.Resampling.NEAREST)
        x = col * thumb
        canvas.paste(normal, (x, 0))
        canvas.paste(marked_im, (x, thumb + label_h))
        draw.text((x + 8, thumb + 7), f"frame {index:02d} / original", font=font, fill=(225, 232, 236))
        draw.text((x + 8, 2 * thumb + label_h + 7), f"frame {index:02d} / green mask", font=font, fill=(255, 142, 226))
    canvas.save(OUT_DIR / f"{action}-green-audit.png", optimize=True)


def make_head_comparison(action: str, current: list[np.ndarray], head: list[np.ndarray], picks: list[int]) -> None:
    thumb = 256
    label_h = 30
    canvas = Image.new("RGB", (thumb * len(picks), (thumb + label_h) * 2), (18, 21, 25))
    draw = ImageDraw.Draw(canvas)
    font = ImageFont.truetype("C:/Windows/Fonts/consola.ttf", 16)
    for col, index in enumerate(picks):
        x = col * thumb
        current_im = composite(current[index]).resize((thumb, thumb), Image.Resampling.LANCZOS).convert("RGB")
        head_im = composite(head[index]).resize((thumb, thumb), Image.Resampling.LANCZOS).convert("RGB")
        canvas.paste(current_im, (x, 0))
        canvas.paste(head_im, (x, thumb + label_h))
        draw.text((x + 7, thumb + 6), f"current f{index:02d}", font=font, fill=(255, 210, 244))
        draw.text((x + 7, 2 * thumb + label_h + 6), f"HEAD f{index:02d}", font=font, fill=(205, 220, 230))
    canvas.save(OUT_DIR / f"{action}-current-vs-head.png", optimize=True)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    report: dict[str, object] = {
        "asset": "oreSpider",
        "cell": [CELL, CELL],
        "columns": COLS,
        "greenRule": "alpha>3, G>=28, G-max(R,B)>=7; strong alpha>12, G>=40, excess>=14",
        "sheets": {},
    }
    for action, (filename, count) in SHEETS.items():
        path = ASSET_DIR / filename
        raw = path.read_bytes()
        image = Image.open(io.BytesIO(raw)).convert("RGBA")
        arr = np.array(image)
        cells = split_cells(arr, count)
        per_frame = []
        all_colors: Counter[tuple[int, int, int, int]] = Counter()
        for index, cell in enumerate(cells):
            suspect, strong = green_masks(cell)
            visible = cell[..., 3] > 3
            colors = cell[suspect]
            all_colors.update(map(tuple, colors.tolist()))
            per_frame.append({
                "frame": index,
                "visiblePixels": int(visible.sum()),
                "suspectGreenPixels": int(suspect.sum()),
                "strongGreenPixels": int(strong.sum()),
                "suspectAlphaSum": int(cell[..., 3][suspect].sum()),
            })
        head_raw = rgba_bytes_from_head(f"assets/enemies/ore_spider/{filename}")
        head_pixel_equal = None
        head_file_sha = None
        head_size = None
        head_suspect = None
        head_strong = None
        changed_pixels = None
        changed_rgb_pixels = None
        changed_alpha_pixels = None
        if head_raw:
            head_file_sha = hashlib.sha256(head_raw).hexdigest()
            head_image = Image.open(io.BytesIO(head_raw)).convert("RGBA")
            head_size = list(head_image.size)
            head_arr = np.array(head_image)
            head_pixel_equal = bool(head_arr.shape == arr.shape and np.array_equal(head_arr, arr))
            head_cells = split_cells(head_arr, count)
            current_valid = np.concatenate(cells, axis=1)
            head_valid = np.concatenate(head_cells, axis=1)
            changed_pixels = int(np.any(head_valid != current_valid, axis=2).sum())
            changed_rgb_pixels = int(np.any(head_valid[..., :3] != current_valid[..., :3], axis=2).sum())
            changed_alpha_pixels = int((head_valid[..., 3] != current_valid[..., 3]).sum())
            same_index_iou = []
            for index, (current_cell, head_cell) in enumerate(zip(cells, head_cells)):
                current_mask = current_cell[..., 3] > 3
                head_mask = head_cell[..., 3] > 3
                union = current_mask | head_mask
                intersection = current_mask & head_mask
                same_index_iou.append({
                    "frame": index,
                    "alphaIou": round(float(intersection.sum() / max(1, union.sum())), 6),
                    "overlapRgbMae": round(float(np.abs(
                        current_cell[..., :3].astype(np.int16) - head_cell[..., :3].astype(np.int16)
                    )[intersection].mean()), 4) if intersection.any() else None,
                })
            if head_arr.shape == arr.shape:
                head_suspect_mask, head_strong_mask = green_masks(head_arr)
                head_suspect = int(head_suspect_mask.sum())
                head_strong = int(head_strong_mask.sum())
            else:
                head_suspect = sum(int(green_masks(cell)[0].sum()) for cell in head_cells)
                head_strong = sum(int(green_masks(cell)[1].sum()) for cell in head_cells)
            if action == "walking":
                make_head_comparison(action, cells, head_cells, [0, 2, 5, 8, 11, 13])
            elif action == "attacking":
                make_head_comparison(action, cells, head_cells, [0, 5, 10, 16, 21, 27])
        report["sheets"][action] = {
            "path": str(path.relative_to(ROOT)).replace("\\", "/"),
            "size": list(image.size),
            "mode": image.mode,
            "frameCount": count,
            "fileBytes": len(raw),
            "fileSha256": hashlib.sha256(raw).hexdigest(),
            "headFileSha256": head_file_sha,
            "headSize": head_size,
            "pixelsEqualHead": head_pixel_equal,
            "headSuspectGreenPixels": head_suspect,
            "headStrongGreenPixels": head_strong,
            "changedPixelsFromHead": changed_pixels,
            "changedRgbPixelsFromHead": changed_rgb_pixels,
            "changedAlphaPixelsFromHead": changed_alpha_pixels,
            "sameIndexHeadComparison": same_index_iou if head_raw else None,
            "suspectGreenPixels": sum(row["suspectGreenPixels"] for row in per_frame),
            "strongGreenPixels": sum(row["strongGreenPixels"] for row in per_frame),
            "topSuspectColors": [[list(color), n] for color, n in all_colors.most_common(12)],
            "frames": per_frame,
        }
        picks_by_action = {
            "walking": [0, 2, 5, 8, 11, 13],
            "attacking": [0, 5, 10, 16, 21, 27],
            "dying": [0, 2, 4, 7, 9, 11],
        }
        if action in picks_by_action:
            make_green_contact(action, cells, picks_by_action[action])
    (OUT_DIR / "chroma-audit.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    for action, entry in report["sheets"].items():
        print(f"{action:9s} suspect={entry['suspectGreenPixels']:6d} "
              f"strong={entry['strongGreenPixels']:6d} pixelsEqualHead={entry['pixelsEqualHead']}")


if __name__ == "__main__":
    main()
