"""Create alpha-locked shadow-softening candidates for the approved hub texture."""

from __future__ import annotations

import json
import hashlib
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
SOURCE = HERE / "interplane_research_hub_before_shadow.png"


def smoothstep(edge0: float, edge1: float, value: np.ndarray) -> np.ndarray:
    t = np.clip((value - edge0) / (edge1 - edge0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def soften(source: Image.Image, amount: float) -> tuple[Image.Image, dict]:
    rgba = np.asarray(source.convert("RGBA"), dtype=np.uint8)
    rgb = rgba[..., :3].astype(np.float32) / 255.0
    alpha = rgba[..., 3]

    # Work from a broad illumination estimate so stone joints, window recesses,
    # railings and contact edges retain their original high-frequency contrast.
    luma = (rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722)
    base = np.asarray(
        Image.fromarray(np.round(luma * 255.0).astype(np.uint8)).filter(
            ImageFilter.GaussianBlur(radius=18)
        ),
        dtype=np.float32,
    ) / 255.0

    # Do not open the deepest door/window cavities and do not touch highlights.
    shadow_band = smoothstep(0.055, 0.16, base) * (1.0 - smoothstep(0.46, 0.72, base))
    maximum = rgb.max(axis=2)
    minimum = rgb.min(axis=2)
    saturation = np.divide(maximum - minimum, np.maximum(maximum, 1e-4))
    material_weight = 1.0 - 0.32 * np.clip(saturation, 0.0, 1.0)
    opaque_weight = smoothstep(0.02, 0.65, alpha.astype(np.float32) / 255.0)
    weight = shadow_band * material_weight * opaque_weight

    target_luma = np.clip(luma + amount * weight * (1.0 - luma), 0.0, 1.0)
    gain = np.divide(target_luma, np.maximum(luma, 0.025))
    gain = np.clip(gain, 1.0, 1.42)
    corrected = np.clip(rgb * gain[..., None], 0.0, 1.0)

    out = np.empty_like(rgba)
    out[..., :3] = np.round(corrected * 255.0).astype(np.uint8)
    out[..., 3] = alpha
    out[alpha == 0, :3] = 0

    changed = np.any(out[..., :3] != rgba[..., :3], axis=2) & (alpha > 0)
    report = {
        "amount": amount,
        "sourceSize": list(source.size),
        "alphaExact": bool(np.array_equal(out[..., 3], alpha)),
        "changedOpaquePixels": int(np.count_nonzero(changed)),
        "meanOpaqueLumaBefore": float(luma[alpha > 0].mean()),
        "meanOpaqueLumaAfter": float(target_luma[alpha > 0].mean()),
        "transparentPixelsWithDirtyRgb": int(
            np.count_nonzero((out[..., 3] == 0) & np.any(out[..., :3] != 0, axis=2))
        ),
    }
    return Image.fromarray(out, "RGBA"), report


def checker(size: tuple[int, int], cell: int = 24) -> Image.Image:
    yy, xx = np.indices((size[1], size[0]))
    grid = np.where(
        ((xx // cell + yy // cell) % 2)[..., None],
        [172, 178, 181],
        [214, 218, 219],
    ).astype(np.uint8)
    return Image.fromarray(grid).convert("RGBA")


def composite(image: Image.Image) -> Image.Image:
    canvas = checker(image.size)
    canvas.alpha_composite(image)
    return canvas.convert("RGB")


def font(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", size)


def main() -> None:
    source = Image.open(SOURCE).convert("RGBA")
    amounts = {"light": 0.07, "medium": 0.105, "strong": 0.14}
    outputs: dict[str, Image.Image] = {"before": source}
    reports = {}
    for name, amount in amounts.items():
        output, report = soften(source, amount)
        output.save(HERE / f"interplane_research_hub_shadow_tone_{name}.png")
        outputs[name] = output
        reports[name] = report

    board = Image.new("RGB", (1460, 1460), "#e8eae6")
    draw = ImageDraw.Draw(board)
    draw.text((24, 16), "跨位面中枢 · 原Alpha冻结减影对照", font=font(28), fill="#303b38")
    labels = {
        "before": "处理前",
        "light": "轻度 7%",
        "medium": "中度 10.5%",
        "strong": "较强 14%",
    }
    for index, key in enumerate(["before", "light", "medium", "strong"]):
        x = 24 + (index % 2) * 718
        y = 66 + (index // 2) * 680
        draw.text((x, y), labels[key], font=font(23), fill="#303b38")
        preview = composite(outputs[key])
        preview.thumbnail((680, 620), Image.Resampling.LANCZOS)
        board.paste(preview, (x, y + 42))
    draw.text(
        (24, 1424),
        "只抬升低频暗面；Alpha、轮廓、地台、门窗、楼层和接地角均逐像素不变。",
        font=font(18),
        fill="#47514d",
    )
    board.save(HERE / "shadow_tone_candidates.png")
    (HERE / "tone-shadow-report.json").write_text(
        json.dumps(
            {
                "source": SOURCE.relative_to(ROOT).as_posix(),
                "method": "alpha-locked low-frequency luma lift",
                "candidates": reports,
                "selected": "interplane_research_hub_shadow_tone_strong.png",
                "selectedSha256": hashlib.sha256(
                    (HERE / "interplane_research_hub_shadow_tone_strong.png").read_bytes()
                ).hexdigest().upper(),
                "runtimeAsset": "assets/terrain/interplane_research_hub.png",
                "runtimeIntegrated": True,
                "runtimeTested": False,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
