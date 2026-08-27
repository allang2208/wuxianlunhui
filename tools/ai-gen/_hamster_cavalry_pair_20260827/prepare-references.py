#!/usr/bin/env python3
"""Place the two approved cavalry mothers in safe 16:9 video frames."""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
MOTHER_ROOT = REPO / "tools" / "ai-gen" / "_hamster_missing_mothers_20260826" / "mother"

JOBS = {
    "cavalry": {
        "source": MOTHER_ROOT / "hamster-cavalry-mother-v04-line-rider-white.png",
        "cutout": ROOT / "references" / "hamster-cavalry-mother-v04-cutout.png",
        "output": ROOT / "references" / "hamster-cavalry-safe-white-1024x576.png",
        "x": 120,
    },
    "winged_hussar": {
        "source": MOTHER_ROOT / "hamster-winged-hussar-mother-v04-line-rider-white.png",
        "cutout": ROOT / "references" / "hamster-winged-hussar-mother-v04-cutout.png",
        "output": ROOT / "references" / "hamster-winged-hussar-safe-white-1024x576.png",
        "x": 130,
    },
}


def crop_subject(source: Image.Image) -> tuple[Image.Image, tuple[int, int, int, int]]:
    if source.mode == "RGBA":
        alpha_bbox = source.getchannel("A").getbbox()
        if not alpha_bbox:
            raise RuntimeError("cutout alpha is empty")
        margin = 8
        bbox = (
            max(0, alpha_bbox[0] - margin),
            max(0, alpha_bbox[1] - margin),
            min(source.width, alpha_bbox[2] + margin),
            min(source.height, alpha_bbox[3] + margin),
        )
        return source.crop(bbox), bbox
    rgb = np.asarray(source, dtype=np.int16)
    distance = np.max(255 - rgb, axis=2)
    ys, xs = np.where(distance > 15)
    if not len(xs):
        raise RuntimeError("no non-white subject found")
    margin = 8
    bbox = (
        max(0, int(xs.min()) - margin),
        max(0, int(ys.min()) - margin),
        min(source.width, int(xs.max()) + 1 + margin),
        min(source.height, int(ys.max()) + 1 + margin),
    )
    return source.crop(bbox), bbox


def main() -> None:
    target_height = 405
    baseline_y = 515
    for unit_key, job in JOBS.items():
        source_path = Path(job["cutout"])
        if not source_path.exists():
            raise RuntimeError(f"missing BiRefNet cutout for {unit_key}: {source_path}")
        source = Image.open(source_path).convert("RGBA")
        subject, source_bbox = crop_subject(source)
        target_width = round(subject.width * target_height / subject.height)
        subject = subject.resize((target_width, target_height), Image.Resampling.LANCZOS)
        x = int(job["x"])
        y = baseline_y - target_height
        output_bbox = (x, y, x + target_width, y + target_height)
        if min(x, y, 1024 - output_bbox[2], 576 - output_bbox[3]) < 50:
            raise RuntimeError(f"unsafe output margin for {unit_key}: {output_bbox}")
        canvas = Image.new("RGB", (1024, 576), (255, 255, 255))
        canvas.paste(subject.convert("RGB"), (x, y), subject.getchannel("A"))
        output = Path(job["output"])
        output.parent.mkdir(parents=True, exist_ok=True)
        canvas.save(output, quality=100)
        print(f"saved {output} source_bbox={source_bbox} output_bbox={output_bbox}")


if __name__ == "__main__":
    main()
