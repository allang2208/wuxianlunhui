#!/usr/bin/env python3
"""Extract the approved steel-shield pistol shot to a task-local MP3."""

from __future__ import annotations

from fractions import Fraction
import hashlib
import json
from pathlib import Path
import shutil
import tempfile

import av
import numpy as np


ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "videos" / "attacking-doubao-v01.mp4"
OUTPUT = ROOT / "audio" / "steel-shield-assault-attack.mp3"
REPORT = ROOT / "audio" / "steel-shield-assault-attack.json"
SAMPLE_RATE = 44_100
WINDOW_START = 1.98
WINDOW_END = 2.85
TARGET_RMS_DBFS = -16.0
PEAK_CEILING_DBFS = -1.0


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def decode_stereo(path: Path) -> np.ndarray:
    container = av.open(str(path))
    stream = next((item for item in container.streams if item.type == "audio"), None)
    if stream is None:
        raise RuntimeError(f"No audio stream: {path}")
    resampler = av.AudioResampler(format="fltp", layout="stereo", rate=SAMPLE_RATE)
    chunks: list[np.ndarray] = []
    for frame in container.decode(stream):
        for converted in resampler.resample(frame):
            chunks.append(converted.to_ndarray().astype(np.float32, copy=False))
    for converted in resampler.resample(None):
        chunks.append(converted.to_ndarray().astype(np.float32, copy=False))
    container.close()
    if not chunks:
        raise RuntimeError(f"No decodable samples: {path}")
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
    with tempfile.TemporaryDirectory(prefix="steel-shield-sfx-") as temp_dir:
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
    report = {
        "schemaVersion": 1,
        "date": "2026-09-01",
        "unitKey": "steel_shield_assault",
        "assetOnly": True,
        "runtimeIntegration": False,
        "source": str(SOURCE.relative_to(ROOT)).replace("\\", "/"),
        "sourceSha256": sha256(SOURCE),
        "windowSeconds": [WINDOW_START, WINDOW_END],
        "operation": "stereo decode, DC removal, 12ms in/out fades, RMS normalization with peak ceiling, MP3 encode",
        "output": str(OUTPUT.relative_to(ROOT)).replace("\\", "/"),
        "outputBytes": OUTPUT.stat().st_size,
        "outputSha256": sha256(OUTPUT),
        "durationSeconds": clip.shape[1] / SAMPLE_RATE,
        "sampleRate": SAMPLE_RATE,
        "channels": clip.shape[0],
        "bitRate": 160_000,
        "peakDbfs": dbfs(peak),
        "rmsDbfs": dbfs(rms),
        "plannedRuntimeReleaseFrameZeroBased": 18,
        "plannedRuntimeReleaseDelayMs": 551.0204081632654,
    }
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
