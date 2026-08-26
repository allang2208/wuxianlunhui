"""Deterministically synthesize original STG-44 and QBZ-95 weapon audio.

The web references documented in audio-provenance.md inform only the broad
mechanical character. No recording, sample, or impulse response is copied.
Outputs are 44.1 kHz / 16-bit / stereo WAV files for WebAudio playback.
"""

from __future__ import annotations

import math
import wave
from pathlib import Path

import numpy as np


SAMPLE_RATE = 44_100
ROOT = Path(__file__).resolve().parents[3]
OUTPUT_DIR = ROOT / "assets" / "sounds" / "weapons"


def _samples(seconds: float) -> int:
    return max(1, int(round(seconds * SAMPLE_RATE)))


def _band_noise(duration: float, low: float, high: float, seed: int) -> np.ndarray:
    """Deterministic FFT-band-limited noise with soft frequency shoulders."""
    count = _samples(duration)
    rng = np.random.default_rng(seed)
    raw = rng.normal(0.0, 1.0, count)
    spectrum = np.fft.rfft(raw)
    freq = np.fft.rfftfreq(count, 1.0 / SAMPLE_RATE)
    low_knee = np.clip((freq - low * 0.65) / max(1.0, low * 0.35), 0.0, 1.0)
    high_knee = np.clip((high * 1.18 - freq) / max(1.0, high * 0.18), 0.0, 1.0)
    filtered = np.fft.irfft(spectrum * low_knee * high_knee, n=count)
    peak = float(np.max(np.abs(filtered))) or 1.0
    return filtered / peak


def _decay(duration: float, tau: float, attack: float = 0.0004) -> np.ndarray:
    time = np.arange(_samples(duration), dtype=np.float64) / SAMPLE_RATE
    envelope = np.exp(-time / max(tau, 1e-4))
    if attack > 0:
        envelope *= np.minimum(1.0, time / attack)
    return envelope


def _tone_cluster(duration: float, frequencies: tuple[float, ...], tau: float, seed: int) -> np.ndarray:
    count = _samples(duration)
    time = np.arange(count, dtype=np.float64) / SAMPLE_RATE
    rng = np.random.default_rng(seed)
    signal = np.zeros(count, dtype=np.float64)
    for index, frequency in enumerate(frequencies):
        phase = rng.uniform(0.0, math.tau)
        detune = 1.0 + rng.uniform(-0.012, 0.012)
        signal += np.sin(math.tau * frequency * detune * time + phase) / (1.0 + index * 0.25)
    signal /= max(1.0, len(frequencies) * 0.65)
    return signal * _decay(duration, tau)


def _metal_hit(duration: float, seed: int, bright: bool = True, weight: float = 1.0) -> np.ndarray:
    freqs = (680.0, 1240.0, 2310.0, 3860.0) if bright else (240.0, 510.0, 980.0, 1780.0)
    ring = _tone_cluster(duration, freqs, 0.045 if bright else 0.065, seed)
    noise = _band_noise(duration, 700.0 if bright else 180.0, 10_500.0 if bright else 5_000.0, seed + 1)
    return weight * (0.72 * ring + 0.42 * noise * _decay(duration, 0.018))


def _mechanical_slide(duration: float, seed: int, low: float, high: float) -> np.ndarray:
    count = _samples(duration)
    time = np.arange(count, dtype=np.float64) / SAMPLE_RATE
    window = np.sin(np.pi * np.clip(time / duration, 0.0, 1.0)) ** 0.8
    scrape = _band_noise(duration, low, high, seed) * window
    ridges = 0.62 + 0.38 * np.sin(math.tau * (38.0 * time + 22.0 * time * time)) ** 2
    return scrape * ridges


def _place(track: np.ndarray, sound: np.ndarray, start: float, gain: float = 1.0) -> None:
    begin = _samples(start)
    end = min(len(track), begin + len(sound))
    if end > begin:
        track[begin:end] += sound[: end - begin] * gain


