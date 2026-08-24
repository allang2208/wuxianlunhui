#!/usr/bin/env python3
"""Generate Elise's heavy circular whirlwind attack sound."""

from __future__ import annotations

import argparse
import json
import math
import wave
from pathlib import Path

import numpy as np


SR = 44_100
DURATION = 0.55


def noise(count: int, seed: int) -> np.ndarray:
    return np.random.default_rng(seed).standard_normal(count)


def bandpass(samples: np.ndarray, low: float, high: float) -> np.ndarray:
    spectrum = np.fft.rfft(samples)
    frequencies = np.fft.rfftfreq(len(samples), 1.0 / SR)
    spectrum *= (frequencies >= low) & (frequencies <= high)
    result = np.fft.irfft(spectrum, len(samples))
    peak = float(np.max(np.abs(result)))
    return result / max(peak, 1e-9)


def exp_burst(time: np.ndarray, start: float, decay: float) -> np.ndarray:
    local = np.maximum(0.0, time - start)
    return (time >= start) * np.exp(-local / decay)


def synthesize() -> np.ndarray:
    count = round(SR * DURATION)
    time = np.arange(count, dtype=np.float64) / SR

    attack = np.clip(time / 0.018, 0.0, 1.0)
    release = np.clip((DURATION - time) / 0.075, 0.0, 1.0)
    broad_envelope = np.sin(np.pi * np.clip(time / DURATION, 0.0, 1.0)) ** 0.42
    envelope = attack * release * broad_envelope

    # One fast circular pressure pass: wide and heavy, without a sharp sword edge.
    rotation_phase = 2.0 * np.pi * (time / DURATION)
    pressure = 0.52 + 0.48 * (0.5 + 0.5 * np.cos(rotation_phase - 0.75)) ** 1.45
    low_air = bandpass(noise(count, 4121), 48, 260) * envelope * pressure * 0.62
    body_air = bandpass(noise(count, 4122), 170, 900) * envelope * (1.0 - 0.22 * pressure) * 0.78
    muted_edge = bandpass(noise(count, 4123), 620, 1800) * envelope * 0.25

    # Slow pitch-bent pressure tone gives the rotation weight without becoming musical.
    frequency = 82.0 + 13.0 * np.cos(rotation_phase - 0.65) - 18.0 * (time / DURATION)
    phase = 2.0 * np.pi * np.cumsum(frequency) / SR
    sub_pressure = np.sin(phase) * envelope * (0.28 + 0.14 * pressure)
    resonance = np.sin(phase * 1.92 + 0.4) * envelope * 0.18
    blade_frequency = 225.0 + 82.0 * np.sin(rotation_phase - 0.4)
    blade_phase = 2.0 * np.pi * np.cumsum(blade_frequency) / SR
    blade_body = np.sin(blade_phase) * envelope * pressure * 0.15

    # A dominant mid-spin thump plus a very short closing weight make the hit immediate.
    impact_env = exp_burst(time, 0.205, 0.072)
    impact_phase = 2.0 * np.pi * np.cumsum(78.0 - 34.0 * np.clip(time - 0.205, 0.0, None)) / SR
    impact = np.sin(impact_phase) * impact_env * 0.78
    impact += np.sin(impact_phase * 1.82) * impact_env * 0.31
    impact += bandpass(noise(count, 4124), 75, 700) * impact_env * 0.43

    close_env = exp_burst(time, 0.405, 0.045)
    close_phase = 2.0 * np.pi * np.cumsum(66.0 - 28.0 * np.clip(time - 0.405, 0.0, None)) / SR
    impact += np.sin(close_phase) * close_env * 0.38
    impact += bandpass(noise(count, 4126), 100, 850) * close_env * 0.20

    mono = low_air + body_air + muted_edge + sub_pressure + resonance + blade_body + impact
    mono = np.tanh(mono * 1.52)

    # Subtle circular stereo motion; keep most energy centered for world-space playback.
    pan = 0.15 * np.sin(rotation_phase - np.pi / 2)
    side = bandpass(noise(count, 4125), 180, 980) * envelope * 0.052
    left = mono * (1.0 - pan) + side
    right = mono * (1.0 + pan) - side
    stereo = np.stack([left, right], axis=1)

    peak = float(np.max(np.abs(stereo)))
    stereo *= 0.92 / max(peak, 1e-9)
    return stereo.astype(np.float32)


def write_wav(path: Path, stereo: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    pcm = (np.clip(stereo, -1.0, 1.0) * 32767.0).astype("<i2")
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(2)
        handle.setsampwidth(2)
        handle.setframerate(SR)
        handle.writeframes(pcm.tobytes())


def analyze(stereo: np.ndarray) -> dict[str, float | int]:
    mono = stereo.mean(axis=1).astype(np.float64)
    rms = float(np.sqrt(np.mean(mono * mono)))
    peak = float(np.max(np.abs(stereo)))
    spectrum = np.abs(np.fft.rfft(mono)) ** 2
    frequencies = np.fft.rfftfreq(len(mono), 1.0 / SR)
    energy = float(spectrum.sum())
    low_energy = float(spectrum[frequencies <= 500].sum()) / max(energy, 1e-12)
    centroid = float((spectrum * frequencies).sum() / max(energy, 1e-12))
    return {
        "sampleRate": SR,
        "channels": 2,
        "frames": len(stereo),
        "durationSeconds": len(stereo) / SR,
        "peakDbfs": 20.0 * math.log10(max(peak, 1e-12)),
        "rmsDbfs": 20.0 * math.log10(max(rms, 1e-12)),
        "spectralCentroidHz": centroid,
        "energyBelow500Hz": low_energy,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()

    stereo = synthesize()
    write_wav(args.out, stereo)
    report = analyze(stereo)
    report_path = args.report or args.out.with_suffix(".json")
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
