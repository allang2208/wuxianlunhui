#!/usr/bin/env python3
"""Print a short-time level profile for the approved attack video's audio track."""

from __future__ import annotations

from pathlib import Path

import av
import numpy as np


ROOT = Path(__file__).resolve().parents[5]
SOURCE = Path(__file__).resolve().parent / "videos/attacking-doubao-v03-receiver-visible.mp4"
SAMPLE_RATE = 44_100
BIN_SECONDS = 0.1


def dbfs(value: float) -> float:
    return float(20.0 * np.log10(max(value, 1e-12)))


def main() -> None:
    container = av.open(str(SOURCE))
    stream = next((item for item in container.streams if item.type == "audio"), None)
    if stream is None:
        raise RuntimeError(f"No audio stream: {SOURCE.relative_to(ROOT)}")
    resampler = av.AudioResampler(format="fltp", layout="stereo", rate=SAMPLE_RATE)
    chunks: list[np.ndarray] = []
    for frame in container.decode(stream):
        for converted in resampler.resample(frame):
            chunks.append(converted.to_ndarray().astype(np.float32, copy=False))
    for converted in resampler.resample(None):
        chunks.append(converted.to_ndarray().astype(np.float32, copy=False))
    container.close()
    if not chunks:
        raise RuntimeError(f"No decodable samples: {SOURCE.relative_to(ROOT)}")

    audio = np.concatenate(chunks, axis=1)
    mono = np.mean(audio, axis=0)
    bin_samples = round(BIN_SECONDS * SAMPLE_RATE)
    print(
        f"source={SOURCE.relative_to(ROOT).as_posix()} codec={stream.codec_context.name} "
        f"duration={audio.shape[1] / SAMPLE_RATE:.3f}s channels={audio.shape[0]} rate={SAMPLE_RATE}"
    )
    for offset in range(0, mono.size, bin_samples):
        block = mono[offset:offset + bin_samples]
        if block.size == 0:
            continue
        rms = float(np.sqrt(np.mean(np.square(block), dtype=np.float64)))
        peak = float(np.max(np.abs(block)))
        start = offset / SAMPLE_RATE
        end = min(mono.size, offset + bin_samples) / SAMPLE_RATE
        print(f"{start:4.1f}-{end:4.1f}s rms={dbfs(rms):7.2f}dBFS peak={dbfs(peak):7.2f}dBFS")


if __name__ == "__main__":
    main()
