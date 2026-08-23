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

import argparse
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
    "explorer_camp",
    "jungle_temple",
    "cavalry_school",
    "wheat_windmill",
    "market",
    "bakery",
    "portal",
    # 2026-08-19 墙壁/楼梯/门接入阴影系统
    "obstacle_block",
    "wall_stair_1x1_h",
    "wall_stair_1x1_v",
    "wall_stair_lower_e1_pos",
    "wall_stair_lower_e1_neg",
    "wall_stair_lower_e2_pos",
    "wall_stair_lower_e2_neg",
    "wall_stair_upper_e1_pos",
    "wall_stair_upper_e1_neg",
    "wall_stair_upper_e2_pos",
    "wall_stair_upper_e2_neg",
    "cover_gate_A",
    "cover_gate_B",
    "cover_gate_C",
    "cover_gate_D",
]

# 多帧 spritesheet 的剪影量测帧（cell 裁剪窗）：铁栅栏门 16 帧取关闭帧 0。
FRAME_CROPS = {
    "cover_gate_A": (0, 0, 640, 634),
    "cover_gate_B": (0, 0, 640, 634),
    "cover_gate_C": (0, 0, 640, 634),
    "cover_gate_D": (0, 0, 640, 634),
}


PROJECTION_BOTTOM_BANDS = {
    # 2026-08-19 审计修复：单层烘焙管线（四边形实心段+轮廓延长段）下禁用带状采样——
    # 带状图的内容贴向远端，延长段会与四边形实心段脱节成第二颗菱形（断裂）。
    # 旧旋转矩形时代用于 defense_base 的 0.20 配置已移除；新建筑一律 full-alpha。
}


def relative(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


def alpha_bbox(alpha: np.ndarray) -> tuple[int, int, int, int]:
    ys, xs = np.where(alpha > 0.02)
    if len(xs) == 0:
        return (0, 0, 0, 0)
    return (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)




def measure_shadow_silhouette(alpha: np.ndarray, bbox: tuple[int, int, int, int]) -> dict | None:
    """逐列剪影量测（2026-08-19 八轮：逐帧剪影多边形阴影的离线真源）。

    每列取最上/最下不透明像素（建筑均为 x 单调 billboard），最多 128 列；
    运行时把"接地曲线"（各列 bottomY）与"顶线"（各列 topY）按太阳方向逐帧
    展开成多边形——无烘焙、无分桶、连续，且根/远两条边全部贴图实测。
    frontX/frontY = 全图最低接地点（视觉脚底锚点）。
    """
    x0, y0, x1, y1 = bbox
    if x1 <= x0 or y1 <= y0:
        return None
    width = x1 - x0
    step = max(1, width // 128)
    cols = []
    front_x, front_y = None, -1
    for x in range(x0, x1, step):
        col = alpha[y0:y1, x]
        ys = np.where(col > 0.02)[0]
        if len(ys) == 0:
            continue
        top = y0 + int(ys.min())
        bottom = y0 + int(ys.max())
        cols.append([int(x), top, bottom])
        if bottom > front_y:
            front_y = bottom
            front_x = int(x)
    if len(cols) < 3 or front_x is None:
        return None
    return {"step": step, "frontX": front_x, "frontY": int(front_y), "columns": cols}


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
    旋转后必须按内容 bbox 紧身裁剪：底部带状采样（如 defense_base bottom-20%）
    会让内容只占长轴一小段，运行时按整图拉伸 displayLong 会把内容再压回
    建筑底下（晨昏长影被 footprint 吞没、正午贴影不可见的根因）。
    """
    source = alpha_img
    if bottom_band is not None:
        arr = np.asarray(alpha_img).copy()
        start_y = max(0, int(arr.shape[0] * (1.0 - bottom_band)))
        arr[:start_y, :] = 0
        source = Image.fromarray(arr, "L")
    rotated = source.transpose(Image.Transpose.ROTATE_270)
    softened = rotated.filter(ImageFilter.GaussianBlur(radius=0.9))
    # 内容紧身裁剪（羽化留 4px 边），保证投影长轴 100% 是有效影子内容。
    mask = np.asarray(softened, dtype=np.float32) / 255.0
    ys, xs = np.where(mask > 0.02)
    if len(xs) > 0:
        pad = 4
        x0 = max(0, int(xs.min()) - pad)
        y0 = max(0, int(ys.min()) - pad)
        x1 = min(softened.width, int(xs.max()) + 1 + pad)
        y1 = min(softened.height, int(ys.max()) + 1 + pad)
        softened = softened.crop((x0, y0, x1, y1))
    out = Image.new("RGBA", softened.size, (0, 0, 0, 0))
    out.putalpha(softened)
    return out


def build_asset(name: str, previous: dict | None = None) -> dict:
    source = TERRAIN / f"{name}.png"
    if not source.exists():
        raise FileNotFoundError(source)
    rgba = Image.open(source).convert("RGBA")
    crop = FRAME_CROPS.get(name)
    if crop is not None:
        rgba = rgba.crop(crop)
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

    bbox = alpha_bbox(np.asarray(alpha, dtype=np.float32) / 255.0)
    # 保留占位字段：建筑贴图替换回归测试（test-world122-building-layer-assets）
    # 断言 shadow.anchorMode 存在——阴影链已不消费它，仅作契约兼容。
    shadow = {"anchorMode": "footprint_center"}
    return {
        "source": relative(source),
        "silhouette": relative(silhouette_path),
        "projection": relative(projection_path),
        "height": relative(height_path),
        "normal": relative(normal_path),
        "size": {"width": rgba.width, "height": rgba.height},
        "alphaBBox": dict(zip(("x0", "y0", "x1", "y1"), bbox)),
        "shadowSilhouette": measure_shadow_silhouette(np.asarray(alpha, dtype=np.float32) / 255.0, bbox),
        "normalKind": "alpha-height-gradient",
        "shadow": shadow,
        "projectionSource": f"bottom-{int(PROJECTION_BOTTOM_BANDS[name] * 100)}%" if name in PROJECTION_BOTTOM_BANDS else "full-alpha",
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("assets", nargs="*", help="Optional asset names; omit to rebuild the full manifest")
    args = parser.parse_args()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    previous = {}
    if MANIFEST.exists():
        try:
            previous = json.loads(MANIFEST.read_text(encoding="utf-8")).get("assets") or {}
        except json.JSONDecodeError:
            previous = {}
    targets = args.assets or ASSETS
    unknown = [name for name in targets if name not in ASSETS]
    if unknown:
        raise SystemExit(f"unknown lighting assets: {', '.join(unknown)}")
    generated = dict(previous) if args.assets else {}
    for name in targets:
        generated[name] = build_asset(name, previous.get(name))
    MANIFEST.write_text(json.dumps({
        "version": 1,
        "comment": "透明贴图 alpha 提取的轮廓/高度/伪法线；footprint 仍由 ISO_WALL_GEO.foot 定义。",
        "assets": generated,
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"generated {len(targets)} lighting map sets in {OUT_DIR}")


if __name__ == "__main__":
    main()
