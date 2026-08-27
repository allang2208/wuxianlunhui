#!/usr/bin/env python3
"""Generate the player's shoe-on-ground whirlwind friction sound."""

from __future__ import annotations

import argparse
import wave
from pathlib import Path

import numpy as np


SAMPLE_RATE = 44_100
SPIN_SECONDS = 0.8
RECOVER_SECONDS = 0.52
DURATION = SPIN_SECONDS + RECOVER_SECONDS


def _noise(count: int, seed: int) -> np.ndarray:
    return np.random.default_rng(seed).standard_normal(count)


def _bandpass(samples: np.ndarray, low: float, high: float) -> np.ndarray:
    spectrum = np.fft.rfft(samples)
    frequencies = np.fft.rfftfreq(len(samples), 1.0 / SAMPLE_RATE)
    spectrum *= (frequencies >= low) & (frequencies <= high)
    filtered = np.fft.irfft(spectrum, len(samples))
    return filtered / max(float(np.max(np.abs(filtered))), 1e-9)


def _smoothstep(value: np.ndarray) -> np.ndarray:
    value = np.clip(value, 0.0, 1.0)
    return value * value * (3.0 - 2.0 * value)


def synthesize() -> np.ndarray:
    count = round(SAMPLE_RATE * DURATION)
    time = np.arange(count, dtype=np.float64) / SAMPLE_RATE

    attack = _smoothstep(time / 0.035)
    recover_progress = np.clip((time - SPIN_SECONDS) / RECOVER_SECONDS, 0.0, 1.0)
    recover_fade = np.where(
        time < SPIN_SECONDS,
        1.0,
        (1.0 - _smoothstep(recover_progress)) ** 1.15,
    )
    envelope = attack * recover_fade

    # 双脚交替擦地的颗粒脉冲。recover 中脉冲逐步变慢，听感随动作收势缩小。
    pulse_hz = np.where(
        time < SPIN_SECONDS,
        12.5,
        12.5 - 8.5 * _smoothstep(recover_progress),
    )
    rotation_phase = 2.0 * np.pi * np.cumsum(pulse_hz) / SAMPLE_RATE
    scrape_pulse = (0.2 + 0.8 * (0.5 + 0.5 * np.cos(rotation_phase)) ** 5.5)
    opposite_pulse = (0.5 + 0.5 * np.cos(rotation_phase + np.pi)) ** 6.0
    contact = np.clip(scrape_pulse + opposite_pulse * 0.62, 0.0, 1.25)

    # 主体是砂土/鞋底摩擦，不加入金属泛音或剑刃啸叫。
    ground_body = _bandpass(_noise(count, 82501), 120, 920)
    rubber_grit = _bandpass(_noise(count, 82502), 650, 3_100)
    dust_hiss = _bandpass(_noise(count, 82503), 2_200, 6_200)
    roughness = _bandpass(_noise(count, 82504), 300, 1_700)

    high_shrink = np.where(time < SPIN_SECONDS, 1.0, (1.0 - recover_progress) ** 1.8)
    low_shrink = np.where(time < SPIN_SECONDS, 1.0, (1.0 - recover_progress) ** 0.7)
    mono = ground_body * (0.34 + contact * 0.42) * low_shrink
    mono += rubber_grit * (0.18 + contact * 0.64) * high_shrink
    mono += dust_hiss * contact * 0.18 * high_shrink
    mono += roughness * (0.12 + contact * 0.22) * low_shrink

    # 很轻的低频贴地压力，只增加重量，不做撞击或爆炸感。
    pressure = np.sin(2.0 * np.pi * 74.0 * time + 0.18 * np.sin(rotation_phase / 2.0))
    mono += pressure * (0.055 + contact * 0.035) * low_shrink
    mono = np.tanh(mono * 1.35) * envelope

    # 小幅左右扫动表现旋转，但保持主体居中，避免耳机里来回甩动过强。
    pan = 0.11 * np.sin(rotation_phase / 2.0)
    side = _bandpass(_noise(count, 82505), 500, 2_400) * envelope * high_shrink * 0.035
    left = mono * (1.0 - pan) + side
    right = mono * (1.0 + pan) - side
    stereo = np.stack([left, right], axis=1)

    peak = float(np.max(np.abs(stereo)))
    stereo *= 0.88 / max(peak, 1e-9)
    return stereo.astype(np.float32)


def write_wav(path: Path, stereo: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    pcm = (np.clip(stereo, -1.0, 1.0) * 32_767.0).astype('<i2')
    with wave.open(str(path), 'wb') as handle:
        handle.setnchannels(2)
        handle.setsampwidth(2)
        handle.setframerate(SAMPLE_RATE)
        handle.writeframes(pcm.tobytes())


def main() -> None:
    root = Path(__file__).resolve().parents[2]
    default_output = root / 'assets/sounds/skills/player_whirlwind_foot_friction.wav'
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', type=Path, default=default_output)
    args = parser.parse_args()

    write_wav(args.out, synthesize())
    print(f'generated {args.out} ({DURATION:.2f}s, {SAMPLE_RATE}Hz, stereo)')


if __name__ == '__main__':
    main()
