#!/usr/bin/env python3
"""Inspect the approved steel-shield attack video's audio envelope."""

from __future__ import annotations

import json
from pathlib import Path

import av
import numpy as np


ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "videos" / "attacking-doubao-v01.mp4"
OUTPUT = ROOT / "reports" / "attacking-audio-envelope.json"
SAMPLE_RATE = 44_100
WINDOW_MS = 100


def dbfs(value: float) -> float:
    return float(20.0 * np.log10(max(value, 1e-12)))


def main() -> None:
    with av.open(str(SOURCE)) as container:
        audio_streams = [stream for stream in container.streams if stream.type == "audio"]
        if not audio_streams:
            raise RuntimeError("approved attack video has no audio stream")
        stream = audio_streams[0]
        source_info = {
            "codec": stream.codec_context.name,
            "sampleRate": stream.codec_context.sample_rate,
            "channels": stream.codec_context.channels,
            "layout": str(stream.codec_context.layout),
            "durationSeconds": float(stream.duration * stream.time_base) if stream.duration else None,
        }
        resampler = av.AudioResampler(format="fltp", layout="stereo", rate=SAMPLE_RATE)
        chunks: list[np.ndarray] = []
        for frame in container.decode(stream):
            for converted in resampler.resample(frame):
                chunks.append(converted.to_ndarray().astype(np.float32, copy=False))
        for converted in resampler.resample(None):
            chunks.append(converted.to_ndarray().astype(np.float32, copy=False))
    if not chunks:
        raise RuntimeError("approved attack video audio decoded no samples")
    audio = np.concatenate(chunks, axis=1)
    window_samples = round(SAMPLE_RATE * WINDOW_MS / 1000)
    envelope = []
    for start in range(0, audio.shape[1], window_samples):
        block = audio[:, start:start + window_samples]
        if block.size == 0:
            continue
        rms = float(np.sqrt(np.mean(np.square(block), dtype=np.float64)))
        peak = float(np.max(np.abs(block)))
        envelope.append({
            "startSeconds": start / SAMPLE_RATE,
            "endSeconds": min(audio.shape[1], start + window_samples) / SAMPLE_RATE,
            "rmsDbfs": dbfs(rms),
            "peakDbfs": dbfs(peak),
        })
    ranked = sorted(envelope, key=lambda item: item["rmsDbfs"], reverse=True)
    report = {
        "source": "videos/attacking-doubao-v01.mp4",
        "sourceInfo": source_info,
        "decodedSampleRate": SAMPLE_RATE,
        "decodedChannels": 2,
        "decodedDurationSeconds": audio.shape[1] / SAMPLE_RATE,
        "windowMs": WINDOW_MS,
        "topWindowsByRms": ranked[:8],
        "envelope": envelope,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
