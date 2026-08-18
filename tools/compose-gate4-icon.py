#!/usr/bin/env python3
"""用游戏实际关闭帧与两端方块墙合成4格门面板图标。"""

from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
TERRAIN = ROOT / "assets" / "terrain"

# 与 defense-system.js / building-system.js 的实际预览参数一致。
BLOCK_DISPLAY = (260, 259)
BLOCK_FOOT_OFFSET_Y = 61
GATE_FRAME = (640, 634)
GATE_BAR_CROP = (174, 0, 467, 634)
GATE_SCALE_X = 0.437
GATE_SCALE_Y = 0.5
GATE_FOOT_OFFSET_Y = 83
ICON_MARGIN = 12


def paste_center(canvas: Image.Image, layer: Image.Image, cx: float, cy: float) -> None:
    x = round(cx - layer.width / 2)
    y = round(cy - layer.height / 2)
    canvas.alpha_composite(layer, (x, y))


def main() -> None:
    block = Image.open(TERRAIN / "obstacle_block.png").convert("RGBA")
    block = block.resize(BLOCK_DISPLAY, Image.Resampling.LANCZOS)

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

    # 默认 e2：四格中心 t=-1.5/+1.5 分别是 (96,-48) / (-96,48)。
    # 实际预览深度：后柱 → 关闭栅栏 → 前柱。
    origin_x, origin_y = 420, 360
    canvas = Image.new("RGBA", (840, 720), (0, 0, 0, 0))
    paste_center(canvas, block, origin_x + 96, origin_y - 48 - BLOCK_FOOT_OFFSET_Y)
    paste_center(canvas, bars, origin_x, origin_y - GATE_FOOT_OFFSET_Y)
    paste_center(canvas, block, origin_x - 96, origin_y + 48 - BLOCK_FOOT_OFFSET_Y)

    bbox = canvas.getbbox()
    if not bbox:
        raise RuntimeError("4格门关闭帧合成结果为空")
    left = max(0, bbox[0] - ICON_MARGIN)
    top = max(0, bbox[1] - ICON_MARGIN)
    right = min(canvas.width, bbox[2] + ICON_MARGIN)
    bottom = min(canvas.height, bbox[3] + ICON_MARGIN)
    icon = canvas.crop((left, top, right, bottom))
    out = TERRAIN / "gate_4cell.png"
    icon.save(out, optimize=True)
    print(f"saved {out} size={icon.width}x{icon.height} frame=0(closed)")


if __name__ == "__main__":
    main()
