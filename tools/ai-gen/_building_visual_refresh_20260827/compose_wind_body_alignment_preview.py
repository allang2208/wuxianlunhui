#!/usr/bin/env python3
"""Compare rotor offsets against the newly accepted wind-station body."""

from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[3]
BODY = ROOT / "assets/terrain/wind_power_plant_body.png"
ROTOR = ROOT / "assets/terrain/wind_power_plant_rotor.png"
OUTPUT = Path(__file__).resolve().parent / "wind_power_plant_body_alignment_preview.png"

BODY_SIZE = (512, 477)
ROTOR_SIZE = (277, 277)
FRAME_SIZE = 512
OFFSETS = ((8, -146, "old offset"), (9, -158, "mapped hub"), (9, -166, "higher"))


def main() -> None:
    body = Image.open(BODY).convert("RGBA").resize(BODY_SIZE, Image.Resampling.LANCZOS)
    sheet = Image.open(ROTOR).convert("RGBA")
    rotor = sheet.crop((0, 0, FRAME_SIZE, FRAME_SIZE)).resize(
        ROTOR_SIZE, Image.Resampling.LANCZOS
    )
    panel_size = (620, 620)
    contact = Image.new("RGBA", (panel_size[0] * len(OFFSETS), panel_size[1]), (24, 26, 30, 255))
    draw = ImageDraw.Draw(contact)
    for index, (offset_x, offset_y, label) in enumerate(OFFSETS):
        origin_x = index * panel_size[0]
        center = (origin_x + panel_size[0] // 2, 348)
        contact.alpha_composite(body, (center[0] - body.width // 2, center[1] - body.height // 2))
        rotor_center = (center[0] + offset_x, center[1] + offset_y)
        contact.alpha_composite(rotor, (rotor_center[0] - rotor.width // 2, rotor_center[1] - rotor.height // 2))
        draw.text((origin_x + 18, 18), f"{label}: ({offset_x}, {offset_y})", fill=(238, 240, 244, 255))
    contact.save(OUTPUT, optimize=True)
    print(f"wrote {OUTPUT}")


if __name__ == "__main__":
    main()
