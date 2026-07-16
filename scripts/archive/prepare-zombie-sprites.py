# -*- coding: utf-8 -*-
"""一次性脚本：将僵尸素材整理为项目标准 512x512 帧 sheet。

源素材（E:\\无尽轮回\\游戏\\素材库\\怪物\\僵尸）：
  - idle.png      1024x1024 单帧整图
  - walking.png   4096x2048，8列x4行 512x512 格，15 有效帧
  - attacking.png 4096x2048，8列x4行 512x512 格，15 有效帧

输出（assets/enemies/zombie/）：
  - idle.png / walking.png / attacking.png
  统一 8列x4行 512x512 布局；内容统一高度约 440px（hRatio≈0.86，
  与 fat_zombie/spitter_zombie/zombie_wizard 现有素材一致）；
  水平居中，底部对齐 y=496（底部留白 16px，参照 fat_zombie）。
"""
from PIL import Image
import os

SRC = r"E:\无尽轮回\游戏\素材库\怪物\僵尸"
DST = r"E:\无尽轮回\长期备份\2026-7-13-1\game-dev\assets\enemies\zombie"
FRAME = 512
COLS, ROWS = 8, 4
TARGET_H = 440.0
MAX_W = 500.0
BOTTOM_Y = 496  # 内容底部在帧内的 y 坐标


def content_bbox(img):
    return img.getchannel("A").getbbox()


def process_sheet(src_path, dst_path, max_frames, scale):
    im = Image.open(src_path).convert("RGBA")
    out = Image.new("RGBA", (FRAME * COLS, FRAME * ROWS), (0, 0, 0, 0))
    placed = 0
    for i in range(max_frames):
        r, c = divmod(i, COLS)
        cell = im.crop((c * FRAME, r * FRAME, (c + 1) * FRAME, (r + 1) * FRAME))
        b = content_bbox(cell)
        if not b or (b[2] - b[0]) <= 5 or (b[3] - b[1]) <= 5:
            continue
        content = cell.crop(b)
        nw = max(1, int(round(content.width * scale)))
        nh = max(1, int(round(content.height * scale)))
        scaled = content.resize((nw, nh), Image.LANCZOS)
        dx = c * FRAME + (FRAME - nw) // 2
        dy = r * FRAME + (BOTTOM_Y - nh)
        out.paste(scaled, (dx, dy), scaled)
        placed += 1
    out.save(dst_path, format="PNG")
    print(f"[ok] {os.path.basename(dst_path)}: {placed} frames, scale={scale:.4f}")


def main():
    os.makedirs(DST, exist_ok=True)

    # idle：1024x1024 单帧 → 缩到 440 高，放入 8x4 sheet 的 (0,0) 格
    idle = Image.open(os.path.join(SRC, "idle.png")).convert("RGBA")
    b = content_bbox(idle)
    content = idle.crop(b)
    scale = TARGET_H / content.height
    nw, nh = int(round(content.width * scale)), int(round(content.height * scale))
    sheet = Image.new("RGBA", (FRAME * COLS, FRAME * ROWS), (0, 0, 0, 0))
    scaled = content.resize((nw, nh), Image.LANCZOS)
    sheet.paste(scaled, ((FRAME - nw) // 2, BOTTOM_Y - nh), scaled)
    sheet.save(os.path.join(DST, "idle.png"), format="PNG")
    print(f"[ok] idle.png: 1 frame, scale={scale:.4f}, content {nw}x{nh}")

    # walking：15 帧，统一放大到 440 高
    walk_scale = TARGET_H / 275.0  # 275 = 素材中最高帧内容高度
    process_sheet(os.path.join(SRC, "walking.png"),
                  os.path.join(DST, "walking.png"), 15, walk_scale)

    # attacking：15 帧，高度放大受最宽帧 319px 限制（<=500px）
    atk_scale = min(TARGET_H / 274.0, MAX_W / 319.0)
    process_sheet(os.path.join(SRC, "attacking.png"),
                  os.path.join(DST, "attacking.png"), 15, atk_scale)


if __name__ == "__main__":
    main()
