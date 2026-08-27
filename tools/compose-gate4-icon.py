#!/usr/bin/env python3
"""用游戏实际关闭帧与五档方块墙合成4格门面板图标。"""

from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
TERRAIN = ROOT / "assets" / "terrain"
THUMBNAILS = ROOT / "assets" / "ui" / "building-thumbnails"
PREVIEW_OUT = ROOT / "tools" / "ai-gen" / "_wall_tiers_20260825" / "gate_tier_contact.png"

# 与 defense-system.js / building-system.js 的实际预览参数一致。
BLOCK_DISPLAY = (260, 259)
BLOCK_FOOT_OFFSET_Y = 61
GATE_FRAME = (640, 634)
GATE_BAR_CROP = (174, 0, 467, 634)
GATE_SCALE_X = 0.437
GATE_SCALE_Y = 0.5
GATE_FOOT_OFFSET_Y = 83
ICON_MARGIN = 12
THUMBNAIL_SIZE = (128, 64)
THUMBNAIL_PADDING = 3
WALL_TIERS = {
    "sand": "obstacle_block_sand.png",
    "brick": "obstacle_block_brick.png",
    "black_brick": "obstacle_block.png",
    "concrete": "obstacle_block_concrete.png",
    "rune": "obstacle_block_rune.png",
}


def paste_center(canvas: Image.Image, layer: Image.Image, cx: float, cy: float) -> None:
    x = round(cx - layer.width / 2)
    y = round(cy - layer.height / 2)
    canvas.alpha_composite(layer, (x, y))


def alpha_bounds(image: Image.Image, threshold: int = 8) -> tuple[int, int, int, int]:
    alpha = image.getchannel("A")
    bbox = alpha.point(lambda value: 255 if value > threshold else 0).getbbox()
    if not bbox:
        raise RuntimeError("4格门合成结果为空")
    return bbox


def make_thumbnail(image: Image.Image) -> Image.Image:
    crop = image.crop(alpha_bounds(image))
    inner_w = THUMBNAIL_SIZE[0] - THUMBNAIL_PADDING * 2
    inner_h = THUMBNAIL_SIZE[1] - THUMBNAIL_PADDING * 2
    scale = min(inner_w / crop.width, inner_h / crop.height)
    resized = crop.resize(
        (max(1, round(crop.width * scale)), max(1, round(crop.height * scale))),
        Image.Resampling.LANCZOS,
    )
    canvas = Image.new("RGBA", THUMBNAIL_SIZE, (0, 0, 0, 0))
    canvas.alpha_composite(
        resized,
        ((THUMBNAIL_SIZE[0] - resized.width) // 2,
         (THUMBNAIL_SIZE[1] - resized.height) // 2),
    )
    return canvas


def compose_gate(block_path: Path, bars: Image.Image) -> Image.Image:
    block = Image.open(block_path).convert("RGBA")
    block = block.resize(BLOCK_DISPLAY, Image.Resampling.LANCZOS)

    # 默认 e2：四格中心 t=-1.5/+1.5 分别是 (96,-48) / (-96,48)。
    # 实际预览深度：后柱 → 关闭栅栏 → 前柱。
    origin_x, origin_y = 420, 360
    canvas = Image.new("RGBA", (840, 720), (0, 0, 0, 0))
    paste_center(canvas, block, origin_x + 96, origin_y - 48 - BLOCK_FOOT_OFFSET_Y)
    paste_center(canvas, bars, origin_x, origin_y - GATE_FOOT_OFFSET_Y)
    paste_center(canvas, block, origin_x - 96, origin_y + 48 - BLOCK_FOOT_OFFSET_Y)

    # 保持旧面板图的任意非零 alpha 裁边口径，避免不同墙材让整图画布抖动。
    bbox = canvas.getbbox()
    if not bbox:
        raise RuntimeError("4格门关闭帧合成结果为空")
    left = max(0, bbox[0] - ICON_MARGIN)
    top = max(0, bbox[1] - ICON_MARGIN)
    right = min(canvas.width, bbox[2] + ICON_MARGIN)
    bottom = min(canvas.height, bbox[3] + ICON_MARGIN)
    return canvas.crop((left, top, right, bottom))


def main() -> None:
    bars_sheet = Image.open(TERRAIN / "cover_gate_D_bars.png").convert("RGBA")
    # frame 0 是静止关闭状态。保留完整帧坐标，只显示游戏 barCrop 窗口，
    # 这样缩放后的原点/位置与 Phaser setCrop + setScale 完全一致。
    frame0 = bars_sheet.crop((0, 0, GATE_FRAME[0], GATE_FRAME[1]))
    cropped_frame = Image.new("RGBA", GATE_FRAME, (0, 0, 0, 0))
    cropped_frame.alpha_composite(
        frame0.crop(GATE_BAR_CROP),
        (GATE_BAR_CROP[0], GATE_BAR_CROP[1]),
    )
    bars = cropped_frame.resize(
        (round(GATE_FRAME[0] * GATE_SCALE_X), round(GATE_FRAME[1] * GATE_SCALE_Y)),
        Image.Resampling.LANCZOS,
    )

    THUMBNAILS.mkdir(parents=True, exist_ok=True)
    icons = {}
    for tier, wall_filename in WALL_TIERS.items():
        icon = compose_gate(TERRAIN / wall_filename, bars)
        icons[tier] = icon
        terrain_out = TERRAIN / f"gate_4cell_{tier}.png"
        thumbnail_out = THUMBNAILS / f"gate_4cell_{tier}.png"
        icon.save(terrain_out, optimize=True)
        make_thumbnail(icon).save(thumbnail_out, optimize=True)
        print(
            f"saved {terrain_out} size={icon.width}x{icon.height} "
            f"thumbnail={thumbnail_out} frame=0(closed)"
        )

    # 无科技/旧路径统一以一级沙墙为兜底，防止旧黑砖图回流建筑面板。
    icons["sand"].save(TERRAIN / "gate_4cell.png", optimize=True)
    make_thumbnail(icons["sand"]).save(THUMBNAILS / "gate_4cell.png", optimize=True)

    contact = Image.new("RGBA", (len(WALL_TIERS) * 344, 324), (0, 0, 0, 0))
    for index, tier in enumerate(WALL_TIERS):
        contact.alpha_composite(icons[tier], (index * 344, 0))
    PREVIEW_OUT.parent.mkdir(parents=True, exist_ok=True)
    contact.save(PREVIEW_OUT, optimize=True)
    print(f"saved preview {PREVIEW_OUT} size={contact.width}x{contact.height}")


if __name__ == "__main__":
    main()
