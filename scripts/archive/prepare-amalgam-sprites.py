# -*- coding: utf-8 -*-
"""一次性脚本：将集合体素材整理为项目标准 512x512 帧 sheet（4.8 处理 = 内容统一 480px 高）。

源素材（E:\\无尽轮回\\游戏\\素材库\\怪物\\集合体），均为 4096x2048（8列x4行 512x512 格）：
  - idle.png        14 帧（待机）
  - attacking.png   32 帧（攻击状态二：砸地）
  - attacking-2.png 25 帧（攻击状态一：投掷）
  - melting.png     28 帧（死亡）

输出（assets/enemies/amalgam/）：同名 8x4 sheet
  内容统一高度约 480px（比现有僵尸素材 440 更高，体现首领体型）；
  宽度受 500px 上限约束；水平居中，底部对齐 y=496（与 fat_zombie 等一致）。
"""
from PIL import Image
import os

SRC = r"E:\无尽轮回\游戏\素材库\怪物\集合体"
DST = r"E:\无尽轮回\长期备份\2026-7-13-1\game-dev\assets\enemies\amalgam"
FRAME = 512
COLS, ROWS = 8, 4
TARGET_H = 480.0   # 4.8 处理：内容统一 480px
MAX_W = 500.0
BOTTOM_Y = 496     # 内容底部在帧内的 y 坐标

SHEETS = ["idle.png", "attacking.png", "attacking-2.png", "melting.png"]


def content_bbox(img):
    return img.getchannel("A").getbbox()


def iter_cells(im):
    for i in range(COLS * ROWS):
        r, c = divmod(i, COLS)
        cell = im.crop((c * FRAME, r * FRAME, (c + 1) * FRAME, (r + 1) * FRAME))
        b = content_bbox(cell)
        if not b or (b[2] - b[0]) <= 5 or (b[3] - b[1]) <= 5:
            continue
        yield i, cell, b


def process_sheet(name):
    im = Image.open(os.path.join(SRC, name)).convert("RGBA")
    frames = list(iter_cells(im))
    if not frames:
        print(f"[skip] {name}: 无有效帧")
        return
    max_h = max(b[3] - b[1] for _, _, b in frames)
    max_w = max(b[2] - b[0] for _, _, b in frames)
    scale = min(TARGET_H / max_h, MAX_W / max_w)

    out = Image.new("RGBA", (FRAME * COLS, FRAME * ROWS), (0, 0, 0, 0))
    for i, cell, b in frames:
        r, c = divmod(i, COLS)
        content = cell.crop(b)
        nw = max(1, int(round(content.width * scale)))
        nh = max(1, int(round(content.height * scale)))
        scaled = content.resize((nw, nh), Image.LANCZOS)
        dx = c * FRAME + (FRAME - nw) // 2
        dy = r * FRAME + (BOTTOM_Y - nh)
        out.paste(scaled, (dx, dy), scaled)
    out.save(os.path.join(DST, name), format="PNG")
    print(f"[ok] {name}: {len(frames)} frames, scale={scale:.4f}, "
          f"maxContent {max_w}x{max_h} -> {int(round(max_w*scale))}x{int(round(max_h*scale))}")


def main():
    os.makedirs(DST, exist_ok=True)
    for name in SHEETS:
        process_sheet(name)


if __name__ == "__main__":
    main()
