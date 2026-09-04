#!/usr/bin/env python3
"""Extract the approved single-shot audio cue from the Doubao attack source."""

from __future__ import annotations

import json
import wave
from hashlib import sha256
from pathlib import Path

import av
import numpy as np


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[4]
SOURCE = ROOT / "videos" / "attacking-doubao-v04-reference-only.mp4"
OUTPUT = REPO / "assets" / "sounds" / "friendly" / "trench_assault_attack_video.wav"
REPORT = ROOT / "postprocess" / "attack-audio-report.json"
START_SECONDS = 1.68
END_SECONDS = 2.55


def digest(path: Path) -> str:
    return sha256(path.read_bytes()).hexdigest()


def main() -> None:
    with av.open(str(SOURCE)) as container:
        stream = container.streams.audio[0]
        rate = int(stream.codec_context.sample_rate)
        layout = stream.codec_context.layout.name
        frames = [frame.to_ndarray() for frame in container.decode(stream)]
    if not frames:
        raise RuntimeError("Attack source has no decoded audio frames")
    audio = np.concatenate(frames, axis=1)
    if audio.shape[0] != 2 or layout != "stereo":
        raise RuntimeError(f"Expected stereo source, got shape={audio.shape} layout={layout}")
    start = round(START_SECONDS * rate)
    end = min(audio.shape[1], round(END_SECONDS * rate))
    clip = np.clip(audio[:, start:end], -1.0, 1.0).astype(np.float32)
    fade = min(round(0.012 * rate), clip.shape[1] // 4)
    if fade:
        ramp = np.linspace(0.0, 1.0, fade, dtype=np.float32)
        clip[:, :fade] *= ramp
        clip[:, -fade:] *= ramp[::-1]
    pcm = np.round(clip * 32767.0).astype("<i2").T.reshape(-1)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(OUTPUT), "wb") as wav:
        wav.setnchannels(2)
        wav.setsampwidth(2)
        wav.setframerate(rate)
        wav.writeframes(pcm.tobytes())
    report = {
        "schemaVersion": 1,
        "date": "2026-09-01",
        "unitKey": "trench_assault",
        "source": SOURCE.relative_to(ROOT).as_posix(),
        "sourceWindowSeconds": [START_SECONDS, END_SECONDS],
        "sourceShotPeakSeconds": 1.75,
        "output": OUTPUT.relative_to(REPO).as_posix(),
        "format": "pcm_s16le",
        "channels": 2,
        "sampleRate": rate,
        "durationSeconds": clip.shape[1] / rate,
        "peak": float(np.max(np.abs(clip))),
        "sha256": digest(OUTPUT),
        "runtimeIntegration": True,
        "testsRun": False,
    }
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
