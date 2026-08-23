#!/usr/bin/env python3
"""Build the frozen arena's 16-frame rising-icicle gate spritesheet.

The gate is a deterministic geometry asset rather than an AI-drawn wall: its
base line is the exact 30-degree screen-space line consumed by WallGate, while
only the ice-spike height changes between frames. Frame 0 is closed and frame
15 is open, matching the existing WallGate state-machine contract.
"""

from __future__ import annotations

import argparse
import math
from pathlib import Path

from PIL import Image, ImageDraw


CELL_W = 640
CELL_H = 640
FRAMES = 16
SHEET_COLS = 4
SUPERSAMPLE = 3

BASE_A = (32.0, 300.0)
BASE_B = (608.0, 588.0)
GATE_X = (32, 608)

ICE_DARK = (7, 27, 42, 255)
ICE_SHADOW = (23, 67, 92, 255)
ICE_MID = (61, 132, 164, 255)
ICE_LIGHT = (175, 225, 238, 255)
ICE_FROST = (222, 246, 248, 245)


def smoothstep(value: float) -> float:
    value = max(0.0, min(1.0, value))
    return value * value * (3.0 - 2.0 * value)


def base_y(x: float) -> float:
    ratio = (x - BASE_A[0]) / (BASE_B[0] - BASE_A[0])
    return BASE_A[1] + ratio * (BASE_B[1] - BASE_A[1])


def points_scaled(points):
    return [(round(x * SUPERSAMPLE), round(y * SUPERSAMPLE)) for x, y in points]


def width_scaled(value: float) -> int:
    return max(1, round(value * SUPERSAMPLE))


def draw_frost_seam(draw: ImageDraw.ImageDraw, openness: float) -> None:
    thickness = 5.0 + 5.0 * (1.0 - openness)
    upper = []
    lower = []
    samples = 25
    for index in range(samples + 1):
        x = BASE_A[0] + (BASE_B[0] - BASE_A[0]) * index / samples
        jitter = math.sin(index * 2.17) * 2.2 + math.sin(index * 0.73) * 1.3
        y = base_y(x)
        upper.append((x, y - thickness + jitter))
        lower.append((x, y + 3.0 + jitter * 0.25))
    ridge = upper + list(reversed(lower))
    draw.polygon(points_scaled(ridge), fill=ICE_SHADOW)
    draw.line(points_scaled(upper), fill=ICE_LIGHT, width=width_scaled(2.0), joint="curve")


def draw_spike(draw: ImageDraw.ImageDraw, index: int, height_factor: float) -> None:
    count = 13
    t = (index + 0.5) / count
    x = BASE_A[0] + (BASE_B[0] - BASE_A[0]) * t
    ground = base_y(x)
    full_height = 220.0 + (index * 47 % 79) + (18.0 if index % 3 == 0 else 0.0)
    height = full_height * height_factor
    if height < 2.0:
        return

    half_width = 25.0 + (index * 11 % 9)
    lean = ((index % 5) - 2) * 2.7
    apex = (x + lean, ground - height)
    left = (x - half_width, ground + 5.0)
    right = (x + half_width, ground + 5.0)
    left_shoulder = (x - half_width * 0.62, ground - height * 0.30)
    right_shoulder = (x + half_width * 0.58, ground - height * 0.27)
    body = [left, left_shoulder, apex, right_shoulder, right]

    draw.polygon(points_scaled(body), fill=ICE_DARK)
    inset_left = (x - half_width * 0.74, ground + 1.0)
    inset_right = (x + half_width * 0.72, ground + 1.0)
    core = (x + lean * 0.35, ground - height * 0.08)
    draw.polygon(points_scaled([inset_left, left_shoulder, apex, core]), fill=ICE_MID)
    draw.polygon(points_scaled([core, apex, right_shoulder, inset_right]), fill=ICE_SHADOW)
    draw.polygon(points_scaled([
        (x - half_width * 0.28, ground - height * 0.08),
        (x + lean * 0.65, ground - height * 0.90),
        apex,
        core,
    ]), fill=ICE_LIGHT)

    highlight_top = (x + lean * 0.78, ground - height * 0.84)
    highlight_bottom = (x - half_width * 0.12, ground - height * 0.18)
    draw.line(points_scaled([highlight_top, highlight_bottom]), fill=ICE_FROST,
              width=width_scaled(2.0))
    if height > 90:
        crack_y = ground - height * (0.42 + (index % 3) * 0.08)
        crack = [
            (x - half_width * 0.12, crack_y - 9.0),
            (x + half_width * 0.10, crack_y),
            (x - half_width * 0.02, crack_y + 14.0),
        ]
        draw.line(points_scaled(crack), fill=(20, 68, 91, 210),
                  width=width_scaled(1.4), joint="curve")


def render_frame(frame_index: int) -> Image.Image:
    canvas = Image.new(
        "RGBA",
        (CELL_W * SUPERSAMPLE, CELL_H * SUPERSAMPLE),
        (0, 0, 0, 0),
    )
    draw = ImageDraw.Draw(canvas, "RGBA")
    openness = smoothstep(frame_index / (FRAMES - 1))
    height_factor = 1.0 - openness

    # Back-to-front order follows the sloping base so overlap reads as one ice barrier.
    for index in range(13):
        draw_spike(draw, index, height_factor)
    draw_frost_seam(draw, openness)

    frame = canvas.resize((CELL_W, CELL_H), Image.Resampling.LANCZOS)
    pixels = frame.load()
    for y in range(CELL_H):
        for x in range(CELL_W):
            if pixels[x, y][3] == 0:
                pixels[x, y] = (0, 0, 0, 0)
    return frame


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    rows = math.ceil(FRAMES / SHEET_COLS)
    sheet = Image.new("RGBA", (CELL_W * SHEET_COLS, CELL_H * rows), (0, 0, 0, 0))
    for frame_index in range(FRAMES):
        frame = render_frame(frame_index)
        x = (frame_index % SHEET_COLS) * CELL_W
        y = (frame_index // SHEET_COLS) * CELL_H
        sheet.alpha_composite(frame, (x, y))

    args.output.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(args.output, optimize=True)
    print(
        f"saved {args.output} sheet={sheet.width}x{sheet.height} "
        f"cell={CELL_W}x{CELL_H} frames={FRAMES} base={BASE_A}->{BASE_B} gateX={GATE_X}"
    )


if __name__ == "__main__":
    main()
