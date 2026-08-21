#!/usr/bin/env python3
"""Final deterministic house refinement: -15% runtime high frequency, +15% saturation.

Consumes the approved denoised+saturated 2x candidates.  Geometry and alpha are
copied exactly; only opaque RGB pixels are adjusted.  The Gaussian blend is
solved per level against the final, saturation-adjusted runtime image.
"""

import importlib.util
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[2]
TOOLS = ROOT / "tools" / "ai-gen"
SOURCE_DIR = TOOLS / "_building_denoise_review_20260821"
OUT_DIR = TOOLS / "_building_refine_v2_review_20260821"

PIPELINE_PATH = TOOLS / "denoise-house-levels.py"
SPEC = importlib.util.spec_from_file_location("house_denoise_pipeline", PIPELINE_PATH)
PIPELINE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PIPELINE)

LEVELS = (
    ("lv1", 270, 310),
    ("lv2", 270, 309),
    ("lv3", 298, 335),
)

NOISE_TARGET = 0.85
SATURATION_FACTOR = 1.15
BLUR_SIGMA = 0.8


def boost_saturation_exact(rgba: np.ndarray, factor: float) -> np.ndarray:
    hsv = cv2.cvtColor(rgba[..., :3], cv2.COLOR_RGB2HSV).astype(np.float32)
    hsv[..., 1] = np.clip(hsv[..., 1] * factor, 0.0, 255.0)
    out = rgba.copy()
    out[..., :3] = cv2.cvtColor(np.rint(hsv).astype(np.uint8), cv2.COLOR_HSV2RGB)
    return out


def runtime_high_frequency(rgba: np.ndarray, runtime_size: tuple[int, int], mask: np.ndarray) -> float:
    runtime = PIPELINE.premultiplied_resize(rgba, runtime_size)
    gray = cv2.cvtColor(runtime[..., :3], cv2.COLOR_RGB2GRAY)
    laplacian = cv2.Laplacian(gray, cv2.CV_32F, ksize=3)
    return float(np.mean(np.abs(laplacian[mask])))


def saturation_mean(rgba: np.ndarray) -> float:
    mask = rgba[..., 3] > 200
    saturation = cv2.cvtColor(rgba[..., :3], cv2.COLOR_RGB2HSV)[..., 1]
    return float(saturation[mask].mean())


def solve_refinement(source: np.ndarray, runtime_size: tuple[int, int]):
    runtime_source = PIPELINE.premultiplied_resize(source, runtime_size)
    metric_mask = runtime_source[..., 3] > 220
    base_metric = runtime_high_frequency(source, runtime_size, metric_mask)
    target_metric = base_metric * NOISE_TARGET
    base_saturation = saturation_mean(source)
    target_saturation = base_saturation * SATURATION_FACTOR
    solid = (source[..., 3] >= 245).astype(np.uint8) * 255
    interior = cv2.erode(solid, np.ones((5, 5), np.uint8), iterations=1).astype(np.float32) / 255.0

    def solve_noise(saturation_multiplier: float):
        saturated = boost_saturation_exact(source, saturation_multiplier)
        blurred = cv2.GaussianBlur(
            saturated[..., :3], (0, 0), sigmaX=BLUR_SIGMA, sigmaY=BLUR_SIGMA
        )

        def mix(blend: float) -> np.ndarray:
            weight = (interior * blend)[..., None]
            out = saturated.copy()
            out[..., :3] = np.clip(
                np.rint(saturated[..., :3] * (1.0 - weight) + blurred * weight), 0, 255
            ).astype(np.uint8)
            out[..., 3] = source[..., 3]
            return out

        low_blend, high_blend = 0.0, 1.0
        for _ in range(18):
            blend = (low_blend + high_blend) / 2.0
            candidate = mix(blend)
            if runtime_high_frequency(candidate, runtime_size, metric_mask) > target_metric:
                low_blend = blend
            else:
                high_blend = blend
        return mix(high_blend), high_blend

    low_sat, high_sat = 1.0, 1.4
    for _ in range(14):
        saturation_multiplier = (low_sat + high_sat) / 2.0
        candidate, _ = solve_noise(saturation_multiplier)
        if saturation_mean(candidate) < target_saturation:
            low_sat = saturation_multiplier
        else:
            high_sat = saturation_multiplier
    final, final_blend = solve_noise(high_sat)
    final_metric = runtime_high_frequency(final, runtime_size, metric_mask)
    return final, {
        "saturationMultiplierApplied": round(high_sat, 4),
        "gaussianBlend": round(final_blend, 4),
        "runtimeHighFrequencyBefore": round(base_metric, 4),
        "runtimeHighFrequencyAfter": round(final_metric, 4),
        "noiseReductionPercent": round((1.0 - final_metric / base_metric) * 100.0, 2),
        "saturationBefore": round(base_saturation, 4),
        "saturationAfter": round(saturation_mean(final), 4),
        "saturationIncreasePercent": round(
            (saturation_mean(final) / saturation_mean(source) - 1.0) * 100.0, 2
        ),
    }


def make_comparison(rows):
    pad, label_h, gap = 24, 34, 20
    panel_w = max(max(left.width, right.width) for _, left, right in rows)
    total_w = pad * 2 + panel_w * 2 + gap
    total_h = pad + sum(label_h + max(left.height, right.height) + gap for _, left, right in rows)
    sheet = Image.new("RGB", (total_w, total_h), (18, 21, 25))
    draw = ImageDraw.Draw(sheet)
    y = pad
    for key, left, right in rows:
        draw.text((pad, y + 8), f"{key}  CURRENT", fill=(235, 239, 244))
        draw.text((pad + panel_w + gap, y + 8), f"{key}  -15% NOISE +15% SAT", fill=(235, 239, 244))
        y += label_h
        sheet.paste(left, (pad + (panel_w - left.width) // 2, y))
        sheet.paste(right, (pad + panel_w + gap + (panel_w - right.width) // 2, y))
        y += max(left.height, right.height) + gap
    sheet.save(OUT_DIR / "house_levels_final_denoise15_sat15_comparison.png")


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    rows = []
    records = []
    for key, display_w, display_h in LEVELS:
        source_path = SOURCE_DIR / f"house_{key}_denoised_saturated_2x.png"
        source = np.asarray(Image.open(source_path).convert("RGBA"))
        final, metrics = solve_refinement(source, (display_w, display_h))
        output_path = OUT_DIR / f"house_{key}_final_denoise15_sat15_2x.png"
        Image.fromarray(final, "RGBA").save(output_path)
        rows.append(
            (
                key.upper(),
                PIPELINE.runtime_panel(source, (display_w, display_h)),
                PIPELINE.runtime_panel(final, (display_w, display_h)),
            )
        )
        records.append(
            {
                "level": key,
                "source": str(source_path.relative_to(ROOT)).replace("\\", "/"),
                "output": str(output_path.relative_to(ROOT)).replace("\\", "/"),
                "outputSize": [final.shape[1], final.shape[0]],
                "runtimeSize": [display_w, display_h],
                "alphaPreservedExactly": bool(np.array_equal(source[..., 3], final[..., 3])),
                **metrics,
            }
        )
    make_comparison(rows)
    (OUT_DIR / "refine_manifest.json").write_text(
        json.dumps(
            {
                "mode": "deterministic-no-regeneration",
                "noiseTargetPercent": 15,
                "saturationFactor": SATURATION_FACTOR,
                "levels": records,
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"final refinement candidates -> {OUT_DIR}")


if __name__ == "__main__":
    main()
