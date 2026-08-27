"""Pack directional energy-vein renders into runtime spritesheets and previews."""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


REPO = Path(__file__).resolve().parents[2]
OUT = REPO / "tools" / "ai-gen" / "_energy_vein_directional_20260826"
LIVE_OUT = OUT / "live_frames"
DEPLETED_OUT = OUT / "depleted_frames"
LIVE_SHEET = REPO / "assets" / "terrain" / "energy_node_directional_tiles.png"
DEPLETED_SHEET = REPO / "assets" / "terrain" / "energy_node_directional_depleted_tiles.png"
PREVIEW = OUT / "energy_vein_directional_preview.png"

FRAME_W = 128
FRAME_H = 64
BITS = ((1, 1, 0), (2, -1, 0), (4, 0, 1), (8, 0, -1))


def source_path(root: Path, mask: int) -> Path:
    return root / f"energy_vein_mask_{mask:02d}.png"


def build_sheet(root: Path, output: Path) -> Image.Image:
    sheet = Image.new("RGBA", (FRAME_W * 16, FRAME_H), (0, 0, 0, 0))
    for mask in range(16):
        frame = Image.open(source_path(root, mask)).convert("RGBA")
        frame = frame.resize((FRAME_W, FRAME_H), Image.Resampling.LANCZOS)
        sheet.alpha_composite(frame, (mask * FRAME_W, 0))
    output.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(output, optimize=True)
    return sheet


def frame_from_sheet(sheet: Image.Image, mask: int) -> Image.Image:
    return sheet.crop((mask * FRAME_W, 0, (mask + 1) * FRAME_W, FRAME_H))


def connection_mask(cell: tuple[int, int], cells: set[tuple[int, int]]) -> int:
    i, j = cell
    mask = 0
    for bit, di, dj in BITS:
        if (i + di, j + dj) in cells:
            mask |= bit
    return mask


def cluster_preview(sheet: Image.Image, cells: set[tuple[int, int]], size=(760, 430)) -> Image.Image:
    layer = Image.new("RGBA", size, (0, 0, 0, 0))
    origin_x, origin_y = size[0] // 2, 70
    for i, j in sorted(cells, key=lambda cell: (cell[0] + cell[1], cell[0])):
        x = origin_x + i * 64 - j * 64 - FRAME_W // 2
        y = origin_y + i * 32 + j * 32
        layer.alpha_composite(frame_from_sheet(sheet, connection_mask((i, j), cells)), (x, y))
    return layer


def main() -> None:
    live_sheet = build_sheet(LIVE_OUT, LIVE_SHEET)
    depleted_sheet = build_sheet(DEPLETED_OUT, DEPLETED_SHEET)
    canvas = Image.new("RGBA", (1600, 1300), (38, 36, 33, 255))
    draw = ImageDraw.Draw(canvas)
    font = ImageFont.load_default()
    draw.text((45, 28), "16-frame directional energy vein autotile", fill=(232, 225, 210, 255), font=font)

    for depleted, sheet in ((False, live_sheet), (True, depleted_sheet)):
        x0 = 45 if not depleted else 815
        draw.text((x0, 58), "LIVE" if not depleted else "DEPLETED",
                  fill=(142, 220, 222, 255) if not depleted else (188, 194, 190, 255), font=font)
        for mask in range(16):
            row, col = divmod(mask, 4)
            frame = frame_from_sheet(sheet, mask).resize((256, 128), Image.Resampling.NEAREST)
            x = x0 + col * 180
            y = 86 + row * 150
            canvas.alpha_composite(frame, (x, y))
            draw.text((x, y + 126), f"mask {mask:02d}", fill=(220, 216, 205, 255), font=font)

    cells = {
        (0, 0), (1, 0), (2, 0), (3, 0),
        (2, 1), (2, 2), (1, 2), (3, 2), (2, 3),
    }
    draw.text((45, 716), "Example cluster assembled from per-cell four-neighbor masks",
              fill=(232, 225, 210, 255), font=font)
    canvas.alpha_composite(cluster_preview(live_sheet, cells), (20, 750))
    canvas.alpha_composite(cluster_preview(depleted_sheet, cells), (800, 750))
    canvas.convert("RGB").save(PREVIEW, quality=94)

    metadata = {
        "version": 1,
        "frameWidth": FRAME_W,
        "frameHeight": FRAME_H,
        "frameCount": 16,
        "bitOrder": {"iPositive": 1, "iNegative": 2, "jPositive": 4, "jNegative": 8},
        "liveSheet": str(LIVE_SHEET.relative_to(REPO)).replace("\\", "/"),
        "depletedSheet": str(DEPLETED_SHEET.relative_to(REPO)).replace("\\", "/"),
        "preview": str(PREVIEW.relative_to(REPO)).replace("\\", "/"),
    }
    (OUT / "runtime-metadata.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(metadata, ensure_ascii=False))


if __name__ == "__main__":
    main()
