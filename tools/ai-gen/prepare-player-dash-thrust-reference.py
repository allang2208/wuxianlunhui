#!/usr/bin/env python3
"""Build the locked H3 first frame for the player's dash-thrust candidate."""

from pathlib import Path

import numpy as np
from PIL import Image


CANVAS_SIZE = (1344, 768)
GREEN = (0, 255, 0, 255)
PLAYER_CELL = (0, 0, 512, 516)
PLAYER_HEIGHT = 553
PLAYER_X = 350
PLAYER_FEET_Y = 696
SWORD_LENGTH = 450
SWORD_GRIP_TARGET = (737, 235)
SWORD_GRIP_X_RATIO = 0.18


def alpha_crop(image: Image.Image, threshold: int = 32) -> Image.Image:
    alpha = image.getchannel("A")
    effective_alpha = alpha.point(lambda value: 255 if value > threshold else 0)
    bbox = effective_alpha.getbbox()
    if bbox is None:
        raise ValueError("Image has no visible alpha pixels")
    return image.crop(bbox)


def main() -> None:
    root = Path(__file__).resolve().parents[2]
    out_dir = root / "tools" / "ai-gen" / "_scratch" / "player_dash_thrust_20260824"
    out_dir.mkdir(parents=True, exist_ok=True)

    player_sheet = Image.open(root / "assets" / "player" / "dash_attack.png").convert("RGBA")
    player = alpha_crop(player_sheet.crop(PLAYER_CELL))
    player_width = round(player.width * PLAYER_HEIGHT / player.height)
    player = player.resize((player_width, PLAYER_HEIGHT), Image.Resampling.LANCZOS)
    player_y = PLAYER_FEET_Y - PLAYER_HEIGHT

    sword = Image.open(root / "assets" / "weapons" / "1-rusty_sword_euip.png").convert("RGBA")
    sword = alpha_crop(sword)
    sword_width = round(sword.width * SWORD_LENGTH / sword.height)
    sword = sword.resize((sword_width, SWORD_LENGTH), Image.Resampling.LANCZOS)
    sword = sword.rotate(-90, expand=True, resample=Image.Resampling.BICUBIC)
    sword_x = round(SWORD_GRIP_TARGET[0] - sword.width * SWORD_GRIP_X_RATIO)
    sword_y = round(SWORD_GRIP_TARGET[1] - sword.height / 2)

    body_only = Image.new("RGBA", CANVAS_SIZE, GREEN)
    body_only.alpha_composite(player, (PLAYER_X, player_y))
    body_only.convert("RGB").save(out_dir / "first_frame_body_only.png", quality=100)

    first_frame = Image.new("RGBA", CANVAS_SIZE, GREEN)
    first_frame.alpha_composite(sword, (sword_x, sword_y))
    first_frame.alpha_composite(player, (PLAYER_X, player_y))
    first_frame.convert("RGB").save(out_dir / "first_frame.png", quality=100)

    accepted_last_path = out_dir / "last_frame_s01.png"
    if accepted_last_path.exists():
        accepted = np.asarray(Image.open(accepted_last_path).convert("RGB")).copy()
        r = accepted[:, :, 0].astype(np.int16)
        g = accepted[:, :, 1].astype(np.int16)
        b = accepted[:, :, 2].astype(np.int16)
        foreground = ~((g > 90) & (g - r > 46) & (g - b > 46))
        accepted[~foreground] = GREEN[:3]

        # In the accepted terminal lunge the clasped hands end at x~825 and the
        # guard/blade are entirely to their right. Remove that unobstructed half
        # of the sword, then neutralize rusty pixels beneath the overlapped hands
        # so H3 reads them as monochrome hand/forearm structure, not a weapon.
        yy, xx = np.indices(foreground.shape)
        remove = (xx > 825) & (yy >= 220) & (yy <= 420)
        accepted[remove] = GREEN[:3]
        overlap = foreground & (xx >= 620) & (xx <= 825) & (yy >= 245) & (yy <= 365)
        rusty = overlap & (r > b + 7) & (r > g + 3)
        gray = np.clip((r + g + b) / 3, 0, 255).astype(np.uint8)
        for channel in range(3):
            accepted[:, :, channel][rusty] = gray[rusty]
        Image.fromarray(accepted, "RGB").save(out_dir / "last_frame_body_only.png", quality=100)

    print(f"player={player.size} at ({PLAYER_X}, {player_y})")
    print(f"sword={sword.size} at ({sword_x}, {sword_y})")
    print(out_dir / "first_frame.png")
    if accepted_last_path.exists():
        print(out_dir / "last_frame_body_only.png")


if __name__ == "__main__":
    main()
