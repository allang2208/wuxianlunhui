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
SUPERSAMPLE = 4

BASE_A = (32.0, 300.0)
BASE_B = (608.0, 588.0)
GATE_X = (32, 608)

ICE_DARK = (7, 27, 42, 255)
ICE_DEEP = (10, 47, 73, 255)
ICE_SHADOW = (23, 67, 92, 255)
ICE_MID = (61, 132, 164, 255)
ICE_CYAN = (80, 181, 209, 255)
ICE_LIGHT = (175, 225, 238, 255)
ICE_FROST = (222, 246, 248, 245)
ICE_WHITE = (239, 253, 255, 255)


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


def blend_rgb(a, b, amount: float):
    """Opaque deterministic colour blend used for the crystal's internal bands."""
    amount = max(0.0, min(1.0, amount))
    return tuple(round(a[i] + (b[i] - a[i]) * amount) for i in range(3)) + (255,)


def draw_frost_seam(draw: ImageDraw.ImageDraw, openness: float) -> None:
    thickness = 6.0 + 7.0 * (1.0 - openness)
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
    draw.polygon(points_scaled(ridge), fill=ICE_DARK)
    inner = [(x, y + 2.2) for x, y in upper]
    draw.line(points_scaled(inner), fill=ICE_MID, width=width_scaled(5.0), joint="curve")
    draw.line(points_scaled(upper), fill=ICE_WHITE, width=width_scaled(1.35), joint="curve")
    draw.line(points_scaled(lower), fill=ICE_SHADOW, width=width_scaled(1.2), joint="curve")

    # Small fused shards break up the former flat rail without changing its footprint.
    shard_height = 2.0 + 7.0 * (1.0 - openness)
    for index in range(25):
        t = (index + 0.5) / 25
        x = BASE_A[0] + (BASE_B[0] - BASE_A[0]) * t
        y = base_y(x) - thickness + math.sin(index * 1.91) * 1.6
        half = 2.0 + (index * 5 % 4)
        height = shard_height * (0.55 + (index * 7 % 6) / 10)
        draw.polygon(points_scaled([
            (x - half, y + 2.0),
            (x + ((index % 3) - 1) * 0.7, y - height),
            (x + half, y + 2.0),
        ]), fill=ICE_CYAN if index % 3 else ICE_LIGHT)
        if index % 2 == 0:
            draw.line(points_scaled([(x, y - height + 1.0), (x - half * 0.35, y + 0.5)]),
                      fill=ICE_WHITE, width=width_scaled(0.7))


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
    left_shoulder = (x - half_width * 0.68, ground - height * 0.29)
    right_shoulder = (x + half_width * 0.64, ground - height * 0.25)
    # Two tiny edge chips make every crystal less like a perfect flat triangle while
    # preserving the same apex, base span and collision geometry.
    left_chip = (x - half_width * 0.48, ground - height * (0.52 + (index % 3) * 0.04))
    left_chip_in = (left_chip[0] + 2.5 + index % 2, left_chip[1] - 4.0)
    right_chip = (x + half_width * 0.44, ground - height * (0.48 + (index % 4) * 0.035))
    right_chip_in = (right_chip[0] - 2.2 - index % 3, right_chip[1] + 4.5)
    body = [left, left_shoulder, left_chip, left_chip_in, apex,
            right_chip_in, right_chip, right_shoulder, right]

    draw.polygon(points_scaled(body), fill=ICE_DARK)
    inset_left = (x - half_width * 0.74, ground + 1.0)
    inset_right = (x + half_width * 0.72, ground + 1.0)
    core = (x + lean * 0.30, ground - height * 0.06)
    upper_core = (x + lean * 0.62 - half_width * 0.05, ground - height * 0.70)
    draw.polygon(points_scaled([inset_left, left_shoulder, left_chip, left_chip_in,
                                apex, upper_core, core]), fill=ICE_MID)
    draw.polygon(points_scaled([core, upper_core, apex, right_chip_in,
                                right_chip, right_shoulder, inset_right]), fill=ICE_DEEP)
    draw.polygon(points_scaled([
        (x - half_width * 0.62, ground - height * 0.20),
        left_shoulder,
        left_chip,
        upper_core,
        core,
    ]), fill=ICE_CYAN)
    draw.polygon(points_scaled([
        upper_core,
        apex,
        right_chip_in,
        (x + half_width * 0.24, ground - height * 0.19),
        core,
    ]), fill=ICE_SHADOW)
    draw.polygon(points_scaled([
        (x - half_width * 0.28, ground - height * 0.08),
        (x + lean * 0.65, ground - height * 0.90),
        apex,
        core,
    ]), fill=ICE_LIGHT)

    # Milky frost bands and embedded snow grains are clipped by construction to the
    # wide root of the spike, so the silhouette and transparent exterior stay exact.
    for band in range(5, 0, -1):
        ratio = band / 5
        band_top = ground - height * (0.045 + ratio * 0.045)
        band_half = half_width * (0.70 - ratio * 0.06)
        colour = blend_rgb(ICE_MID, ICE_FROST, 0.30 + ratio * 0.12)
        draw.polygon(points_scaled([
            (x - band_half, ground + 0.5),
            (x - band_half * 0.78, band_top),
            (x + band_half * 0.72, band_top + 1.5),
            (x + band_half, ground + 0.5),
        ]), fill=colour)
    if height > 48:
        for grain in range(5):
            gx = x + (((index * 17 + grain * 11) % 37) - 18) * half_width / 28
            gy = ground - height * (0.035 + ((index * 13 + grain * 7) % 17) / 95)
            radius = 0.65 + ((index + grain) % 3) * 0.35
            draw.ellipse(points_scaled([(gx - radius, gy - radius), (gx + radius, gy + radius)]),
                         fill=ICE_WHITE)

    highlight_top = (x + lean * 0.78, ground - height * 0.84)
    highlight_bottom = (x - half_width * 0.12, ground - height * 0.18)
    draw.line(points_scaled([highlight_top, highlight_bottom]), fill=ICE_WHITE,
              width=width_scaled(1.35))
    draw.line(points_scaled([left, left_shoulder, left_chip]), fill=ICE_LIGHT,
              width=width_scaled(1.0), joint="curve")
    draw.line(points_scaled([right, right_shoulder, right_chip]), fill=ICE_CYAN,
              width=width_scaled(0.85), joint="curve")
    if height > 90:
        crack_y = ground - height * (0.42 + (index % 3) * 0.08)
        crack = [
            (x - half_width * 0.12, crack_y - 9.0),
            (x + half_width * 0.10, crack_y),
            (x - half_width * 0.02, crack_y + 14.0),
        ]
        draw.line(points_scaled(crack), fill=ICE_DARK,
                  width=width_scaled(2.0), joint="curve")
        draw.line(points_scaled(crack), fill=ICE_FROST,
                  width=width_scaled(0.75), joint="curve")
        branch = [crack[1], (x + half_width * 0.30, crack_y - 9.0 - index % 4)]
        draw.line(points_scaled(branch), fill=ICE_FROST, width=width_scaled(0.65))

    # A few trapped bubbles add scale and translucency without visual noise.
    if height > 130:
        bubble_count = 2 + index % 3
        for bubble in range(bubble_count):
            by_ratio = 0.22 + ((index * 19 + bubble * 23) % 43) / 100
            available = half_width * max(0.18, 1.0 - by_ratio)
            bx = x + (((index * 29 + bubble * 17) % 21) - 10) / 10 * available * 0.52
            by = ground - height * by_ratio
            radius = 1.15 + ((index + bubble * 2) % 3) * 0.55
            box = [(bx - radius, by - radius), (bx + radius, by + radius)]
            draw.ellipse(points_scaled(box), fill=ICE_SHADOW, outline=ICE_LIGHT,
                         width=width_scaled(0.65))


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
