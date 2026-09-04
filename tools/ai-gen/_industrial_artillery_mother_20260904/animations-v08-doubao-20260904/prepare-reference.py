#!/usr/bin/env python3
"""Fit the selected artillery mother onto a safe 1024x576 white video canvas."""

import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parent
SOURCE = ROOT.parent / "mother/industrial-artillery-crew-mother-v08-engineering-camera.png"
OUTPUT = ROOT / "references/industrial-artillery-crew-v08-video-safe-1024x576.png"
METADATA = ROOT / "references/reference-metadata.json"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest().upper()


def main() -> None:
    source = Image.open(SOURCE).convert("RGB")
    rgb = np.asarray(source, dtype=np.int16)
    distance = np.max(255 - rgb, axis=2)
    ys, xs = np.where(distance > 18)
    if not len(xs):
        raise RuntimeError(f"No non-white subject found in {SOURCE}")
    margin = 12
    bbox = (
        max(0, int(xs.min()) - margin),
        max(0, int(ys.min()) - margin),
        min(source.width, int(xs.max()) + 1 + margin),
        min(source.height, int(ys.max()) + 1 + margin),
    )
    subject = source.crop(bbox)
    scale = min(940 / subject.width, 500 / subject.height)
    size = (round(subject.width * scale), round(subject.height * scale))
    subject = subject.resize(size, Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (1024, 576), "white")
    offset = ((1024 - size[0]) // 2, (576 - size[1]) // 2)
    canvas.paste(subject, offset)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(OUTPUT, optimize=True)
    data = {
        "source": SOURCE.relative_to(ROOT.parent).as_posix(),
        "sourceSha256": sha256(SOURCE),
        "sourceSize": list(source.size),
        "sourceSubjectBbox": list(bbox),
        "output": OUTPUT.relative_to(ROOT).as_posix(),
        "outputSha256": sha256(OUTPUT),
        "outputSize": [1024, 576],
        "uniformScale": scale,
        "scaledSize": list(size),
        "pasteOffset": list(offset),
        "operation": "non-white bbox plus margin, uniform Lanczos resize and centered white letterbox; no repaint, rotation or non-uniform stretch",
    }
    METADATA.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(data, ensure_ascii=False))


if __name__ == "__main__":
    main()
