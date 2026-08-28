#!/usr/bin/env python3
"""Analyze and extract Werewolf King SFX from the accepted action videos.

Run with the project ComfyUI Python environment, which provides PyAV + NumPy.
Use ``--analyze`` to print a 100 ms RMS/peak envelope before changing windows.
"""

from __future__ import annotations

import argparse
from fractions import Fraction
from pathlib import Path
import shutil
import tempfile

import av
import numpy as np


ROOT = Path(__file__).resolve().parents[2]
VIDEO_DIR = ROOT / "tools" / "ai-gen" / "_werewolf_king_20260828" / "videos"
SAMPLE_RATE = 44_100
TARGET_RMS_DBFS = -16.0
PEAK_CEILING_DBFS = -1.0

ACCEPTED_SOURCES = {
    "attack": VIDEO_DIR / "attacking-doubao-v01.mp4",
    "pounce": VIDEO_DIR / "pounce-doubao-v02-side-plane-lock.mp4",
    "howl": VIDEO_DIR / "howl-doubao-v01.mp4",
    "death": VIDEO_DIR / "dying-doubao-v02-fixed-scale.mp4",
    "idle": VIDEO_DIR / "idle-doubao-v01.mp4",
    "running": VIDEO_DIR / "running-doubao-v01.mp4",
}

# Windows were selected from the 100 ms envelope of the accepted formal videos.
# Leading quiet material is intentionally retained for howl/death so their
# in-file event timing remains aligned when playback starts with the animation.
CLIPS: tuple[dict[str, object], ...] = (
    {
        "sourceKey": "attack",
        "start": 0.52,
        "end": 1.68,
        "output": "assets/sounds/enemies/werewolf_king/attacking-windup.mp3",
    },
    {
        "sourceKey": "attack",
        "start": 2.20,
        "end": 3.02,
        "output": "assets/sounds/enemies/werewolf_king/claw-impact.mp3",
    },
    {
        "sourceKey": "pounce",
        "start": 0.16,
        "end": 1.38,
        "output": "assets/sounds/enemies/werewolf_king/pounce-prepare.mp3",
    },
    {
        "sourceKey": "pounce",
        "start": 1.58,
        "end": 2.86,
        "output": "assets/sounds/enemies/werewolf_king/pounce-launch.mp3",
    },
    {
        "sourceKey": "pounce",
        "start": 3.02,
        "end": 3.58,
        "output": "assets/sounds/enemies/werewolf_king/pounce-impact.mp3",
    },
    {
        "sourceKey": "howl",
        "start": 0.00,
        "end": 4.58,
        "output": "assets/sounds/enemies/werewolf_king/howling.mp3",
    },
    {
        "sourceKey": "death",
        "start": 0.00,
        "end": 2.62,
        "output": "assets/sounds/enemies/werewolf_king/dying.mp3",
    },
    {
        "sourceKey": "running",
        "start": 0.52,
        "end": 1.86,
        "output": "assets/sounds/enemies/werewolf_king/running.mp3",
    },
)


def decode_stereo(path: Path) -> np.ndarray:
    with av.open(str(path)) as container:
        stream = next((stream for stream in container.streams if stream.type == "audio"), None)
        if stream is None:
            raise RuntimeError(f"No audio stream: {path}")
        resampler = av.AudioResampler(format="fltp", layout="stereo", rate=SAMPLE_RATE)
        chunks: list[np.ndarray] = []
        for frame in container.decode(stream):
            for converted in resampler.resample(frame):
                chunks.append(converted.to_ndarray().astype(np.float32, copy=False))
        for converted in resampler.resample(None):
            chunks.append(converted.to_ndarray().astype(np.float32, copy=False))
    if not chunks:
        raise RuntimeError(f"No decodable audio frames: {path}")
    return np.concatenate(chunks, axis=1)


def dbfs(value: float) -> float:
    return float(20 * np.log10(max(value, 1e-12)))


