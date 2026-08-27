#!/usr/bin/env python3
"""Losslessly split the visible sword-grip hands from formal melee sheets."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image


FRAME = 512
PLAYER_DISPLAY = 144


def subject_mask(frame: np.ndarray) -> np.ndarray:
    rgb = frame[:, :, :3].astype(np.int16)
    alpha = frame[:, :, 3]
    r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    green = (g > 70) & (g - r > 32) & (g - b > 32)
    return (alpha > 0) & ~green


def ellipse_mask(width: int, height: int, centers: list[tuple[float, float]], rx=31, ry=27) -> np.ndarray:
    yy, xx = np.mgrid[0:height, 0:width]
    mask = np.zeros((height, width), dtype=bool)
    for cx, cy in centers:
        mask |= ((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2 <= 1
    return mask


def split_sheet(source: Path, body_out: Path, hand_out: Path, cols: int, rows: int,
                frame_centers: list[list[tuple[float, float]]]) -> None:
    original = np.asarray(Image.open(source).convert("RGBA"))
    body = original.copy()
    hand = np.zeros_like(original)
    for index, centers in enumerate(frame_centers):
        x0, y0 = (index % cols) * FRAME, (index // cols) * FRAME
        cell = original[y0:y0 + FRAME, x0:x0 + FRAME]
        selected = ellipse_mask(FRAME, FRAME, centers) & subject_mask(cell)
        hand_cell = hand[y0:y0 + FRAME, x0:x0 + FRAME]
        body_cell = body[y0:y0 + FRAME, x0:x0 + FRAME]
        hand_cell[selected] = cell[selected]
        body_cell[selected] = 0
    recomposed = body.copy()
    selected_all = hand[:, :, 3] > 0
    recomposed[selected_all] = hand[selected_all]
    if not np.array_equal(recomposed, original):
        raise ValueError(f"lossless split failed for {source.name}")
    Image.fromarray(body, "RGBA").save(body_out)
    Image.fromarray(hand, "RGBA").save(hand_out)
    print(f"{source.name}: body+hand pixel-identical")


def attack_centers(frames: list[dict], display_scale: float) -> list[list[tuple[float, float]]]:
    px_per_world = FRAME / (PLAYER_DISPLAY * display_scale)
    result = []
    for frame in frames:
        cx = 256 + float(frame.get("offsetX", 0)) * px_per_world
        cy = 256 + float(frame.get("offsetY", 0)) * px_per_world
        angle = np.deg2rad(float(frame.get("rotation", 0)))
        # A broad primary palm mask plus a second grip-hand sample along the handle axis.
        result.append([(cx, cy), (cx + 12 * np.sin(angle), cy - 12 * np.cos(angle))])
    return result


def main() -> None:
    root = Path(__file__).resolve().parents[2]
    cfg = json.loads((root / "public/data/weapon-anim-config.json").read_text(encoding="utf-8"))
    sword = cfg["sword"]
    jobs = [
        ("attack_sword.png", "attack_sword_body.png", "attack_sword_hand.png", 4, 3,
         attack_centers(sword["attack"]["frames"], 1.0956)),
        ("attack_sword_2.png", "attack_sword_2_body.png", "attack_sword_2_hand.png", 4, 3,
         attack_centers(sword["attack2"]["frames"], 1.0956)),
        ("attack_sword_3.png", "attack_sword_3_body.png", "attack_sword_3_hand.png", 4, 4,
         attack_centers(sword["attack3"]["frames"], 1.0956)),
    ]
    # Recover is authored body animation without a weapon track; these points follow the main fist
    # from the combo terminal pose into the relaxed idle grip.
    recover = [
        [(305, 272)], [(311, 274)], [(318, 278)], [(324, 282)], [(331, 288)],
        [(337, 296)], [(343, 304)], [(349, 311)], [(355, 319)], [(360, 326)],
        [(365, 333)], [(369, 339)], [(372, 344)],
    ]
    jobs.append(("recover_sheet.png", "recover_body.png", "recover_hand.png", 5, 3, recover))
    player = root / "assets/player"
    for source, body, hand, cols, rows, centers in jobs:
        split_sheet(player / source, player / body, player / hand, cols, rows, centers)


if __name__ == "__main__":
    main()
