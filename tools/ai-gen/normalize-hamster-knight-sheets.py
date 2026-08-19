"""Prepare the hamster knight's 4x8 action sheets for World-122.

The supplied sheets may have fewer non-transparent source frames than their
intended gameplay timelines. This tool:
  - scans real alpha-bearing frames instead of trusting trailing grid cells;
  - derives one shared visual baseline from stable running frames;
  - makes every state-enter frame meet that baseline, preventing size pops;
  - scales the dying sheet by visible alpha coverage, so its broader source
    silhouette does not look enlarged beside the standing actions;
  - locks standing/running/action feet to the shared ground line while keeping
    the intentional downward travel of the dying animation;
  - resamples valid source frames into the requested timeline lengths.

Usage:
  python tools/ai-gen/normalize-hamster-knight-sheets.py \
    --source-dir "E:\...\仓鼠骑士" \
    --output-dir assets/companions/hamster_knight
"""

from __future__ import annotations

import argparse
from pathlib import Path
from statistics import median

from PIL import Image


FRAME_W = 512
FRAME_H = 512
COLS = 8
ROWS = 4
ALPHA_THRESHOLD = 10

SHEETS = (
    # output name, supplied source name, requested gameplay frame count, scale mode
    ("idle.png", "idle.png", 11, "idle"),
    ("running.png", "running.png", 12, "running"),
    ("attacking.png", "attacking.png", 31, "action"),
    ("dying.png", "dying.png", 14, "dying"),
    ("charging.png", "charging.png", 30, "action"),
)


def alpha_bounds(frame: Image.Image) -> tuple[int, int, int, int] | None:
    bbox = frame.getchannel("A").point(
        lambda value: 255 if value > ALPHA_THRESHOLD else 0
    ).getbbox()
    return bbox


def alpha_area(frame: Image.Image) -> int:
    alpha = frame.getchannel("A")
    return sum(1 for value in alpha.getdata() if value > ALPHA_THRESHOLD)


