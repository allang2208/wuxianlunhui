#!/usr/bin/env python3
"""Render exact-clock review GIFs and event/seam contacts for formal sheets."""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent
POST = ROOT / "postprocess"
SHEET_DIR = POST / "sheets-rife"
OUTPUT_DIR = POST / "previews" / "runtime-clock-exact"
SOURCE_REPORT = POST / "formal-source-report.json"
REPORT_PATH = POST / "formal-preview-report.json"


def extract(path: Path, width: int, height: int, count: int, cols: int = 8) -> list[np.ndarray]:
    sheet = np.asarray(Image.open(path).convert("RGBA"))
    frames = []
    for index in range(count):
        row, col = divmod(index, cols)
        frames.append(sheet[row * height:(row + 1) * height, col * width:(col + 1) * width].copy())
    return frames


def checker(frame: np.ndarray) -> Image.Image:
    yy, xx = np.indices(frame.shape[:2])
    shade = np.where(((xx // 20 + yy // 20) % 2)[..., None], 58, 82)
    background = np.repeat(shade, 3, axis=2).astype(np.float32)
    alpha = frame[..., 3:4].astype(np.float32) / 255.0
    rgb = frame[..., :3].astype(np.float32) * alpha + background * (1.0 - alpha)
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB")


def gif_durations(frame_count: int, frame_rate: float) -> list[int]:
    frame_ms = 1000.0 / frame_rate
    durations: list[int] = []
    previous_tick = 0
    for frame_number in range(1, frame_count + 1):
        target_tick = int(math.floor(frame_number * frame_ms / 10.0 + 0.5))
        target_tick = max(previous_tick + 1, target_tick)
        durations.append((target_tick - previous_tick) * 10)
        previous_tick = target_tick
    return durations


def save_contact(frames: list[np.ndarray], indices: list[int], output: Path, label: str) -> None:
    tile_w = 256
    tile_h = round(frames[0].shape[0] * tile_w / frames[0].shape[1])
    label_h = 26
    contact = Image.new("RGB", (tile_w * len(indices), tile_h + label_h), "#20242a")
    draw = ImageDraw.Draw(contact)
    for position, index in enumerate(indices):
        x = position * tile_w
        contact.paste(checker(frames[index]).resize((tile_w, tile_h), Image.Resampling.LANCZOS), (x, 0))
        draw.text((x + 5, tile_h + 5), f"{label} f{index}", fill="white")
    contact.save(output)


def main() -> None:
    source = json.loads(SOURCE_REPORT.read_text(encoding="utf-8"))
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    report: dict[str, object] = {
        "schemaVersion": 1,
        "date": "2026-09-01",
        "unitKey": "steel_shield_assault",
        "clock": "exact formal frame rate with GIF 10 ms tick distribution; no review hold inserted",
        "actions": {},
    }
    extracted: dict[str, list[np.ndarray]] = {}
    for name, spec in source["actions"].items():
        frames = extract(
            SHEET_DIR / f"{name}.png", spec["frameWidth"], spec["frameHeight"],
            spec["finalFrameCount"], 8,
        )
        extracted[name] = frames
        target_width = 512
        target_height = round(spec["frameHeight"] * target_width / spec["frameWidth"])
        playback = [
            checker(frame).resize((target_width, target_height), Image.Resampling.LANCZOS)
            for frame in frames
        ]
        durations = gif_durations(len(playback), spec["runtimeFrameRate"])
        if min(durations) < 20:
            raise RuntimeError(f"{name} contains browser-unsafe GIF delay {min(durations)} ms")
        save_options: dict[str, object] = {
            "save_all": True,
            "append_images": playback[1:],
            "duration": durations,
            "disposal": 2,
            "optimize": False,
        }
        if spec["repeat"] == -1:
            save_options["loop"] = 0
        playback[0].save(OUTPUT_DIR / f"{name}.gif", **save_options)
        report["actions"][name] = {
            "preview": str((OUTPUT_DIR / f"{name}.gif").relative_to(ROOT)).replace("\\", "/"),
            "frameCount": len(frames),
            "frameRate": spec["runtimeFrameRate"],
            "nominalDurationMs": len(frames) / spec["runtimeFrameRate"] * 1000,
            "gifDurationMs": sum(durations),
            "gifFrameDurationMsRange": [min(durations), max(durations)],
            "loopMode": "infinite" if spec["repeat"] == -1 else "once_and_freeze_final",
        }

    running = extracted["running"]
    running_indices = list(range(len(running) - 4, len(running))) + list(range(4))
    save_contact(running, running_indices, OUTPUT_DIR / "running-loop-seam-contact.png", "runtime")
    report["actions"]["running"]["loopSeamContact"] = str(
        (OUTPUT_DIR / "running-loop-seam-contact.png").relative_to(ROOT)
    ).replace("\\", "/")

    attacking = extracted["attacking"]
    attack_indices = [16, 17, 18, 19, 20, 22, 24, 26, 30, 34]
    save_contact(attacking, attack_indices, OUTPUT_DIR / "attacking-release-smoke-contact.png", "runtime")
    report["actions"]["attacking"].update({
        "releaseOutputIndex": 18,
        "releaseDelayMs": 18 / source["actions"]["attacking"]["runtimeFrameRate"] * 1000,
        "releaseSmokeContact": str(
            (OUTPUT_DIR / "attacking-release-smoke-contact.png").relative_to(ROOT)
        ).replace("\\", "/"),
    })

    dying = extracted["dying"]
    save_contact(dying, list(range(38, 45)), OUTPUT_DIR / "dying-final-contact.png", "runtime")
    report["actions"]["dying"].update({
        "finalCorpseOutputIndex": 44,
        "finalContact": str((OUTPUT_DIR / "dying-final-contact.png").relative_to(ROOT)).replace("\\", "/"),
    })
    REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
