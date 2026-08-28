#!/usr/bin/env python3
"""Build an equal-timing GIF that mirrors the sprite's runtime playback."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parent
ACTION_SECTIONS = {
    "moving": "movingSprite",
    "moving_attacking": "h3MovingAttackGeneration",
    "standing_attacking": "h3StandingAttackGeneration",
    "dying": "h3DeathGeneration",
}


def checker(frame: np.ndarray) -> Image.Image:
    yy, xx = np.indices(frame.shape[:2])
    shade = np.where(((xx // 24 + yy // 24) % 2)[..., None], 58, 82)
    background = np.repeat(shade, 3, axis=2).astype(np.float32)
    alpha = frame[..., 3:4].astype(np.float32) / 255.0
    rgb = frame[..., :3].astype(np.float32) * alpha + background * (1.0 - alpha)
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--action", choices=tuple(ACTION_SECTIONS), default="moving_attacking")
    args = parser.parse_args()
    action = args.action
    task = json.loads((ROOT / "task-index.json").read_text(encoding="utf-8"))
    section = ACTION_SECTIONS[action]
    sprite = task[section] if action == "moving" else task[section]["sprite"]
    frame_width = int(sprite["frameWidth"])
    frame_height = int(sprite["frameHeight"])
    frame_count = int(sprite["frameCount"])
    frame_rate = float(sprite["frameRate"])
    cols = 8

    sheet = Image.open(ROOT / sprite["sheet"]).convert("RGBA")
    rows = math.ceil(frame_count / cols)
    expected_size = (cols * frame_width, rows * frame_height)
    if sheet.size != expected_size:
        raise ValueError(f"unexpected sheet size {sheet.size}, expected {expected_size}")

    preview_width = 384
    preview_height = round(frame_height * preview_width / frame_width)
    frames: list[Image.Image] = []
    for index in range(frame_count):
        x = (index % cols) * frame_width
        y = (index // cols) * frame_height
        frame = np.asarray(sheet.crop((x, y, x + frame_width, y + frame_height)))
        frames.append(
            checker(frame).resize(
                (preview_width, preview_height), Image.Resampling.LANCZOS
            )
        )

    # GIF stores frame delays in 10 ms units. Forty milliseconds gives a stable
    # 25 FPS preview and is the closest representable cadence to the runtime 24 FPS.
    frame_ms = round(round(1000.0 / frame_rate) / 10.0) * 10
    output = (
        ROOT
        / "previews"
        / "interpolated"
        / f"hamster-scout-rifle-skirmisher-{action}-runtime.gif"
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    save_options = {
        "save_all": True,
        "append_images": frames[1:],
        "duration": [frame_ms] * frame_count,
        "disposal": 2,
        "optimize": False,
    }
    if action != "dying":
        save_options["loop"] = 0
    frames[0].save(output, **save_options)

    sprite["preview"] = str(
        output.relative_to(ROOT)
    ).replace("\\", "/")
    sprite["previewTiming"] = {
        "kind": "equal_frame_runtime_preview",
        "runtimeFrameRate": frame_rate,
        "gifFrameDurationMs": frame_ms,
        "firstFrameHoldMs": 0,
        "lastFrameHoldMs": 0,
        "loop": action != "dying",
    }
    (ROOT / "task-index.json").write_text(
        json.dumps(task, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(
        json.dumps(
            {
                "output": str(output),
                "frameCount": frame_count,
                "runtimeFrameRate": frame_rate,
                "gifFrameDurationMs": frame_ms,
                "loopDurationMs": frame_count * frame_ms,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