def read_frames(path: Path) -> list[tuple[int, Image.Image, tuple[int, int, int, int]]]:
    image = Image.open(path).convert("RGBA")
    if image.width != FRAME_W * COLS or image.height != FRAME_H * ROWS:
        raise ValueError(
            f"{path}: expected {FRAME_W * COLS}x{FRAME_H * ROWS}, "
            f"got {image.width}x{image.height}"
        )

    frames = []
    for index in range(COLS * ROWS):
        x = (index % COLS) * FRAME_W
        y = (index // COLS) * FRAME_H
        frame = image.crop((x, y, x + FRAME_W, y + FRAME_H))
        bounds = alpha_bounds(frame)
        if bounds:
            frames.append((index, frame, bounds))
    if not frames:
        raise ValueError(f"{path}: no alpha-bearing frames")
    return frames


def stable_running_baseline(
    frames: list[tuple[int, Image.Image, tuple[int, int, int, int]]],
) -> tuple[float, float, float]:
    heights = [bounds[3] - bounds[1] for _, _, bounds in frames]
    raw_median = median(heights)
    stable = [
        bounds
        for _, _, bounds in frames
        if (bounds[3] - bounds[1]) <= raw_median * 1.25
    ]
    if not stable:
        stable = [bounds for _, _, bounds in frames]
    return (
        float(median([bounds[3] - bounds[1] for bounds in stable])),
        float(median([bounds[3] for bounds in stable])),
        float(median([alpha_area(frame) for _, frame, bounds in frames if bounds in stable])),
    )


def source_scale(
    mode: str,
    frames: list[tuple[int, Image.Image, tuple[int, int, int, int]]],
    target_height: float,
    target_area: float,
) -> tuple[float, float]:
    # State changes always start at frame 0.  Matching that frame to the
    # common running baseline eliminates the visibly different scale at
    # idle→walk / idle→attack / idle→charge / hit→dying transitions.  A
    # median over a combat sheet is incorrect here: a sword held horizontally
    # has a much smaller alpha bbox than the same knight at the entry pose.
    entry_bounds = frames[0][2]
    entry_frame = frames[0][1]
    entry_height = entry_bounds[3] - entry_bounds[1]
    if mode == "dying":
        # The death source has a broader, denser silhouette than every
        # standing action.  Height-only matching leaves it visibly oversized;
        # alpha area scales quadratically, so take its square-root ratio.
        entry_area = max(1, alpha_area(entry_frame))
        return (target_area / entry_area) ** 0.5, float(entry_bounds[3])
    return target_height / entry_height, float(entry_bounds[3])


def temporal_source_index(target_index: int, target_count: int, source_count: int) -> int:
    if target_count <= 1 or source_count <= 1:
        return 0
    return round(target_index * (source_count - 1) / (target_count - 1))


def compose_frame(
    frame: Image.Image,
    bounds: tuple[int, int, int, int],
    scale: float,
    source_base_bottom: float,
    target_base_bottom: float,
    preserve_vertical_motion: bool,
) -> Image.Image:
    left, top, right, bottom = bounds
    content = frame.crop(bounds)
    original_width = right - left
    original_height = bottom - top
    applied_scale = scale
    width = max(1, round(original_width * applied_scale))
    height = max(1, round(original_height * applied_scale))
    content = content.resize((width, height), Image.Resampling.LANCZOS)

    # Scale x movement around the frame centre; this preserves intentional
    # weapon-swing/charge offsets while removing action-sheet scale drift.
    dest_left = round(FRAME_W / 2 + (left - FRAME_W / 2) * applied_scale)
    # Generated action sheets frequently move the entire character several
    # pixels up/down from frame to frame.  That reads as floating in-game, so
    # every standing state shares one foot line.  Dying is the sole exception:
    # its content must descend naturally as the knight falls.
    dest_bottom = round(
        target_base_bottom + (bottom - source_base_bottom) * applied_scale
        if preserve_vertical_motion else target_base_bottom
    )
    dest_top = dest_bottom - height

    output = Image.new("RGBA", (FRAME_W, FRAME_H), (0, 0, 0, 0))
    output.alpha_composite(content, (dest_left, dest_top))
    return output


def process_sheet(
    source_path: Path,
    output_path: Path,
    target_count: int,
    mode: str,
    target_height: float,
    target_bottom: float,
    target_area: float,
) -> tuple[list[int], list[int]]:
    frames = read_frames(source_path)
    global_scale, source_base_bottom = source_scale(mode, frames, target_height, target_area)
    output = Image.new("RGBA", (FRAME_W * COLS, FRAME_H * ROWS), (0, 0, 0, 0))

    for target_index in range(target_count):
        _, frame, bounds = frames[
            temporal_source_index(target_index, target_count, len(frames))
        ]
        rendered = compose_frame(
            frame,
            bounds,
            global_scale,
            source_base_bottom,
            target_bottom,
            mode == "dying",
        )
        x = (target_index % COLS) * FRAME_W
        y = (target_index // COLS) * FRAME_H
        output.alpha_composite(rendered, (x, y))

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output.save(output_path)
    output_frames = [
        index
        for index in range(COLS * ROWS)
        if alpha_bounds(
            output.crop(
                (
                    (index % COLS) * FRAME_W,
                    (index // COLS) * FRAME_H,
                    (index % COLS + 1) * FRAME_W,
                    (index // COLS + 1) * FRAME_H,
                )
            )
        )
    ]
    return [index for index, _, _ in frames], output_frames


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-dir", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    args = parser.parse_args()

    running = read_frames(args.source_dir / "running.png")
    target_height, target_bottom, target_area = stable_running_baseline(running)
    print(
        f"Running baseline: height={target_height:.1f}, "
        f"foot-bottom={target_bottom:.1f}, area={target_area:.1f}"
    )

    for output_name, source_name, target_count, mode in SHEETS:
        source_frames, output_frames = process_sheet(
            args.source_dir / source_name,
            args.output_dir / output_name,
            target_count,
            mode,
            target_height,
            target_bottom,
            target_area,
        )
        print(
            f"{output_name}: source={source_frames}, output={output_frames}"
        )


if __name__ == "__main__":
    main()
