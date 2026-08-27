#!/usr/bin/env python3
"""Restricted frame repair for the rejected Doubao moving candidate.

Only two known Seedance defects are touched: the added long orange tail is
removed against the white background, and exposed orange toes are recolored as
dark leather. Body/weapon/camera pixels and the source frame trajectory remain
unchanged.
"""

from __future__ import annotations

import json
from pathlib import Path

import av
import cv2
import numpy as np
from PIL import Image, ImageFilter


ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "videos" / "moving-doubao-v01.mp4"
OUTPUT = ROOT / "videos" / "moving-doubao-v01-restricted-fix.mp4"
REPORT = OUTPUT.with_suffix(".postprocess.json")


def fur_mask(rgb: np.ndarray) -> np.ndarray:
    r = rgb[..., 0].astype(np.int16)
    g = rgb[..., 1].astype(np.int16)
    b = rgb[..., 2].astype(np.int16)
    return (
        (r > 72)
        & (r < 242)
        & (r - g > 5)
        & (g - b > 7)
        & (r - b > 20)
    )


def feather(mask: np.ndarray, radius: int = 2) -> np.ndarray:
    image = Image.fromarray((mask * 255).astype(np.uint8), "L")
    image = image.filter(ImageFilter.MaxFilter(radius * 2 + 1))
    image = image.filter(ImageFilter.GaussianBlur(radius))
    return np.asarray(image, dtype=np.float32) / 255.0


def repair(rgb: np.ndarray) -> np.ndarray:
    height, width = rgb.shape[:2]
    if (width, height) != (1280, 720):
        raise RuntimeError(f"unexpected source size: {width}x{height}")

    warm = fur_mask(rgb)
    yy, xx = np.ogrid[:height, :width]

    # The added tail occupies this narrow lower-left band in all 121 frames.
    # Color gating avoids touching the dark quiver, coat hem, and boot leather.
    tail_region = (xx >= 340) & (xx <= 470) & (yy >= 552) & (yy <= 620)
    tail_mask = ((warm & tail_region) * 255).astype(np.uint8)
    tail_mask = cv2.dilate(tail_mask, np.ones((3, 3), np.uint8), iterations=1)
    repaired = cv2.inpaint(rgb, tail_mask, 5, cv2.INPAINT_TELEA)

    # Keep each foot silhouette and walking trajectory, changing only exposed
    # warm fur/toe pixels below the coat into shaded dark-brown boot leather.
    warm_after = fur_mask(repaired)
    foot_region = (xx >= 420) & (xx <= 720) & (yy >= 618) & (yy <= 700)
    boot_alpha = feather(warm_after & foot_region, 2)[..., None] * 0.92
    luma = (
        repaired[..., 0].astype(np.float32) * 0.299
        + repaired[..., 1].astype(np.float32) * 0.587
        + repaired[..., 2].astype(np.float32) * 0.114
    )
    leather = np.stack([
        np.clip(luma * 0.55, 34, 118),
        np.clip(luma * 0.36, 24, 82),
        np.clip(luma * 0.25, 18, 62),
    ], axis=-1).astype(np.uint8)
    repaired = np.rint(repaired * (1.0 - boot_alpha) + leather * boot_alpha).astype(np.uint8)
    return repaired


def main() -> None:
    with av.open(str(SOURCE)) as input_container:
        input_stream = input_container.streams.video[0]
        fps = input_stream.average_rate
        with av.open(str(OUTPUT), "w") as output_container:
            output_stream = output_container.add_stream("libx264", rate=fps)
            output_stream.width = input_stream.width
            output_stream.height = input_stream.height
            output_stream.pix_fmt = "yuv420p"
            output_stream.options = {"crf": "17", "preset": "medium"}
            frame_count = 0
            for frame in input_container.decode(input_stream):
                rgb = frame.to_ndarray(format="rgb24")
                fixed = av.VideoFrame.from_ndarray(repair(rgb), format="rgb24")
                for packet in output_stream.encode(fixed):
                    output_container.mux(packet)
                frame_count += 1
            for packet in output_stream.encode():
                output_container.mux(packet)

    REPORT.write_text(json.dumps({
        "source": str(SOURCE.relative_to(ROOT)),
        "output": str(OUTPUT.relative_to(ROOT)),
        "frames": frame_count,
        "scope": [
            "erase warm-color pixels only in fixed lower-left long-tail band",
            "recolor warm-color exposed toe pixels only in fixed lower-foot band",
        ],
        "trajectoryChanged": False,
        "bodyWeaponCameraRepainted": False,
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(REPORT.read_text(encoding="utf-8"))


if __name__ == "__main__":
    main()
