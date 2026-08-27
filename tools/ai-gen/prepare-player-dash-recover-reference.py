#!/usr/bin/env python3
"""Build locked H3 first/last frames for the dash-thrust recovery clip."""

from pathlib import Path

from PIL import Image


CANVAS_SIZE = (1344, 768)
GREEN = (0, 255, 0, 255)
RECOVER_FRAME = (5 * 512, 512, 6 * 512, 1024)  # dash_recover frame 13
TARGET_HEIGHT = 516
ROOT_X = 500
FEET_Y = 728


def alpha_crop(image: Image.Image, threshold: int = 24) -> Image.Image:
    alpha = image.getchannel("A")
    bbox = alpha.point(lambda value: 255 if value > threshold else 0).getbbox()
    if bbox is None:
        raise ValueError("Image has no visible alpha pixels")
    return image.crop(bbox)


def main() -> None:
    root = Path(__file__).resolve().parents[2]
    out_dir = root / "tools" / "ai-gen" / "_scratch" / "player_dash_thrust_20260824"
    out_dir.mkdir(parents=True, exist_ok=True)

    thrust = Image.open(out_dir / "last_frame_body_only.png").convert("RGB")
    thrust.save(out_dir / "recover_first_frame.png", quality=100)

    recover_sheet = Image.open(root / "assets" / "player" / "dash_recover.png").convert("RGBA")
    idle = alpha_crop(recover_sheet.crop(RECOVER_FRAME))
    idle_width = round(idle.width * TARGET_HEIGHT / idle.height)
    idle = idle.resize((idle_width, TARGET_HEIGHT), Image.Resampling.LANCZOS)
    idle_x = round(ROOT_X - idle.width / 2)
    idle_y = FEET_Y - idle.height

    last = Image.new("RGBA", CANVAS_SIZE, GREEN)
    last.alpha_composite(idle, (idle_x, idle_y))
    last.convert("RGB").save(out_dir / "recover_last_frame.png", quality=100)

    print(out_dir / "recover_first_frame.png")
    print(out_dir / "recover_last_frame.png")
    print(f"idle={idle.size} at ({idle_x}, {idle_y})")


if __name__ == "__main__":
    main()
