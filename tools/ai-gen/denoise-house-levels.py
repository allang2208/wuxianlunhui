#!/usr/bin/env python3
"""Create non-destructive, runtime-aware denoise previews for house levels.

The geometry and alpha channel are never regenerated.  RGB filtering is limited
to the opaque interior, then the result is premultiplied-alpha downsampled to
twice the configured runtime size to suppress high-frequency aliasing.
"""

from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "tools" / "ai-gen" / "_building_denoise_review_20260821"

LEVELS = (
    ("lv1", ROOT / "assets" / "terrain" / "house_lv1.png", 256, 294, 18.0, 0.68, 1.14),
    ("lv2", ROOT / "assets" / "terrain" / "house_lv2.png", 270, 309, 14.0, 0.52, 1.12),
    ("lv3", ROOT / "assets" / "terrain" / "house_lv3.png", 298, 335, 16.0, 0.52, 1.10),
)


def premultiplied_resize(rgba: np.ndarray, size: tuple[int, int]) -> np.ndarray:
    """Resize RGBA without leaking transparent RGB into visible edge pixels."""
    target_w, target_h = size
    alpha = rgba[..., 3:4].astype(np.float32) / 255.0
    premul = rgba[..., :3].astype(np.float32) * alpha
    premul_small = cv2.resize(premul, (target_w, target_h), interpolation=cv2.INTER_AREA)
    alpha_small = cv2.resize(alpha, (target_w, target_h), interpolation=cv2.INTER_AREA)
    if alpha_small.ndim == 2:
        alpha_small = alpha_small[..., None]
    rgb_small = np.divide(
        premul_small,
        np.maximum(alpha_small, 1.0 / 255.0),
        out=np.zeros_like(premul_small),
        where=alpha_small > 0,
    )
    out = np.concatenate((np.clip(rgb_small, 0, 255), np.clip(alpha_small * 255, 0, 255)), axis=2)
    return np.rint(out).astype(np.uint8)


def denoise_interior(rgba: np.ndarray, sigma_color: float, blend: float) -> np.ndarray:
    """Bilateral-filter opaque RGB while leaving silhouette pixels untouched."""
    rgb = rgba[..., :3]
    alpha = rgba[..., 3]
    filtered = cv2.bilateralFilter(rgb, d=5, sigmaColor=sigma_color, sigmaSpace=3.0)
    solid = (alpha >= 245).astype(np.uint8) * 255
    interior = cv2.erode(solid, np.ones((5, 5), np.uint8), iterations=1).astype(np.float32) / 255.0
    weight = (interior * blend)[..., None]
    mixed = np.rint(rgb.astype(np.float32) * (1.0 - weight) + filtered.astype(np.float32) * weight)
    out = rgba.copy()
    out[..., :3] = np.clip(mixed, 0, 255).astype(np.uint8)
    return out


def smooth_interior(rgba: np.ndarray, sigma: float, blend: float) -> np.ndarray:
    """Mix a small Gaussian low-pass into fully opaque pixels only."""
    rgb = rgba[..., :3]
    alpha = rgba[..., 3]
    filtered = cv2.GaussianBlur(rgb, (0, 0), sigmaX=sigma, sigmaY=sigma)
    solid = (alpha >= 245).astype(np.uint8) * 255
    interior = cv2.erode(solid, np.ones((5, 5), np.uint8), iterations=1).astype(np.float32) / 255.0
    weight = (interior * blend)[..., None]
    mixed = np.rint(rgb.astype(np.float32) * (1.0 - weight) + filtered.astype(np.float32) * weight)
    out = rgba.copy()
    out[..., :3] = np.clip(mixed, 0, 255).astype(np.uint8)
    return out


def boost_saturation(rgba: np.ndarray, factor: float) -> np.ndarray:
    """Raise saturation while protecting bright lantern/window highlights."""
    hsv = cv2.cvtColor(rgba[..., :3], cv2.COLOR_RGB2HSV).astype(np.float32)
    saturation = hsv[..., 1]
    value = hsv[..., 2]
    highlight_protection = 1.0 - 0.45 * np.clip((value - 210.0) / 45.0, 0.0, 1.0)
    effective_factor = 1.0 + (factor - 1.0) * highlight_protection
    hsv[..., 1] = np.clip(saturation * effective_factor, 0.0, 255.0)
    out = rgba.copy()
    out[..., :3] = cv2.cvtColor(np.rint(hsv).astype(np.uint8), cv2.COLOR_HSV2RGB)
    return out


