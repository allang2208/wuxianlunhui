#!/usr/bin/env python3
"""Build raw visual evidence for the heavy-lancer MiniMax H3 charge redraw."""

from __future__ import annotations

import json
import math
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
VIDEO = (
    REPO
    / "tools/ai-gen/_industrial_cavalry_mothers_20260831/animations"
    / "gunpowder_explosive_lancer/videos/charging-h3-v02.mp4"
)
OUTPUT = ROOT / "source-reviews"
FORMAL_SOURCE_INDICES = [
    0, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64,
    68, 72, 75, 78, 80, 82, 83, 84, 85, 86, 88, 89,
]


def read_video(path: Path) -> tuple[list[np.ndarray], float]:
    capture = cv2.VideoCapture(str(path))
    fps = float(capture.get(cv2.CAP_PROP_FPS) or 24.0)
    frames: list[np.ndarray] = []
    while True:
        ok, bgr = capture.read()
        if not ok:
            break
        frames.append(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))
    capture.release()
    if not frames:
        raise RuntimeError(f"no decoded frames: {path}")
    return frames, fps


def subject_delta(left: np.ndarray, right: np.ndarray) -> float:
    visible = np.any(left < 248, axis=2) | np.any(right < 248, axis=2)
    if not np.any(visible):
        return 0.0
    return float(np.abs(left.astype(np.float32) - right.astype(np.float32))[visible].mean())


def save_contact(frames: list[np.ndarray], indices: list[int], path: Path) -> None:
    tile_w, tile_h, label_h, cols = 256, 144, 22, 6
    rows = math.ceil(len(indices) / cols)
    contact = Image.new("RGB", (cols * tile_w, rows * (tile_h + label_h)), "#20242a")
    draw = ImageDraw.Draw(contact)
    for position, index in enumerate(indices):
        row, col = divmod(position, cols)
        x, y = col * tile_w, row * (tile_h + label_h)
        frame = Image.fromarray(frames[index]).resize((tile_w, tile_h), Image.Resampling.LANCZOS)
        contact.paste(frame, (x, y))
        draw.text((x + 5, y + tile_h + 3), f"raw f{index}", fill="white")
    contact.save(path, optimize=True)


def save_gif(frames: list[np.ndarray], fps: float, path: Path) -> None:
    preview = [
        Image.fromarray(frame).resize((512, 288), Image.Resampling.LANCZOS)
        for frame in frames
    ]
    preview[0].save(
        path,
        save_all=True,
        append_images=preview[1:],
        duration=round(1000 / fps),
        loop=0,
        disposal=2,
        optimize=False,
    )


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    frames, fps = read_video(VIDEO)
    dense_indices = list(range(0, min(len(frames), 89), 4))
    dense_indices.extend(index for index in (92, 100, 110, 123) if index < len(frames))
    dense_indices = sorted(set(dense_indices))
    contact = OUTPUT / "heavy-cavalry-charging-v02-raw-dense-contact.png"
    preview = OUTPUT / "heavy-cavalry-charging-v02-raw.gif"
    selected_contact = OUTPUT / "heavy-cavalry-charging-v02-selected-source-contact.png"
    selected_preview = OUTPUT / "heavy-cavalry-charging-v02-selected-source.gif"
    report_path = OUTPUT / "heavy-cavalry-charging-v02-motion.json"
    save_contact(frames, dense_indices, contact)
    save_gif(frames, fps, preview)
    selected_frames = [frames[index] for index in FORMAL_SOURCE_INDICES]
    save_contact(frames, FORMAL_SOURCE_INDICES, selected_contact)
    save_gif(selected_frames, len(selected_frames) / 2.4, selected_preview)
    deltas = [subject_delta(frames[index], frames[index + 1]) for index in range(len(frames) - 1)]
    from_first = [subject_delta(frames[0], frame) for frame in frames]
    report = {
        "schemaVersion": 1,
        "video": str(VIDEO.relative_to(REPO)).replace("\\", "/"),
        "frameCount": len(frames),
        "fps": fps,
        "durationSeconds": len(frames) / fps,
        "denseContactIndices": dense_indices,
        "formalSourceIndices": FORMAL_SOURCE_INDICES,
        "impactRawFrame": 64,
        "impactFinalFrame1BasedAfter2xRife": FORMAL_SOURCE_INDICES.index(64) * 2 + 1,
        "expectedFinalFrameCount": len(FORMAL_SOURCE_INDICES) * 2 - 1,
        "expectedRuntimeFps": (len(FORMAL_SOURCE_INDICES) * 2 - 1) / 2.4,
        "subjectDeltaByTransition": deltas,
        "subjectDeltaFromFirstByFrame": from_first,
        "contact": str(contact.relative_to(REPO)).replace("\\", "/"),
        "previewGif": str(preview.relative_to(REPO)).replace("\\", "/"),
        "selectedSourceContact": str(selected_contact.relative_to(REPO)).replace("\\", "/"),
        "selectedSourceGif": str(selected_preview.relative_to(REPO)).replace("\\", "/"),
    }
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "frames": len(frames),
        "fps": fps,
        "contact": str(contact),
        "preview": str(preview),
        "deltaMin": min(deltas),
        "deltaMedian": float(np.median(deltas)),
        "deltaMax": max(deltas),
        "closestToFirstAfterFrame60": min(
            ({"frame": index, "delta": from_first[index]} for index in range(61, len(frames))),
            key=lambda item: item["delta"],
        ),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
