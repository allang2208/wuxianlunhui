#!/usr/bin/env python3
"""Extract the approved tier-IV shotgun unit frames used as motion references."""

from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[5]
TASK = Path(__file__).resolve().parent
OUTPUT = TASK / "references"

ACTIONS = {
    "recon_walk": {
        "source": ROOT / "assets/companions/industrial_recon_rifleman/running.png",
        "cols": 7,
        "cell": (336, 160),
        "indices": [0, 8, 17, 25, 33],
    },
    "walk": {
        "source": ROOT / "assets/companions/hamster_special_forces/walking.png",
        "cols": 8,
        "cell": (512, 512),
        "indices": [0, 9, 18, 27],
    },
    "attack": {
        "source": ROOT / "assets/companions/hamster_special_forces/attacking.png",
        "cols": 8,
        "cell": (512, 512),
        "indices": [0, 8, 17, 25, 40],
    },
}


def frame_at(sheet: Image.Image, cols: int, cell: tuple[int, int], index: int) -> Image.Image:
    cell_w, cell_h = cell
    x = (index % cols) * cell_w
    y = (index // cols) * cell_h
    frame = sheet.crop((x, y, x + cell_w, y + cell_h))
    canvas = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
    canvas.alpha_composite(frame, ((512 - cell_w) // 2, (512 - cell_h) // 2))
    return canvas


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for action, spec in ACTIONS.items():
        sheet = Image.open(spec["source"]).convert("RGBA")
        frames = []
        for index in spec["indices"]:
            frame = frame_at(sheet, spec["cols"], spec["cell"], index)
            frame.save(OUTPUT / f"special-forces-{action}-f{index:02d}.png")
            frames.append((index, frame))

        contact = Image.new("RGBA", (len(frames) * 512, 560), (22, 22, 22, 255))
        draw = ImageDraw.Draw(contact)
        for column, (index, frame) in enumerate(frames):
            contact.alpha_composite(frame, (column * 512, 0))
            draw.text((column * 512 + 16, 522), f"0-based frame {index}", fill=(255, 255, 255, 255))
        contact.save(OUTPUT / f"special-forces-{action}-direction-contact.png")
        print(f"wrote {action}: {spec['indices']}")


if __name__ == "__main__":
    main()
