"""Static pixel check for the 16-frame directional energy-vein spritesheets."""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image


REPO = Path(__file__).resolve().parents[2]
SHEETS = (
    ("live", REPO / "assets" / "terrain" / "energy_node_directional_tiles.png"),
    ("depleted", REPO / "assets" / "terrain" / "energy_node_directional_depleted_tiles.png"),
)
FRAME_W = 128
FRAME_H = 64

# Expected elevated seam-cap centers. Opposite points differ by the exact
# runtime neighbor translations: (64,32) for i and (-64,32) for j.
ENDPOINTS = {
    1: (96, 48),   # +i, neighbor offset (+64, +32)
    2: (32, 16),   # -i, neighbor offset (-64, -32)
    4: (32, 48),   # +j, neighbor offset (-64, +32)
    8: (96, 16),   # -j, neighbor offset (+64, -32)
}


def is_vein_pixel(pixel: tuple[int, int, int, int], state: str) -> bool:
    red, green, blue, alpha = pixel
    if alpha <= 32:
        return False
    if state == "live":
        return green > 70 and blue > 70 and blue - red > 25
    # Depleted seam material is deliberately neutral gray; require an opaque,
    # tightly neutral midtone instead of the live cyan color separation.
    average = (red + green + blue) / 3
    return 60 <= average <= 160 and max(red, green, blue) - min(red, green, blue) <= 22


def nearest_vein_distance(frame: Image.Image, state: str,
                          endpoint: tuple[int, int]) -> tuple[float, tuple[int, int]]:
    ex, ey = endpoint
    best = math.inf
    best_point = (-1, -1)
    pixels = frame.load()
    for y in range(FRAME_H):
        for x in range(FRAME_W):
            if is_vein_pixel(pixels[x, y], state):
                distance = math.hypot(x - ex, y - ey)
                if distance < best:
                    best = distance
                    best_point = (x, y)
    return best, best_point


def main() -> None:
    failed = False
    for state, path in SHEETS:
        sheet = Image.open(path).convert("RGBA")
        if sheet.size != (FRAME_W * 16, FRAME_H):
            raise SystemExit(f"{state}: invalid sheet size {sheet.size}")
        distances = []
        for mask in range(16):
            frame = sheet.crop((mask * FRAME_W, 0, (mask + 1) * FRAME_W, FRAME_H))
            for bit, endpoint in ENDPOINTS.items():
                if not mask & bit:
                    continue
                distance, nearest = nearest_vein_distance(frame, state, endpoint)
                distances.append((distance, mask, bit, nearest))
                if distance > 3.0:
                    failed = True
        worst = sorted(distances, reverse=True)[:8]
        print(f"{state}: sheet={sheet.size}, max_endpoint_gap={max(x[0] for x in distances):.2f}px")
        print(f"{state}: worst={worst}")
    if failed:
        raise SystemExit("Directional seam check failed: endpoint gap exceeds 3px")
    print("Directional seam check passed")


if __name__ == "__main__":
    main()
