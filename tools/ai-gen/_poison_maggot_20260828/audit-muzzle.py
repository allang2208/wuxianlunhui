#!/usr/bin/env python3
"""Overlay configured poison-maggot muzzle anchors on formal release frames."""

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent
SHEET = ROOT.parents[3] / "assets" / "enemies" / "poison_maggot" / "spitting.png"
OUT = ROOT / "previews" / "final" / "poison-maggot-muzzle-static-audit.png"
FRAME_W = 640
FRAME_H = 512
COLS = 8
PIXEL_SCALE = 300 / 512
FOOT_OFFSET_Y = 90
FRAMES = list(range(14, 27))
MOUTH_ANCHORS = {
    14: (546, 240), 15: (548, 239), 16: (548, 238), 17: (551, 237),
    18: (552, 236), 19: (554, 234), 20: (554, 233), 21: (555, 232),
    22: (555, 231), 23: (556, 232), 24: (556, 232), 25: (553, 235),
    26: (552, 238),
}


def configured_source_point(forward: float, up_y: float, dx: float = 0, dy: float = 0):
    world_x = forward + dx
    world_y = -(up_y - dy)
    local_y = world_y + FOOT_OFFSET_Y
    return (
        FRAME_W / 2 + world_x / PIXEL_SCALE,
        FRAME_H / 2 + local_y / PIXEL_SCALE,
    )


def main() -> None:
    sheet = Image.open(SHEET).convert("RGBA")
    right = configured_source_point(150, 94, -7, -5)
    left_equivalent = configured_source_point(150, 94)
    panels = []
    print(f"right configured source point={right}")
    print(f"left configured source point after unflip={left_equivalent}")
    for frame_index in FRAMES:
        col = frame_index % COLS
        row = frame_index // COLS
        frame = sheet.crop((col * FRAME_W, row * FRAME_H, (col + 1) * FRAME_W, (row + 1) * FRAME_H))
        arr = np.asarray(frame)
        ys, xs = np.where(arr[..., 3] > 16)
        bbox = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
        print(f"frame={frame_index} alpha_bbox={bbox}")
        checker = Image.new("RGB", (FRAME_W, FRAME_H), "#484848")
        tile = 20
        draw_bg = ImageDraw.Draw(checker)
        for y in range(0, FRAME_H, tile):
            for x in range(0, FRAME_W, tile):
                if ((x // tile) + (y // tile)) % 2:
                    draw_bg.rectangle((x, y, x + tile - 1, y + tile - 1), fill="#686868")
        checker.paste(frame.convert("RGB"), (0, 0), frame.getchannel("A"))
        draw = ImageDraw.Draw(checker)
        for point, color, label in (
            (right, "#ff3030", "R config"),
            (left_equivalent, "#ffd020", "L config (unflipped)"),
            (MOUTH_ANCHORS[frame_index], "#28e7ff", "tracked mouth"),
        ):
            x, y = point
            draw.ellipse((x - 8, y - 8, x + 8, y + 8), outline=color, width=4)
            draw.line((x - 13, y, x + 13, y), fill=color, width=2)
            draw.line((x, y - 13, x, y + 13), fill=color, width=2)
            draw.text((x - 74, y - 30), label, fill=color)
        draw.rectangle(bbox, outline="#4dff74", width=2)
        draw.text((12, 12), f"formal frame {frame_index}", fill="white")
        panels.append(checker.resize((320, 256), Image.Resampling.LANCZOS))

    contact = Image.new("RGB", (1280, 1024), "#20242a")
    for index, panel in enumerate(panels):
        contact.paste(panel, ((index % 4) * 320, (index // 4) * 256))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    contact.save(OUT)
    print(OUT)


if __name__ == "__main__":
    main()
