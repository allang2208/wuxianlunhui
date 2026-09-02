#!/usr/bin/env python3
"""Build dense 32-contact reviews for the four-unit MiniMax H3 batch."""

from __future__ import annotations

import json
import math
from pathlib import Path

import cv2
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
SHOOTING = REPO / "tools/ai-gen/_industrial_shooting_mothers_20260831/animations"
CAVALRY = REPO / "tools/ai-gen/_industrial_cavalry_mothers_20260831/animations"
OUTPUT = ROOT / "source-reviews"

UNITS = {
    "service_rifleman": (SHOOTING / "service_rifleman", ("idle", "running", "attacking", "dying")),
    "emplaced_machine_gun_crew": (SHOOTING / "emplaced_machine_gun_crew", ("idle", "running", "attacking", "dying")),
    "industrial_carbine_cavalry": (CAVALRY / "industrial_carbine_cavalry", ("idle", "running", "attacking", "dying")),
    "gunpowder_explosive_lancer": (CAVALRY / "gunpowder_explosive_lancer", ("idle", "running", "attacking", "charging", "dying")),
}


def read_video(path: Path) -> tuple[list[Image.Image], float]:
    capture = cv2.VideoCapture(str(path))
    fps = float(capture.get(cv2.CAP_PROP_FPS) or 24.0)
    frames: list[Image.Image] = []
    while True:
        ok, bgr = capture.read()
        if not ok:
            break
        frames.append(Image.fromarray(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)))
    capture.release()
    if not frames:
        raise RuntimeError(f"no decoded frames: {path}")
    return frames, fps


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    report = {"schemaVersion": 1, "date": "2026-09-02", "contactsPerVideo": 32, "actions": {}}
    for unit_key, (unit_root, actions) in UNITS.items():
        for action in actions:
            video = unit_root / "videos" / f"{action}-h3-v01.mp4"
            frames, fps = read_video(video)
            indices = [round(i * (len(frames) - 1) / 31) for i in range(32)]
            tile_w, tile_h, label_h, cols = 256, 144, 22, 4
            rows = math.ceil(len(indices) / cols)
            contact = Image.new("RGB", (cols * tile_w, rows * (tile_h + label_h)), "#20242a")
            draw = ImageDraw.Draw(contact)
            for position, index in enumerate(indices):
                row, col = divmod(position, cols)
                x, y = col * tile_w, row * (tile_h + label_h)
                contact.paste(frames[index].resize((tile_w, tile_h), Image.Resampling.LANCZOS), (x, y))
                draw.text((x + 5, y + tile_h + 3), f"{unit_key}/{action} f{index}", fill="white")
            output = OUTPUT / f"{unit_key}-{action}-32-contact.png"
            contact.save(output, optimize=True)
            report["actions"][f"{unit_key}/{action}"] = {
                "video": str(video.relative_to(REPO)).replace("\\", "/"),
                "frameCount": len(frames),
                "fps": fps,
                "durationSeconds": len(frames) / fps,
                "indices": indices,
                "contact": str(output.relative_to(REPO)).replace("\\", "/"),
            }
            print(f"[source-review] {unit_key}/{action}: {len(frames)} @ {fps:g} -> {output.name}", flush=True)
    (OUTPUT / "source-review-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    main()