def checker(size: tuple[int, int], cell: int = 24) -> Image.Image:
    canvas = Image.new("RGBA", size, (37, 43, 50, 255))
    draw = ImageDraw.Draw(canvas)
    for y in range(0, size[1], cell):
        for x in range(0, size[0], cell):
            color = (51, 59, 68, 255) if (x // cell + y // cell) % 2 == 0 else (29, 34, 40, 255)
            draw.rectangle((x, y, min(x + cell - 1, size[0] - 1), min(y + cell - 1, size[1] - 1)), fill=color)
    return canvas


def runtime_panel(rgba: np.ndarray, runtime_size: tuple[int, int], zoom: int = 2) -> Image.Image:
    runtime = premultiplied_resize(rgba, runtime_size)
    image = Image.fromarray(runtime, "RGBA").resize(
        (runtime_size[0] * zoom, runtime_size[1] * zoom), Image.Resampling.NEAREST
    )
    bg = checker(image.size, cell=32)
    bg.alpha_composite(image)
    return bg.convert("RGB")


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    rows = []
    saturation_rows = []
    manifest = []
    for key, src, display_w, display_h, sigma_color, blend, saturation_factor in LEVELS:
        original = np.asarray(Image.open(src).convert("RGBA"))
        filtered = denoise_interior(original, sigma_color, blend)
        target = (display_w * 2, display_h * 2)
        candidate = premultiplied_resize(filtered, target)
        if key == "lv3":
            candidate = smooth_interior(candidate, sigma=0.65, blend=0.28)
        candidate_path = OUT_DIR / f"house_{key}_denoised_2x.png"
        Image.fromarray(candidate, "RGBA").save(candidate_path)
        saturated = boost_saturation(candidate, saturation_factor)
        saturated_path = OUT_DIR / f"house_{key}_denoised_saturated_2x.png"
        Image.fromarray(saturated, "RGBA").save(saturated_path)

        original_panel = runtime_panel(original, (display_w, display_h))
        denoised_panel = runtime_panel(candidate, (display_w, display_h))
        saturated_panel = runtime_panel(saturated, (display_w, display_h))
        rows.append((key.upper(), original_panel, denoised_panel))
        saturation_rows.append((key.upper(), denoised_panel, saturated_panel))
        manifest.append(
            {
                "level": key,
                "source": str(src.relative_to(ROOT)).replace("\\", "/"),
                "output": str(candidate_path.relative_to(ROOT)).replace("\\", "/"),
                "saturatedOutput": str(saturated_path.relative_to(ROOT)).replace("\\", "/"),
                "sourceSize": list(Image.open(src).size),
                "outputSize": list(target),
                "runtimeSize": [display_w, display_h],
                "sigmaColor": sigma_color,
                "blend": blend,
                "saturationFactor": saturation_factor,
            }
        )

    pad = 24
    label_h = 34
    gap = 20
    panel_w = max(max(left.width, right.width) for _, left, right in rows)
    total_w = pad * 2 + panel_w * 2 + gap
    total_h = pad + sum(label_h + max(left.height, right.height) + gap for _, left, right in rows)
    sheet = Image.new("RGB", (total_w, total_h), (18, 21, 25))
    draw = ImageDraw.Draw(sheet)
    y = pad
    for key, left, right in rows:
        draw.text((pad, y + 8), f"{key}  ORIGINAL", fill=(235, 239, 244))
        draw.text((pad + panel_w + gap, y + 8), f"{key}  DENOISED", fill=(235, 239, 244))
        y += label_h
        sheet.paste(left, (pad + (panel_w - left.width) // 2, y))
        sheet.paste(right, (pad + panel_w + gap + (panel_w - right.width) // 2, y))
        y += max(left.height, right.height) + gap
    sheet.save(OUT_DIR / "house_levels_denoise_comparison.png")

    saturation_sheet = Image.new("RGB", (total_w, total_h), (18, 21, 25))
    draw = ImageDraw.Draw(saturation_sheet)
    y = pad
    for key, left, right in saturation_rows:
        draw.text((pad, y + 8), f"{key}  DENOISED", fill=(235, 239, 244))
        draw.text((pad + panel_w + gap, y + 8), f"{key}  DENOISED + SATURATION", fill=(235, 239, 244))
        y += label_h
        saturation_sheet.paste(left, (pad + (panel_w - left.width) // 2, y))
        saturation_sheet.paste(right, (pad + panel_w + gap + (panel_w - right.width) // 2, y))
        y += max(left.height, right.height) + gap
    saturation_sheet.save(OUT_DIR / "house_levels_saturation_comparison.png")

    import json

    (OUT_DIR / "denoise_manifest.json").write_text(
        json.dumps({"mode": "deterministic-no-regeneration", "levels": manifest}, indent=2),
        encoding="utf-8",
    )
    print(f"denoise candidates and comparison -> {OUT_DIR}")


if __name__ == "__main__":
    main()