def _fire_stg44() -> np.ndarray:
    duration = 0.46
    track = np.zeros(_samples(duration), dtype=np.float64)
    blast = _band_noise(0.12, 115.0, 7_800.0, 4401) * _decay(0.12, 0.018)
    body = _tone_cluster(0.18, (82.0, 127.0, 194.0, 306.0), 0.050, 4402)
    crack = _band_noise(0.038, 2_200.0, 15_000.0, 4403) * _decay(0.038, 0.006)
    _place(track, blast, 0.0, 1.00)
    _place(track, body, 0.0, 0.78)
    _place(track, crack, 0.0, 0.62)
    # Long-stroke action and stamped receiver chatter after the muzzle event.
    _place(track, _metal_hit(0.105, 4404, bright=False), 0.054, 0.50)
    _place(track, _metal_hit(0.080, 4406, bright=True), 0.088, 0.30)
    tail = _band_noise(0.32, 95.0, 3_900.0, 4408) * _decay(0.32, 0.105, 0.002)
    _place(track, tail, 0.040, 0.25)
    _place(track, blast[: _samples(0.055)], 0.074, 0.16)
    _place(track, blast[: _samples(0.045)], 0.139, 0.09)
    return track


def _fire_qbz95() -> np.ndarray:
    duration = 0.34
    track = np.zeros(_samples(duration), dtype=np.float64)
    blast = _band_noise(0.090, 170.0, 10_800.0, 9501) * _decay(0.090, 0.012)
    body = _tone_cluster(0.125, (112.0, 186.0, 322.0, 548.0), 0.032, 9502)
    crack = _band_noise(0.030, 3_000.0, 18_500.0, 9503) * _decay(0.030, 0.0045)
    _place(track, blast, 0.0, 0.90)
    _place(track, body, 0.0, 0.48)
    _place(track, crack, 0.0, 0.91)
    # Compact short-stroke action is quicker and brighter, close to the ear in a bullpup.
    _place(track, _metal_hit(0.070, 9504, bright=True), 0.041, 0.46)
    _place(track, _metal_hit(0.055, 9506, bright=False), 0.067, 0.23)
    tail = _band_noise(0.23, 180.0, 5_800.0, 9508) * _decay(0.23, 0.070, 0.002)
    _place(track, tail, 0.030, 0.18)
    _place(track, blast[: _samples(0.038)], 0.061, 0.12)
    return track


def _reload_stg44() -> np.ndarray:
    track = np.zeros(_samples(1.60), dtype=np.float64)
    _place(track, _metal_hit(0.060, 4411, bright=True), 0.055, 0.32)       # release
    _place(track, _mechanical_slide(0.29, 4413, 180.0, 3_800.0), 0.135, 0.25)
    _place(track, _metal_hit(0.080, 4415, bright=False), 0.365, 0.24)      # old steel mag clears
    _place(track, _mechanical_slide(0.28, 4417, 150.0, 3_200.0), 0.565, 0.29)
    _place(track, _metal_hit(0.105, 4419, bright=False), 0.835, 0.55)      # curved mag seated
    _place(track, _metal_hit(0.050, 4421, bright=True), 0.925, 0.23)
    _place(track, _mechanical_slide(0.235, 4423, 260.0, 5_100.0), 1.035, 0.36)
    _place(track, _metal_hit(0.160, 4425, bright=False, weight=1.15), 1.255, 0.67)
    _place(track, _metal_hit(0.105, 4427, bright=True), 1.292, 0.28)
    return track


def _reload_qbz95() -> np.ndarray:
    track = np.zeros(_samples(1.25), dtype=np.float64)
    _place(track, _metal_hit(0.050, 9511, bright=True), 0.045, 0.27)
    _place(track, _mechanical_slide(0.215, 9513, 260.0, 4_500.0), 0.105, 0.20)
    _place(track, _metal_hit(0.065, 9515, bright=False), 0.285, 0.18)
    _place(track, _mechanical_slide(0.235, 9517, 230.0, 4_100.0), 0.405, 0.25)
    _place(track, _metal_hit(0.085, 9519, bright=False), 0.625, 0.42)
    _place(track, _metal_hit(0.050, 9521, bright=True), 0.690, 0.27)
    _place(track, _mechanical_slide(0.190, 9523, 430.0, 6_600.0), 0.785, 0.32)
    _place(track, _metal_hit(0.115, 9525, bright=True, weight=1.10), 0.970, 0.56)
    _place(track, _metal_hit(0.080, 9527, bright=False), 1.015, 0.19)
    return track


