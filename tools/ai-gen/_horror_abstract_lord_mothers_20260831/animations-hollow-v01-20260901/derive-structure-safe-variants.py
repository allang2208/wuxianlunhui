"""Derive structure-safe Hollow Ovum motion variants from accepted H3 sources.

The H3 hover rerolls both foreshortened the vertical egg body.  This script
keeps the accepted H3 pixel trajectory and only adds a whole-frame vertical
translation for movement.  The pulse variant uses the small, topology-safe
opening phase of the accepted vacuum action, reverses that exact trajectory,
then returns to the accepted idle source.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import av
import numpy as np


ROOT = Path(__file__).resolve().parent
VIDEOS = ROOT / "videos"
FPS = 24


def read_video(path: Path) -> list[np.ndarray]:
    with av.open(str(path)) as container:
        return [frame.to_ndarray(format="rgb24") for frame in container.decode(video=0)]


def write_video(path: Path, frames: list[np.ndarray]) -> None:
    height, width = frames[0].shape[:2]
    with av.open(str(path), mode="w") as container:
        stream = container.add_stream("libx264", rate=FPS)
        stream.width = width
        stream.height = height
        stream.pix_fmt = "yuv420p"
        stream.options = {"crf": "18", "preset": "slow"}
        for image in frames:
            frame = av.VideoFrame.from_ndarray(image, format="rgb24")
            for packet in stream.encode(frame):
                container.mux(packet)
        for packet in stream.encode():
            container.mux(packet)


def translate_y(image: np.ndarray, offset: int) -> np.ndarray:
    if offset == 0:
        return image.copy()
    shifted = np.full_like(image, 255)
    if offset < 0:
        amount = -offset
        shifted[:-amount] = image[amount:]
    else:
        shifted[offset:] = image[:-offset]
    return shifted


def full_frame_mae(first: np.ndarray, second: np.ndarray) -> float:
    return float(np.abs(first.astype(np.int16) - second.astype(np.int16)).mean())


def main() -> None:
    idle_path = VIDEOS / "hollow-ovum-idle-v01.mp4"
    vacuum_path = VIDEOS / "hollow-ovum-vacuum-draw-v02.mp4"
    hover_path = VIDEOS / "hollow-ovum-hover-motion-adjusted-v03.mp4"
    pulse_path = VIDEOS / "hollow-ovum-shell-pulse-adjusted-v02.mp4"

    idle = read_video(idle_path)
    vacuum = read_video(vacuum_path)
    if len(idle) != 124 or len(vacuum) != 124:
        raise RuntimeError(f"Expected 124-frame H3 sources, got idle={len(idle)}, vacuum={len(vacuum)}")

    hover_offsets = [
        -round(8.0 * math.sin(math.pi * index / (len(idle) - 1)) ** 2)
        for index in range(len(idle))
    ]
    hover = [translate_y(frame, offset) for frame, offset in zip(idle, hover_offsets)]

    peak_frame = 28
    pulse_open = vacuum[: peak_frame + 1]
    pulse_recover = list(reversed(vacuum[:peak_frame]))
    pulse_idle_tail = idle[1:68]
    pulse = pulse_open + pulse_recover + pulse_idle_tail
    if len(pulse) != 124:
        raise RuntimeError(f"Expected 124 pulse frames, got {len(pulse)}")

    write_video(hover_path, hover)
    write_video(pulse_path, pulse)

    provenance = {
        "createdDate": "2026-09-01",
        "method": "offline_structure_safe_derivation_from_accepted_h3_sources",
        "fps": FPS,
        "frameCount": 124,
        "resolution": [1024, 576],
        "outputs": {
            hover_path.name: {
                "source": idle_path.name,
                "operation": "whole_frame_integer_vertical_translation",
                "offsetPx": {"min": min(hover_offsets), "max": max(hover_offsets)},
                "identityPolicy": "No pixel warp, scale, rotation, interpolation, or generative redraw was applied.",
                "firstLastMaeBeforeEncode": full_frame_mae(hover[0], hover[-1]),
            },
            pulse_path.name: {
                "sources": [vacuum_path.name, idle_path.name],
                "operation": "vacuum_frames_0_to_28_then_exact_reverse_27_to_0_then_idle_frames_1_to_67",
                "peakSourceFrame": peak_frame,
                "identityPolicy": "Uses only decoded frames from accepted H3 videos; no geometry warp, scale, rotation, or generative redraw was applied.",
                "recoveryJoinMaeBeforeEncode": full_frame_mae(vacuum[0], idle[1]),
                "firstLastMaeBeforeEncode": full_frame_mae(pulse[0], pulse[-1]),
            },
        },
    }
    (VIDEOS / "structure-safe-derived-videos.json").write_text(
        json.dumps(provenance, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    main()
