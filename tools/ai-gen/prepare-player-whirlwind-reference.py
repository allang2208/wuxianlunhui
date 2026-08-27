#!/usr/bin/env python3
"""Build the locked H3 first/last frame for the player's whirlwind animation."""

from pathlib import Path

from PIL import Image


CANVAS_SIZE = (1344, 768)
GREEN = (0, 255, 0, 255)
SOURCE_CELL = (1536, 0, 2048, 512)
TARGET_BODY_HEIGHT = 500
TARGET_CENTER_X = 672
TARGET_FEET_Y = 704


def alpha_bbox(image: Image.Image, threshold: int = 12) -> tuple[int, int, int, int]:
    alpha = image.getchannel("A")
    effective = alpha.point(lambda value: 255 if value > threshold else 0)
    bbox = effective.getbbox()
    if bbox is None:
        raise ValueError("Source frame has no visible alpha pixels")
    return bbox


def main() -> None:
    root = Path(__file__).resolve().parents[2]
    out_dir = root / "tools" / "ai-gen" / "_scratch" / "player_whirlwind_20260824"
    out_dir.mkdir(parents=True, exist_ok=True)

    # attack_sword_2 f03 is an upright, planted frontal stance with both hands
    # gathered above the shoulders. The first attempt used a side-on recover
    # stride and H3 inherited it as running; this pose teaches a fixed root.
    sheet = Image.open(root / "assets" / "player" / "attack_sword_2.png").convert("RGBA")
    source = sheet.crop(SOURCE_CELL)
    source = source.crop(alpha_bbox(source))
    target_width = round(source.width * TARGET_BODY_HEIGHT / source.height)
    source = source.resize((target_width, TARGET_BODY_HEIGHT), Image.Resampling.LANCZOS)

    x = round(TARGET_CENTER_X - source.width / 2)
    y = TARGET_FEET_Y - source.height
    frame = Image.new("RGBA", CANVAS_SIZE, GREEN)
    frame.alpha_composite(source, (x, y))

    output = out_dir / "first_last_frame.png"
    frame.convert("RGB").save(output, quality=100)
    print(f"source={source.size} at ({x}, {y})")
    print(output)


if __name__ == "__main__":
    main()
