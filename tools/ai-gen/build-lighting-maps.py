#!/usr/bin/env python3
"""从透明 PNG 提取环境光照派生数据。

首批目标：世界-122 仙人掌、世界-123 雪松。
输出（均为非破坏性 sibling 资产）：
  - *_silhouette.png：原 alpha 轮廓遮罩，供真实轮廓投影使用；
  - *_projection.png：把立体轮廓旋到影子本地长轴后的预投影遮罩；
  - *_height.png：由 alpha + 自下而上高度构成的保守高度近似；
  - *_normal.png：高度图梯度编码的切线空间伪法线。

这不是 Blender 高模烘焙法线；它的目标是在现有 billboard 贴图上提供稳定、
不改变轮廓的局部受光近似。地面 footprint 仍以 ISO_WALL_GEO.foot 为唯一真源。
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter


ROOT = Path(__file__).resolve().parents[2]
TERRAIN = ROOT / "assets" / "terrain"
OUT_DIR = TERRAIN / "lighting"
MANIFEST = ROOT / "data" / "environment-lighting-assets.json"

ASSETS = [
    "obstacle_cactus_barrel",
    "obstacle_cactus_cholla",
    "obstacle_cactus_saguaro1arm",
    "obstacle_cactus_saguaro2arm",
    "obstacle_snow_pine_01",
    "obstacle_snow_pine_02",
    "obstacle_snow_pine_03",
    "obstacle_snow_pine_04",
    "obstacle_snow_pine_05",
    "defense_base",
    "obstacle_defense_tower",
    "barracks",
    "mine",
    "blacksmith",
    "church",
    "research_institute",
    "warehouse",
    "shooting_range",
    "thatch_hut",
    "portal",
]

SHADOW_OVERRIDES = {
    "defense_base": {
        "anchorMode": "footprint_center",
        "anchorInsetX": 120,
        "anchorInsetY": -120,
    },
    "obstacle_cactus_barrel": {
        "anchorMode": "footprint_center",
        "anchorInsetX": 0,
        "anchorInsetY": 0,
    },
}

PROJECTION_BOTTOM_BANDS = {
    # 基地投影只使用扁平大理石底座；投完整立方体/顶盖会产生不可信的大块阴影。
    "defense_base": 0.20,
}


def relative(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


def alpha_bbox(alpha: np.ndarray) -> tuple[int, int, int, int]:
    ys, xs = np.where(alpha > 0.02)
    if len(xs) == 0:
        return (0, 0, 0, 0)
    return (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)


def make_height(alpha_img: Image.Image) -> Image.Image:
    """让遮罩底部为低、顶部为高，并以轻度模糊避免法线边缘锯齿。"""
    alpha = np.asarray(alpha_img, dtype=np.float32) / 255.0
    h, _w = alpha.shape
    y = np.linspace(1.0, 0.0, h, dtype=np.float32)[:, None]
    # 接地处保留少量厚度，上部逐渐升高；透明区域必须恒为 0。
    height = alpha * (0.18 + y * 0.82)
    height_img = Image.fromarray(np.uint8(np.clip(height * 255.0, 0, 255)), "L")
    return height_img.filter(ImageFilter.GaussianBlur(radius=1.2))


def make_normal(height_img: Image.Image, alpha_img: Image.Image) -> Image.Image:
    height = np.asarray(height_img, dtype=np.float32) / 255.0
    alpha = np.asarray(alpha_img, dtype=np.float32) / 255.0
    gy, gx = np.gradient(height)
    # 透明边缘的高度变化最强，降低倍数避免出现过亮的硬边。
    strength = 3.2
    nx = -gx * strength
    ny = -gy * strength
    nz = np.ones_like(height)
    length = np.sqrt(nx * nx + ny * ny + nz * nz)
    nx, ny, nz = nx / length, ny / length, nz / length
    rgb = np.stack([
        (nx * 0.5 + 0.5) * 255.0,
        (ny * 0.5 + 0.5) * 255.0,
        (nz * 0.5 + 0.5) * 255.0,
    ], axis=-1)
    rgba = np.concatenate([
        np.uint8(np.clip(rgb, 0, 255)),
        np.uint8(np.clip(alpha[..., None] * 255.0, 0, 255)),
    ], axis=-1)
    return Image.fromarray(rgba, "RGBA")


def make_silhouette(alpha_img: Image.Image) -> Image.Image:
    out = Image.new("RGBA", alpha_img.size, (0, 0, 0, 0))
    out.putalpha(alpha_img)
    return out


def make_projection(alpha_img: Image.Image, bottom_band: float | None = None) -> Image.Image:
    """把竖直 billboard 轮廓转为沿本地 X 轴延展的影子遮罩。

    运行时只需按太阳方向旋转，不会再把原始竖向角色/植物轮廓压成极细横线。
    轻度羽化保留轮廓，又避免投影边缘像硬切纸片。
    """
    source = alpha_img
    if bottom_band is not None:
        arr = np.asarray(alpha_img).copy()
        start_y = max(0, int(arr.shape[0] * (1.0 - bottom_band)))
        arr[:start_y, :] = 0
        source = Image.fromarray(arr, "L")
    rotated = source.transpose(Image.Transpose.ROTATE_270)
    softened = rotated.filter(ImageFilter.GaussianBlur(radius=0.9))
    out = Image.new("RGBA", softened.size, (0, 0, 0, 0))
    out.putalpha(softened)
    return out


def build_asset(name: str, previous: dict | None = None) -> dict:
    source = TERRAIN / f"{name}.png"
    if not source.exists():
        raise FileNotFoundError(source)
    rgba = Image.open(source).convert("RGBA")
    alpha = rgba.getchannel("A")
    height = make_height(alpha)
    normal = make_normal(height, alpha)
    silhouette = make_silhouette(alpha)
    projection = make_projection(alpha, PROJECTION_BOTTOM_BANDS.get(name))

    silhouette_path = OUT_DIR / f"{name}_silhouette.png"
    projection_path = OUT_DIR / f"{name}_projection.png"
    height_path = OUT_DIR / f"{name}_height.png"
    normal_path = OUT_DIR / f"{name}_normal.png"
    silhouette.save(silhouette_path)
    projection.save(projection_path)
    height.save(height_path)
    normal.save(normal_path)

    shadow = dict((previous or {}).get("shadow") or {})
    shadow.setdefault("anchorMode", "footprint_center")
    shadow.update(SHADOW_OVERRIDES.get(name, {}))
    return {
        "source": relative(source),
        "silhouette": relative(silhouette_path),
        "projection": relative(projection_path),
        "height": relative(height_path),
        "normal": relative(normal_path),
        "size": {"width": rgba.width, "height": rgba.height},
        "alphaBBox": dict(zip(("x0", "y0", "x1", "y1"), alpha_bbox(np.asarray(alpha, dtype=np.float32) / 255.0))),
        "normalKind": "alpha-height-gradient",
        "projectionSource": f"bottom-{int(PROJECTION_BOTTOM_BANDS[name] * 100)}%" if name in PROJECTION_BOTTOM_BANDS else "full-alpha",
        "shadow": shadow,
    }


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    previous = {}
    if MANIFEST.exists():
        try:
            previous = json.loads(MANIFEST.read_text(encoding="utf-8")).get("assets") or {}
        except json.JSONDecodeError:
            previous = {}
    generated = {name: build_asset(name, previous.get(name)) for name in ASSETS}
    MANIFEST.write_text(json.dumps({
        "version": 1,
        "comment": "透明贴图 alpha 提取的轮廓/高度/伪法线；footprint 仍由 ISO_WALL_GEO.foot 定义。",
        "assets": generated,
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"generated {len(generated)} lighting map sets in {OUT_DIR}")


if __name__ == "__main__":
    main()
