#!/usr/bin/env python3
"""Prepare locked H3 endpoints for whirlwind recover and the sword run loop."""

from pathlib import Path

import av
from PIL import Image


CANVAS = (1344, 768)
GREEN = (0, 255, 0, 255)
ROOT_X = 672
FOOT_Y = 728
TARGET_VISIBLE_HEIGHT = 477


def alpha_crop(image: Image.Image) -> Image.Image:
    alpha = image.getchannel("A")
    bbox = alpha.point(lambda value: 255 if value > 20 else 0).getbbox()
    if not bbox:
        raise ValueError("empty source frame")
    return image.crop(bbox)


def place(image: Image.Image) -> Image.Image:
    subject = alpha_crop(image.convert("RGBA"))
    width = max(1, round(subject.width * TARGET_VISIBLE_HEIGHT / subject.height))
    subject = subject.resize((width, TARGET_VISIBLE_HEIGHT), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", CANVAS, GREEN)
    canvas.alpha_composite(subject, (round(ROOT_X - width / 2), FOOT_Y - TARGET_VISIBLE_HEIGHT))
    return canvas.convert("RGB")


def decode_frame(video: Path, index: int) -> Image.Image:
    container = av.open(str(video))
    for frame_index, frame in enumerate(container.decode(video=0)):
        if frame_index == index:
            return Image.fromarray(frame.to_ndarray(format="rgba"), "RGBA")
    raise ValueError(f"missing frame {index} in {video}")


def key_green(image: Image.Image) -> Image.Image:
    rgba = image.convert("RGBA")
    px = rgba.load()
    for y in range(rgba.height):
        for x in range(rgba.width):
            r, g, b, _ = px[x, y]
            if g > 90 and g - r > 42 and g - b > 42:
                px[x, y] = (0, 0, 0, 0)
    return rgba


def tag_wrist(image: Image.Image, center: tuple[int, int], radius: int,
              color: tuple[int, int, int]) -> None:
    """Recolor existing wrist pixels without expanding the character silhouette."""
    px = image.load()
    cx, cy = center
    for y in range(max(0, cy - radius), min(image.height, cy + radius + 1)):
        for x in range(max(0, cx - radius), min(image.width, cx + radius + 1)):
            if (x - cx) ** 2 + (y - cy) ** 2 > radius ** 2:
                continue
            _, _, _, alpha = px[x, y]
            if alpha > 20:
                px[x, y] = (*color, alpha)


def main() -> None:
    root = Path(__file__).resolve().parents[2]
    out = root / "tools/ai-gen/_scratch/player_melee_refinement_20260825"
    out.mkdir(parents=True, exist_ok=True)

    whirlwind = Image.open(root / "assets/player/whirlwind.png").convert("RGBA")
    f22 = whirlwind.crop((2 * 512, 4 * 516, 3 * 512, 5 * 516))
    idle = Image.open(root / "assets/player/idle.png").convert("RGBA")
    place(f22).save(out / "whirlwind_recover_first.png", quality=100)
    place(idle).save(out / "whirlwind_recover_last.png", quality=100)

    dash_video = root / "tools/ai-gen/_scratch/player_dash_thrust_20260824/player_dash_thrust_body_h3_s04_firstlast.mp4"
    candidates = []
    for frame_index in (13, 19, 26):
        candidate = place(key_green(decode_frame(dash_video, frame_index)))
        candidate.save(out / f"sword_run_single_candidate_f{frame_index}.png", quality=100)
        candidates.append(candidate)
    contact = Image.new("RGB", (CANVAS[0] * len(candidates), CANVAS[1]), (28, 31, 36))
    for index, candidate in enumerate(candidates):
        contact.paste(candidate, (index * CANVAS[0], 0))
    contact.save(out / "sword_run_single_candidates.png", quality=100)

    # f19 is the cleanest existing one-hand running silhouette: the forward hand
    # stays near the waist while the free arm is already separated for its swing.
    locked = candidates[1]
    locked.save(out / "sword_run_single_first.png", quality=100)
    locked.save(out / "sword_run_single_last.png", quality=100)

    # v3 uses f13 instead of f19: the screen-right/anatomical right arm is held
    # closer to the ribs with a clean diagonal forearm, leaving the left arm a
    # full rear swing lane. This is a stronger one-hand sword-running endpoint.
    right_hand_locked = candidates[0]
    right_hand_locked.save(out / "sword_run_right_hand_first.png", quality=100)
    right_hand_locked.save(out / "sword_run_right_hand_last.png", quality=100)

    # Corrected anatomy lock. In the project's right-facing side view the
    # screen-left/far arm is the anatomical RIGHT sword arm; the screen-right/
    # near arm is the anatomical LEFT free-swing arm. Tiny color tags stay
    # inside existing wrist alpha so H3 can preserve arm identity without
    # changing the silhouette; the rebuild stage neutralizes them to grayscale.
    running = Image.open(root / "assets/player/running.png").convert("RGBA")
    corrected = running.crop((0, 0, 512, 512))
    tag_wrist(corrected, (216, 197), 10, (25, 85, 235))   # right/far wrist
    tag_wrist(corrected, (354, 148), 10, (235, 55, 45))   # left/near wrist
    corrected_endpoint = place(corrected)
    corrected_endpoint.save(out / "sword_run_corrected_first.png", quality=100)
    corrected_endpoint.save(out / "sword_run_corrected_last.png", quality=100)
    print(out)


if __name__ == "__main__":
    main()
