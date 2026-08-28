#!/usr/bin/env python3
"""Repair only reported temporal near-black specks in pounce RIFE frames."""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage


ROOT = Path(__file__).resolve().parent
SHEET = ROOT / "spritesheets" / "final" / "pounce.png"
REPORT = ROOT / "reports" / "sprites" / "final" / "pounce-rife.json"
PREVIEW_DIR = ROOT / "previews" / "sprites" / "final"
CELL_WIDTH = 1344
CELL_HEIGHT = 640
COLS = 6
FRAME_COUNT = 49
VISIBLE_ALPHA = 96
VISIBLE_DARK_MAX = 24
DILATION = 12
VISUAL_HOLD_FRAMES = (19, 35, 37)


def extract_cells() -> list[np.ndarray]:
    sheet = np.asarray(Image.open(SHEET).convert("RGBA")).copy()
    cells = []
    for index in range(FRAME_COUNT):
        row, col = divmod(index, COLS)
        cells.append(
            sheet[
                row * CELL_HEIGHT:(row + 1) * CELL_HEIGHT,
                col * CELL_WIDTH:(col + 1) * CELL_WIDTH,
            ].copy()
        )
    return cells


def compose(cells: list[np.ndarray]) -> np.ndarray:
    rows = math.ceil(len(cells) / COLS)
    sheet = np.zeros((rows * CELL_HEIGHT, COLS * CELL_WIDTH, 4), dtype=np.uint8)
    for index, cell in enumerate(cells):
        row, col = divmod(index, COLS)
        sheet[
            row * CELL_HEIGHT:(row + 1) * CELL_HEIGHT,
            col * CELL_WIDTH:(col + 1) * CELL_WIDTH,
        ] = cell
    return sheet


def visible_dark(frame: np.ndarray) -> np.ndarray:
    return (
        (frame[..., 3] > VISIBLE_ALPHA)
        & (frame[..., :3].max(axis=2) < VISIBLE_DARK_MAX)
    )


def temporal_outlier(
    middle: np.ndarray, first: np.ndarray, second: np.ndarray
) -> np.ndarray:
    neighbour_dark = visible_dark(first) | visible_dark(second)
    allowed = ndimage.binary_dilation(neighbour_dark, iterations=DILATION)
    return visible_dark(middle) & ~allowed


def checker(frame: np.ndarray) -> Image.Image:
    yy, xx = np.indices(frame.shape[:2])
    shade = np.where(((xx // 24 + yy // 24) % 2)[..., None], 58, 82)
    background = np.repeat(shade, 3, axis=2).astype(np.float32)
    alpha = frame[..., 3:4].astype(np.float32) / 255.0
    rgb = frame[..., :3].astype(np.float32) * alpha + background * (1.0 - alpha)
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB")


def write_previews(cells: list[np.ndarray]) -> None:
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    gif_frames = [
        checker(cell).resize((672, 320), Image.Resampling.LANCZOS) for cell in cells
    ]
    gif_frames[0].save(
        PREVIEW_DIR / "werewolf-king-pounce-interpolated.gif",
        save_all=True,
        append_images=gif_frames[1:],
        duration=round(1000 / 12),
        loop=0,
        disposal=2,
    )

    tile_width, tile_height, label_height = 240, 114, 22
    contact_cols = 6
    rows = math.ceil(len(cells) / contact_cols)
    contact = Image.new(
        "RGB", (contact_cols * tile_width, rows * (tile_height + label_height)), "#20242a"
    )
    draw = ImageDraw.Draw(contact)
    for index, cell in enumerate(cells):
        row, col = divmod(index, contact_cols)
        x = col * tile_width
        y = row * (tile_height + label_height)
        contact.paste(
            checker(cell).resize((tile_width, tile_height), Image.Resampling.LANCZOS),
            (x, y),
        )
        draw.text((x + 5, y + tile_height + 3), f"f{index} {'RIFE' if index % 2 else 'key'}", fill="white")
    contact.save(PREVIEW_DIR / "werewolf-king-pounce-interpolated-contact.png")


def main() -> None:
    report = json.loads(REPORT.read_text(encoding="utf-8"))
    reported = {
        int(index): int(count)
        for index, count in report["validation"]["visibleDarkOutlierFrames"].items()
    }
    cells = extract_cells()
    for index in VISUAL_HOLD_FRAMES:
        if index <= 0 or index >= len(cells) - 1 or index % 2 == 0:
            raise RuntimeError(f"invalid visual hold frame {index}")
        cells[index] = cells[index - 1].copy()

    repaired: dict[str, int] = {}
    for index in range(1, len(cells) - 1, 2):
        mask = temporal_outlier(cells[index], cells[index - 1], cells[index + 1])
        count = int(mask.sum())
        if index in reported and count != reported[index]:
            raise RuntimeError(
                f"pounce f{index}: report expected {reported[index]} dark pixels, found {count}"
            )
        if count == 0:
            continue
        valid = (cells[index][..., 3] > 32) & ~mask & (
            cells[index][..., :3].max(axis=2) >= VISIBLE_DARK_MAX
        )
        if not valid.any():
            raise RuntimeError(f"pounce f{index}: no valid replacement colors")
        _, nearest = ndimage.distance_transform_edt(~valid, return_indices=True)
        replacement = cells[index][..., :3][nearest[0], nearest[1]]
        cells[index][..., :3][mask] = replacement[mask]
        repaired[str(index)] = count

    remaining: dict[str, int] = {}
    for index in range(1, len(cells) - 1, 2):
        count = int(temporal_outlier(cells[index], cells[index - 1], cells[index + 1]).sum())
        if count:
            remaining[str(index)] = count
    if remaining:
        raise RuntimeError(f"pounce temporal dark outliers remain: {remaining}")

    Image.fromarray(compose(cells), "RGBA").save(SHEET, optimize=True)
    write_previews(cells)
    report["validation"]["visibleDarkOutlierFrames"] = {}
    previous_repair = report.get("taskSpecificPostRepair", {})
    repaired_history = dict(previous_repair.get("repairedPixelsByFrame", {}))
    repaired_history.update(repaired)
    report["taskSpecificPostRepair"] = {
        "method": "nearest valid same-frame color for temporal dark specks, plus visual-evidence holds for three severe magenta RIFE frames",
        "repairedPixelsByFrame": repaired_history,
        "wholeFrameHolds": list(VISUAL_HOLD_FRAMES),
        "holdSource": "previous original key frame",
    }
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report["taskSpecificPostRepair"], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
