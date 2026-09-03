#!/usr/bin/env python3
"""Extract one M249 shot with its natural tail from the accepted Freesound recording."""

from __future__ import annotations

import argparse
import json
import math
import struct
import wave
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--search-start", type=float, default=26.6945)
    parser.add_argument("--onset", type=float, default=26.6955)
    parser.add_argument("--end", type=float, default=27.55)
    parser.add_argument("--fade-out-ms", type=float, default=20.0)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    with wave.open(str(args.source), "rb") as source:
        params = source.getparams()
        if params.sampwidth != 2:
            raise ValueError(f"expected 16-bit PCM, got {params.sampwidth * 8}-bit")
        raw = source.readframes(params.nframes)

    sample_count = params.nframes * params.nchannels
    samples = list(struct.unpack(f"<{sample_count}h", raw))
    start_frame = max(0, round(args.search_start * params.framerate))
    onset_frame = min(params.nframes - 1, round(args.onset * params.framerate))
    end_frame = min(params.nframes, round(args.end * params.framerate))

    def mono(frame: int) -> int:
        base = frame * params.nchannels
        return sum(samples[base:base + params.nchannels]) // params.nchannels

    zero_crossing = start_frame
    for frame in range(start_frame + 1, onset_frame + 1):
        before = mono(frame - 1)
        after = mono(frame)
        if before == 0 or after == 0 or (before < 0 <= after) or (before > 0 >= after):
            zero_crossing = frame

    cropped = samples[zero_crossing * params.nchannels:end_frame * params.nchannels]
    frame_count = len(cropped) // params.nchannels
    fade_frames = min(frame_count, round(args.fade_out_ms * params.framerate / 1000.0))
    for offset in range(fade_frames):
        gain = 0.5 * (1.0 + math.cos(math.pi * (offset + 1) / fade_frames))
        frame = frame_count - fade_frames + offset
        base = frame * params.nchannels
        for channel in range(params.nchannels):
            cropped[base + channel] = round(cropped[base + channel] * gain)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(args.output), "wb") as output:
        output.setparams(params._replace(nframes=frame_count))
        output.writeframes(struct.pack(f"<{len(cropped)}h", *cropped))

    print(json.dumps({
        "source": str(args.source),
        "output": str(args.output),
        "sampleRate": params.framerate,
        "channels": params.nchannels,
        "bitsPerSample": params.sampwidth * 8,
        "sourceStartSeconds": zero_crossing / params.framerate,
        "sourceEndSeconds": end_frame / params.framerate,
        "outputDurationSeconds": frame_count / params.framerate,
        "fadeOutMs": args.fade_out_ms,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
