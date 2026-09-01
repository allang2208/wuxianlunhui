#!/usr/bin/env python3
"""Build dense action-phase evidence for the trench-assault attack v04 source."""

from __future__ import annotations

import json
from pathlib import Path

import av
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent
VIDEO = ROOT / "videos" / "attacking-doubao-v04-reference-only.mp4"
OUT = ROOT / "previews" / "attacking-analysis-v04"
INDICES = tuple(range(24, 113, 2))


def main() -> None:
    with av.open(str(VIDEO)) as container:
        stream = container.streams.video[0]
        fps = float(stream.average_rate)
        frames = [frame.to_image().convert("RGB") for frame in container.decode(stream)]
    OUT.mkdir(parents=True, exist_ok=True)
    cols, tile_w, tile_h, label_h = 5, 384, 216, 24
    rows = (len(INDICES) + cols - 1) // cols
    contact = Image.new("RGB", (cols * tile_w, rows * (tile_h + label_h)), "#20242a")
    draw = ImageDraw.Draw(contact)
    for cell, index in enumerate(INDICES):
        x, y = (cell % cols) * tile_w, (cell // cols) * (tile_h + label_h)
        contact.paste(frames[index].resize((tile_w, tile_h), Image.Resampling.LANCZOS), (x, y))
        draw.text((x + 6, y + tile_h + 3), f"f{index} / {index / fps:.3f}s", fill="white")
    contact.save(OUT / "dense-f24-f112-step2.jpg", quality=95)
    report = {
        "schemaVersion": 1,
        "source": str(VIDEO.relative_to(ROOT)).replace("\\", "/"),
        "fps": fps,
        "sourceFrameCount": len(frames),
        "denseContact": "previews/attacking-analysis-v04/dense-f24-f112-step2.jpg",
        "flashFramesFromWarmDelta": [42, 43],
        "selectionStatus": "selected_for_formalization",
        "selectedSourceIndices": [0, 8, 16, 28, 38, 42, 44, 48, 56, 64, 72, 80, 88, 96, 104, 112, 120],
        "releaseRawSourceFrame": 42,
        "pumpPhaseRawFrames": {"start": 56, "rear": 72, "forward": 88, "locked": 96},
        "formal": {
            "sourceSheetFrames": 17,
            "rifeMode": "one-shot",
            "rifeFrames": 33,
            "runtimeFrameRate": 22,
            "durationSeconds": 1.5,
            "releaseOutputIndex": 10,
            "releaseDelayMs": 10 / 22 * 1000,
        },
    }
    (OUT / "attack-phases.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
