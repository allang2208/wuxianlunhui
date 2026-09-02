#!/usr/bin/env python3
"""Extract the approved rifle shot and complete bolt cycle from the Doubao source."""

from __future__ import annotations

from fractions import Fraction
from pathlib import Path
import shutil
import tempfile

import av
import numpy as np


ROOT = Path(__file__).resolve().parents[5]
TASK_ROOT = Path(__file__).resolve().parent
SOURCE = TASK_ROOT / "videos/attacking-doubao-v03-receiver-visible.mp4"
OUTPUT = ROOT / "assets/sounds/friendly/industrial_recon_rifleman_attack_video.mp3"
SAMPLE_RATE = 44_100
WINDOW_START = 1.68
WINDOW_END = 4.12
TARGET_RMS_DBFS = -16.0
PEAK_CEILING_DBFS = -1.0


def decode_stereo(path: Path) -> np.ndarray:
    container = av.open(str(path))
    stream = next((item for item in container.streams if item.type == "audio"), None)
    if stream is None:
        raise RuntimeError(f"No audio stream: {path.relative_to(ROOT)}")
    resampler = av.AudioResampler(format="fltp", layout="stereo", rate=SAMPLE_RATE)
    chunks: list[np.ndarray] = []
    for frame in container.decode(stream):
        for converted in resampler.resample(frame):
            chunks.append(converted.to_ndarray().astype(np.float32, copy=False))
    for converted in resampler.resample(None):
        chunks.append(converted.to_ndarray().astype(np.float32, copy=False))
    container.close()
    if not chunks:
        raise RuntimeError(f"No decodable samples: {path.relative_to(ROOT)}")
    return np.concatenate(chunks, axis=1)


def prepare_clip(audio: np.ndarray) -> np.ndarray:
    lo = max(0, round(WINDOW_START * SAMPLE_RATE))
    hi = min(audio.shape[1], round(WINDOW_END * SAMPLE_RATE))
    if hi <= lo:
        raise ValueError(f"Invalid window: {WINDOW_START:.3f}-{WINDOW_END:.3f}s")
    clip = audio[:, lo:hi].copy()
    clip -= np.mean(clip, axis=1, keepdims=True)

    fade_samples = min(round(0.012 * SAMPLE_RATE), clip.shape[1] // 2)
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
    with tempfile.TemporaryDirectory(prefix="industrial-recon-sfx-") as temp_dir:
        temp_path = Path(temp_dir) / path.name
        container = av.open(str(temp_path), mode="w")
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
        container.close()
        shutil.copyfile(temp_path, path)


def dbfs(value: float) -> float:
    return float(20.0 * np.log10(max(value, 1e-12)))


def main() -> None:
    clip = prepare_clip(decode_stereo(SOURCE))
    encode_mp3(OUTPUT, clip)
    rms = float(np.sqrt(np.mean(np.square(clip), dtype=np.float64)))
    peak = float(np.max(np.abs(clip)))
    print(
        f"output={OUTPUT.relative_to(ROOT).as_posix()} "
        f"window={WINDOW_START:.2f}-{WINDOW_END:.2f}s "
        f"duration={clip.shape[1] / SAMPLE_RATE:.3f}s "
        f"rate={SAMPLE_RATE} channels={clip.shape[0]} bitrate=160kbps "
        f"peak={dbfs(peak):.2f}dBFS rms={dbfs(rms):.2f}dBFS"
    )


if __name__ == "__main__":
    main()