def analyze(name: str, audio: np.ndarray) -> None:
    window = round(0.1 * SAMPLE_RATE)
    values: list[str] = []
    for offset in range(0, audio.shape[1], window):
        block = audio[:, offset:offset + window]
        rms = float(np.sqrt(np.mean(np.square(block), dtype=np.float64)))
        peak = float(np.max(np.abs(block)))
        values.append(f"{offset / SAMPLE_RATE:4.1f}:{dbfs(rms):6.1f}/{dbfs(peak):5.1f}")
    full_rms = float(np.sqrt(np.mean(np.square(audio), dtype=np.float64)))
    full_peak = float(np.max(np.abs(audio)))
    print(
        f"[{name}] duration={audio.shape[1] / SAMPLE_RATE:.3f}s "
        f"rms={dbfs(full_rms):.2f}dBFS peak={dbfs(full_peak):.2f}dBFS"
    )
    for index in range(0, len(values), 10):
        print("  " + "  ".join(values[index:index + 10]))


def prepare_clip(audio: np.ndarray, start: float, end: float) -> np.ndarray:
    lo = max(0, round(start * SAMPLE_RATE))
    hi = min(audio.shape[1], round(end * SAMPLE_RATE))
    if hi <= lo:
        raise ValueError(f"Invalid trim window: {start:.3f}-{end:.3f}s")
    clip = audio[:, lo:hi].copy()
    clip -= np.mean(clip, axis=1, keepdims=True)

    fade_samples = min(round(0.012 * SAMPLE_RATE), clip.shape[1] // 2)
    if fade_samples:
        fade = np.linspace(0.0, 1.0, fade_samples, dtype=np.float32)
        clip[:, :fade_samples] *= fade
        clip[:, -fade_samples:] *= fade[::-1]

    rms = float(np.sqrt(np.mean(np.square(clip), dtype=np.float64)) + 1e-12)
    peak = float(np.max(np.abs(clip)) + 1e-12)
    rms_gain = 10 ** ((TARGET_RMS_DBFS - dbfs(rms)) / 20)
    peak_limit = 10 ** (PEAK_CEILING_DBFS / 20) / peak
    clip *= min(rms_gain, peak_limit)
    return np.clip(clip, -1.0, 1.0).astype(np.float32, copy=False)


def encode_mp3(path: Path, audio: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="werewolf-king-sfx-") as temp_dir:
        temp_path = Path(temp_dir) / path.name
        with av.open(str(temp_path), mode="w") as container:
            stream = container.add_stream("mp3", rate=SAMPLE_RATE)
            stream.bit_rate = 160_000
            pts = 0
            for offset in range(0, audio.shape[1], 1152):
                block = np.ascontiguousarray(audio[:, offset:offset + 1152])
                frame = av.AudioFrame.from_ndarray(block, format="fltp", layout="stereo")
                frame.sample_rate = SAMPLE_RATE
                frame.pts = pts
                frame.time_base = Fraction(1, SAMPLE_RATE)
                pts += block.shape[1]
                for packet in stream.encode(frame):
                    container.mux(packet)
            for packet in stream.encode(None):
                container.mux(packet)
        shutil.copyfile(temp_path, path)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--analyze", action="store_true")
    args = parser.parse_args()
    cache: dict[str, np.ndarray] = {}

    if args.analyze:
        for name, source in ACCEPTED_SOURCES.items():
            audio = decode_stereo(source)
            cache[name] = audio
            analyze(name, audio)
        return

    if not CLIPS:
        raise RuntimeError("No approved trim windows are configured; run --analyze first")
    for spec in CLIPS:
        source_key = str(spec["sourceKey"])
        if source_key not in cache:
            cache[source_key] = decode_stereo(ACCEPTED_SOURCES[source_key])
        audio = cache[source_key]
        clip = prepare_clip(audio, float(spec["start"]), float(spec["end"]))
        output = ROOT / str(spec["output"])
        encode_mp3(output, clip)
        rms = float(np.sqrt(np.mean(np.square(clip), dtype=np.float64)))
        peak = float(np.max(np.abs(clip)))
        print(
            f"{output.relative_to(ROOT)} duration={clip.shape[1] / SAMPLE_RATE:.3f}s "
            f"peak={dbfs(peak):.2f}dBFS rms={dbfs(rms):.2f}dBFS"
        )


if __name__ == "__main__":
    main()
