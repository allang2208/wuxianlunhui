#!/usr/bin/env python3
"""Render review GIFs at the exact runtime clocks, without review hold frames."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
ASSET_DIR = REPO / "assets" / "companions" / "hamster_champion"
OUTPUT_DIR = ROOT / "previews" / "runtime-clock-exact"
CONFIG_PATH = REPO / "data" / "hamster-champion-config.json"


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
    """Distribute GIF's 10 ms ticks so cumulative playback matches runtime time."""
    frame_ms = 1000.0 / frame_rate
    durations: list[int] = []
    previous_tick = 0
    for frame_number in range(1, frame_count + 1):
        target_tick = int(math.floor(frame_number * frame_ms / 10.0 + 0.5))
        target_tick = max(previous_tick + 1, target_tick)
        durations.append((target_tick - previous_tick) * 10)
        previous_tick = target_tick
    return durations


def browser_safe_preview_indices(frame_count: int, duration_ms: float) -> list[int]:
    """Keep GIF delays at >=20 ms so Chromium does not clamp 10 ms frames."""
    max_frames = max(1, int(math.floor(duration_ms / 20.0)))
    preview_count = min(frame_count, max_frames)
    if preview_count == frame_count:
        return list(range(frame_count))
    return [
        int(round(position * (frame_count - 1) / (preview_count - 1)))
        for position in range(preview_count)
    ]


def timed_preview_indices(frame_durations: list[float], tick_ms: int = 20) -> list[int]:
    """Sample the frame visible at each browser-safe wall-clock tick."""
    duration_ms = sum(frame_durations)
    indices: list[int] = []
    frame = 0
    frame_end = frame_durations[0]
    for timestamp in range(0, round(duration_ms), tick_ms):
        while frame < len(frame_durations) - 1 and timestamp >= frame_end:
            frame += 1
            frame_end += frame_durations[frame]
        indices.append(frame)
    return indices


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--action",
        action="append",
        choices=("idle", "running", "attacking", "dying"),
        help="rebuild only the named exact-clock preview; may be repeated",
    )
    args = parser.parse_args()
    selected = set(args.action or ())
    source = json.loads((ROOT / "runtime-source-sheet-report.json").read_text(encoding="utf-8"))
    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    report_path = ROOT / "runtime-preview-report.json"
    if selected and report_path.exists():
        report = json.loads(report_path.read_text(encoding="utf-8"))
    else:
        report = {
            "clock": "exact runtime frameRate; no artificial first/last review holds",
            "actions": {},
        }
    report["clock"] = (
        "exact runtime duration; one-shots use browser-safe temporal subsampling "
        "when GIF's 10 ms tick would be clamped"
    )
    for name, spec in source["actions"].items():
        if selected and name not in selected:
            continue
        frames = extract(
            ASSET_DIR / f"{name}.png", spec["frameWidth"], spec["frameHeight"],
            spec["finalFrameCount"], 8,
        )
        animation = config["animations"][spec["configKey"]]
        frame_durations = animation.get("frameDurations")
        if frame_durations:
            frame_durations = [float(value) for value in frame_durations]
            runtime_duration_ms = sum(frame_durations)
            preview_indices = timed_preview_indices(frame_durations)
        else:
            runtime_duration_ms = spec["finalFrameCount"] / spec["runtimeFrameRate"] * 1000
            preview_indices = (
                browser_safe_preview_indices(len(frames), runtime_duration_ms)
                if spec["repeat"] == 0 else list(range(len(frames)))
            )
        selected_frames = [frames[index] for index in preview_indices]
        target_width = 512
        target_height = round(spec["frameHeight"] * target_width / spec["frameWidth"])
        preview_frames = [
            checker(frame).resize((target_width, target_height), Image.Resampling.LANCZOS)
            for frame in selected_frames
        ]
        playback = preview_frames if spec["repeat"] == 0 else preview_frames * 3
        if frame_durations:
            durations = [20] * len(playback)
        else:
            preview_frame_rate = len(selected_frames) / (runtime_duration_ms / 1000.0)
            durations = gif_durations(len(playback), preview_frame_rate)
        if min(durations) < 20:
            raise RuntimeError(f"{name} GIF contains a browser-unsafe delay: {min(durations)} ms")
        save_options = {
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
            "preview": f"previews/runtime-clock-exact/{name}.gif",
            "runtimeFrameCount": spec["finalFrameCount"],
            "previewFrameCount": len(selected_frames),
            "previewSourceIndices": preview_indices,
            "frameRate": spec["runtimeFrameRate"],
            "nominalDurationMs": runtime_duration_ms,
            "gifFrameDurationMsRange": [min(durations), max(durations)],
            "gifPlaybackDurationMs": sum(durations),
            "gifLoopMode": "once" if spec["repeat"] == 0 else "infinite",
            "browserSafeMinimumFrameDurationMs": 20,
        }
        if frame_durations:
            report["actions"][name]["runtimeFrameDurationsMs"] = frame_durations

        if name == "running":
            seam_indices = list(range(len(frames) - 4, len(frames))) + list(range(4))
            tile_width = 260
            tile_height = round(spec["frameHeight"] * tile_width / spec["frameWidth"])
            label_height = 26
            seam = Image.new("RGB", (tile_width * len(seam_indices), tile_height + label_height), "#20242a")
            seam_draw = ImageDraw.Draw(seam)
            for position, index in enumerate(seam_indices):
                tile = checker(frames[index]).resize((tile_width, tile_height), Image.Resampling.LANCZOS)
                x = position * tile_width
                seam.paste(tile, (x, 0))
                marker = "wrap -> " if index == 0 else ""
                seam_draw.text((x + 5, tile_height + 5), f"{marker}runtime f{index}", fill="white")
            seam.save(OUTPUT_DIR / "running-loop-seam-contact.png")
            report["actions"][name]["loopSeamContact"] = (
                "previews/runtime-clock-exact/running-loop-seam-contact.png"
            )

    if not selected or "attacking" in selected:
        attack = source["actions"]["attacking"]
        attack_frames = extract(
            ASSET_DIR / "attacking.png", attack["frameWidth"], attack["frameHeight"],
            attack["finalFrameCount"], 8,
        )
        damage_index = 24
        attack_animation = config["animations"][attack["configKey"]]
        attack_durations = attack_animation.get("frameDurations")
        damage_delay_ms = (
            sum(float(value) for value in attack_durations[:damage_index])
            if attack_durations else damage_index / attack["runtimeFrameRate"] * 1000
        )
        contact = checker(attack_frames[damage_index]).resize((768, 407), Image.Resampling.LANCZOS)
        draw = ImageDraw.Draw(contact)
        draw.rectangle((10, 10, 392, 48), fill=(20, 24, 30))
        draw.text(
            (20, 20), f"damage contact: frame 25 / {damage_delay_ms:.0f} ms",
            fill=(255, 224, 110),
        )
        contact.save(OUTPUT_DIR / "attacking-damage-contact-frame25.png")
        report["attackDamageContact"] = {
            "zeroBasedFrame": damage_index,
            "oneBasedFrame": damage_index + 1,
            "delayMs": damage_delay_ms,
            "preview": "previews/runtime-clock-exact/attacking-damage-contact-frame25.png",
        }
    report_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8",
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
