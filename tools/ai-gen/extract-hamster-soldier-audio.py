#!/usr/bin/env python3
"""Extract the clean, action-specific hamster soldier SFX from accepted videos.

Run with the project ComfyUI Python environment, which provides PyAV + NumPy.
The chosen windows intentionally exclude long ambience/music-heavy sections.
"""

from __future__ import annotations

from fractions import Fraction
from pathlib import Path
import shutil
import tempfile

import av
import numpy as np


ROOT = Path(__file__).resolve().parents[2]
SAMPLE_RATE = 44_100
TARGET_RMS_DBFS = -16.0
PEAK_CEILING_DBFS = -1.0

CLIPS = (
    {
        "source": ROOT / "tools/ai-gen/_hamster_anti_vehicle_20260826/h3/videos/hamster_anti_vehicle_smg_attacking_h3.mp4",
        "output": ROOT / "assets/sounds/friendly/hamster_anti_vehicle_attack.mp3",
        "start": 1.34,
        "end": 1.82,
    },
    {
        "source": ROOT / "tools/ai-gen/_hamster_ninja_20260826/videos/attacking-doubao-v05-centered.mp4",
        "output": ROOT / "assets/sounds/friendly/hamster_ninja_attack.mp3",
        "start": 0.92,
        "end": 1.62,
    },
    {
        "source": ROOT / "tools/ai-gen/_hamster_ninja_20260826/videos/smoke-bomb-doubao-v02.mp4",
        "output": ROOT / "assets/sounds/friendly/hamster_ninja_stealth.mp3",
        "start": 2.72,
        "end": 3.24,
    },
)


def decode_stereo(path: Path) -> np.ndarray:
    container = av.open(str(path))
    stream = next(s for s in container.streams if s.type == "audio")
    resampler = av.AudioResampler(format="fltp", layout="stereo", rate=SAMPLE_RATE)
    chunks: list[np.ndarray] = []
    for frame in container.decode(stream):
        for converted in resampler.resample(frame):
            chunks.append(converted.to_ndarray().astype(np.float32, copy=False))
    for converted in resampler.resample(None):
        chunks.append(converted.to_ndarray().astype(np.float32, copy=False))
    container.close()
    if not chunks:
        raise RuntimeError(f"No decodable audio frames: {path}")
    return np.concatenate(chunks, axis=1)


def prepare_clip(audio: np.ndarray, start: float, end: float) -> np.ndarray:
    lo = max(0, round(start * SAMPLE_RATE))
    hi = min(audio.shape[1], round(end * SAMPLE_RATE))
    if hi <= lo:
        raise ValueError(f"Invalid trim window: {start:.3f}-{end:.3f}s")
    clip = audio[:, lo:hi].copy()
    clip -= np.mean(clip, axis=1, keepdims=True)

    fade_samples = min(round(0.012 * SAMPLE_RATE), clip.shape[1] // 2)
    if fade_samples > 0:
        fade = np.linspace(0.0, 1.0, fade_samples, dtype=np.float32)
        clip[:, :fade_samples] *= fade
        clip[:, -fade_samples:] *= fade[::-1]

    rms = float(np.sqrt(np.mean(np.square(clip), dtype=np.float64)) + 1e-12)
    peak = float(np.max(np.abs(clip)) + 1e-12)
    rms_gain = 10 ** ((TARGET_RMS_DBFS - 20 * np.log10(rms)) / 20)
    peak_limit = 10 ** (PEAK_CEILING_DBFS / 20) / peak
    clip *= min(rms_gain, peak_limit)
    return np.clip(clip, -1.0, 1.0).astype(np.float32, copy=False)


def encode_mp3(path: Path, audio: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    # FFmpeg's Windows MP3 muxer cannot open this project's non-ASCII absolute
    # path reliably. Encode under an ASCII temp path, then copy the completed
    # binary through Python's Unicode-safe filesystem API.
    with tempfile.TemporaryDirectory(prefix="hamster-sfx-") as temp_dir:
        temp_path = Path(temp_dir) / path.name
        container = av.open(str(temp_path), mode="w")
        stream = container.add_stream("mp3", rate=SAMPLE_RATE)
        stream.bit_rate = 160_000
        frame_size = 1152
        pts = 0
        for offset in range(0, audio.shape[1], frame_size):
            block = np.ascontiguousarray(audio[:, offset:offset + frame_size])
            frame = av.AudioFrame.from_ndarray(block, format="fltp", layout="stereo")
            frame.sample_rate = SAMPLE_RATE
            frame.pts = pts
            frame.time_base = Fraction(1, SAMPLE_RATE)
            pts += block.shape[1]
            for packet in stream.encode(frame):
                container.mux(packet)
        for packet in stream.encode(None):
            container.mux(packet)
        container.close()
        shutil.copyfile(temp_path, path)


def dbfs(value: float) -> float:
    return 20 * np.log10(max(value, 1e-12))


def main() -> None:
    for spec in CLIPS:
        audio = decode_stereo(spec["source"])
        clip = prepare_clip(audio, spec["start"], spec["end"])
        encode_mp3(spec["output"], clip)
        rms = float(np.sqrt(np.mean(np.square(clip), dtype=np.float64)))
        peak = float(np.max(np.abs(clip)))
        print(
            f"{spec['output'].relative_to(ROOT)} "
            f"duration={clip.shape[1] / SAMPLE_RATE:.3f}s "
            f"peak={dbfs(peak):.2f}dBFS rms={dbfs(rms):.2f}dBFS"
        )


if __name__ == "__main__":
    main()
