from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

from PIL import Image


FRAME = 512
FOOT_Y = 458


def alpha_crop(image: Image.Image) -> Image.Image:
    rgba = image.convert("RGBA")
    bbox = rgba.getchannel("A").getbbox()
    if not bbox:
        raise ValueError("image has no visible pixels")
    return rgba.crop(bbox)


def fit_subject(image: Image.Image, max_width: int, max_height: int) -> Image.Image:
    subject = alpha_crop(image)
    scale = min(max_width / subject.width, max_height / subject.height)
    size = (
        max(1, round(subject.width * scale)),
        max(1, round(subject.height * scale)),
    )
    return subject.resize(size, Image.Resampling.LANCZOS)


def render_frame(
    subject: Image.Image,
    *,
    angle: float = 0.0,
    scale: float = 1.0,
    offset_x: int = 0,
    offset_y: int = 0,
    foot_y: int = FOOT_Y,
) -> Image.Image:
    width = max(1, round(subject.width * scale))
    height = max(1, round(subject.height * scale))
    transformed = subject.resize((width, height), Image.Resampling.LANCZOS)
    if abs(angle) > 0.001:
        transformed = transformed.rotate(
            angle,
            resample=Image.Resampling.BICUBIC,
            expand=True,
        )
    frame = Image.new("RGBA", (FRAME, FRAME), (0, 0, 0, 0))
    x = round((FRAME - transformed.width) / 2 + offset_x)
    y = round(foot_y - transformed.height + offset_y)
    frame.alpha_composite(transformed, (x, y))
    return frame


def build_sheet(frames: list[Image.Image], columns: int = 8) -> Image.Image:
    rows = math.ceil(len(frames) / columns)
    sheet = Image.new("RGBA", (columns * FRAME, rows * FRAME), (0, 0, 0, 0))
    for index, frame in enumerate(frames):
        sheet.alpha_composite(frame, ((index % columns) * FRAME, (index // columns) * FRAME))
    return sheet


def save_sheet(frames: list[Image.Image], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    build_sheet(frames).save(path)


def build_icon(subject: Image.Image, path: Path) -> None:
    cropped = alpha_crop(subject)
    # Upper-body crop keeps hamster face, SMG and launcher readable at UI size.
    upper = cropped.crop((0, 0, cropped.width, min(cropped.height, round(cropped.height * 0.78))))
    scale = min(456 / upper.width, 456 / upper.height)
    upper = upper.resize(
        (max(1, round(upper.width * scale)), max(1, round(upper.height * scale))),
        Image.Resampling.LANCZOS,
    )
    icon = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
    icon.alpha_composite(upper, ((512 - upper.width) // 2, (512 - upper.height) // 2))
    path.parent.mkdir(parents=True, exist_ok=True)
    icon.save(path)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mother", type=Path, required=True)
    parser.add_argument("--rocket", type=Path, required=True)
    parser.add_argument("--out-dir", type=Path, required=True)
    parser.add_argument("--icon", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()

    mother_raw = Image.open(args.mother).convert("RGBA")
    rocket_raw = Image.open(args.rocket).convert("RGBA")
    mother = fit_subject(mother_raw, max_width=360, max_height=410)
    rocket = fit_subject(rocket_raw, max_width=448, max_height=410)

    idle = [
        render_frame(mother, angle=0.0, scale=1.000, offset_y=0),
        render_frame(mother, angle=0.4, scale=1.006, offset_y=-2),
        render_frame(mother, angle=0.0, scale=1.010, offset_y=-3),
        render_frame(mother, angle=-0.4, scale=1.006, offset_y=-2),
    ]
    running = [
        render_frame(mother, angle=1.5, scale=0.995, offset_x=-6, offset_y=0),
        render_frame(mother, angle=0.5, scale=1.010, offset_x=-2, offset_y=-8),
        render_frame(mother, angle=-1.2, scale=1.000, offset_x=4, offset_y=-3),
        render_frame(mother, angle=-1.6, scale=0.995, offset_x=7, offset_y=0),
        render_frame(mother, angle=-0.4, scale=1.010, offset_x=2, offset_y=-8),
        render_frame(mother, angle=1.1, scale=1.000, offset_x=-4, offset_y=-3),
    ]
    attacking = [
        render_frame(mother, angle=0.0, offset_x=0),
        render_frame(mother, angle=0.8, offset_x=-3, offset_y=-1),
        render_frame(mother, angle=1.6, scale=0.995, offset_x=-8, offset_y=1),
        render_frame(mother, angle=0.0, offset_x=0),
    ]
    # One-shot launcher contract: SMG idle/back-mounted tube -> shoulder fire ->
    # recoil/discard beat -> return to the SMG pose with a regenerated back tube.
    # The runtime spawns the discarded empty tube visual on the fourth source beat.
    rocket_attack = [
        render_frame(mother, angle=0.0, offset_x=0),
        render_frame(rocket, angle=0.0, offset_x=0),
        render_frame(rocket, angle=2.0, scale=0.995, offset_x=-12, offset_y=2),
        render_frame(rocket, angle=0.8, offset_x=-4, offset_y=1),
        render_frame(mother, angle=0.0, offset_x=0),
    ]
    dying = [
        render_frame(mother, angle=0, offset_x=0, foot_y=458),
        render_frame(mother, angle=-10, offset_x=12, foot_y=462),
        render_frame(mother, angle=-25, scale=0.98, offset_x=22, foot_y=470),
        render_frame(mother, angle=-45, scale=0.96, offset_x=28, foot_y=480),
        render_frame(mother, angle=-68, scale=0.94, offset_x=30, foot_y=488),
        render_frame(mother, angle=-86, scale=0.92, offset_x=24, foot_y=492),
    ]

    source_dir = args.out_dir
    save_sheet(idle, source_dir / "idle.png")
    save_sheet(running, source_dir / "running.png")
    save_sheet(attacking, source_dir / "attacking.png")
    save_sheet(rocket_attack, source_dir / "rocket_attacking.png")
    save_sheet(dying, source_dir / "dying.png")
    build_icon(mother_raw, args.icon)

    report = {
        "frameSize": [FRAME, FRAME],
        "sourceFootY": FOOT_Y,
        "sourceFrames": {
            "idle": len(idle),
            "running": len(running),
            "attacking": len(attacking),
            "rocket_attacking": len(rocket_attack),
            "dying": len(dying),
        },
        "rocketAction": {
            "launchSourceIndex": 2,
            "discardSourceIndex": 3,
            "finalPose": "SMG idle with regenerated launcher on back",
        },
        "method": "deterministic affine key poses derived from two ImageGen identity frames",
        "mother": str(args.mother),
        "rocketPose": str(args.rocket),
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