def _equip_stg44() -> np.ndarray:
    track = np.zeros(_samples(0.72), dtype=np.float64)
    cloth = _band_noise(0.25, 90.0, 1_500.0, 4431) * np.sin(np.linspace(0.0, np.pi, _samples(0.25)))
    _place(track, cloth, 0.025, 0.12)
    _place(track, _metal_hit(0.075, 4433, bright=False), 0.185, 0.30)
    _place(track, _metal_hit(0.048, 4435, bright=True), 0.315, 0.31)       # safety
    _place(track, _mechanical_slide(0.145, 4437, 260.0, 5_000.0), 0.405, 0.28)
    _place(track, _metal_hit(0.135, 4439, bright=False), 0.535, 0.54)
    return track


def _equip_qbz95() -> np.ndarray:
    track = np.zeros(_samples(0.58), dtype=np.float64)
    handling = _band_noise(0.20, 120.0, 2_200.0, 9531) * np.sin(np.linspace(0.0, np.pi, _samples(0.20)))
    _place(track, handling, 0.020, 0.10)
    _place(track, _metal_hit(0.045, 9533, bright=True), 0.155, 0.24)       # selector
    _place(track, _mechanical_slide(0.135, 9535, 480.0, 7_000.0), 0.245, 0.25)
    _place(track, _metal_hit(0.100, 9537, bright=True), 0.365, 0.50)
    _place(track, _metal_hit(0.070, 9539, bright=False), 0.405, 0.17)
    return track


def _stereo_master(mono: np.ndarray, seed: int) -> np.ndarray:
    """Soft-limit, add tiny channel decorrelation, fade out, and normalize."""
    mono = np.tanh(mono * 1.28)
    count = len(mono)
    right = np.roll(mono, 3) * 0.985
    right[:3] = 0.0
    ambience = _band_noise(count / SAMPLE_RATE, 180.0, 8_000.0, seed)
    activity = np.minimum(1.0, np.abs(mono) * 3.5)
    left = mono + ambience * activity * 0.012
    right -= ambience * activity * 0.010
    fade_count = min(_samples(0.025), count)
    fade = np.linspace(1.0, 0.0, fade_count, endpoint=True)
    left[-fade_count:] *= fade
    right[-fade_count:] *= fade
    stereo = np.column_stack((left, right))
    peak = float(np.max(np.abs(stereo))) or 1.0
    return stereo * (0.955 / peak)


def _write_wav(path: Path, stereo: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    pcm = np.clip(stereo, -1.0, 1.0)
    pcm16 = np.round(pcm * 32767.0).astype("<i2")
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(2)
        handle.setsampwidth(2)
        handle.setframerate(SAMPLE_RATE)
        handle.writeframes(pcm16.tobytes())


def main() -> None:
    sounds = {
        "stg44_fire.wav": (_fire_stg44(), 4441),
        "stg44_reload.wav": (_reload_stg44(), 4442),
        "stg44_equip.wav": (_equip_stg44(), 4443),
        "qbz95_fire.wav": (_fire_qbz95(), 9551),
        "qbz95_reload.wav": (_reload_qbz95(), 9552),
        "qbz95_equip.wav": (_equip_qbz95(), 9553),
    }
    for filename, (mono, seed) in sounds.items():
        output = OUTPUT_DIR / filename
        _write_wav(output, _stereo_master(mono, seed))
        print(f"{filename}: {len(mono) / SAMPLE_RATE:.3f}s, 44100 Hz, stereo, PCM16")


if __name__ == "__main__":
    main()
