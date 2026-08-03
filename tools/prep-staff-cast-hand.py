# -*- coding: utf-8 -*-
"""
staff_cast 手部分层生成（2026-08-03，法杖施法贴手）

把 staff_cast.png 里「法杖手（画面右侧/前推施法手）」的拳头逐帧裁剪成独立 hand 层，
身体层（staff_cast_body）挖掉拳头区域，武器贴图渲染在 body 与 hand 之间，
视觉上"手握法杖"（与 walk_handLayer 同机制）。

2026-08-03 修订：施法手势是"前推"——双手从腰侧抬起，右手（画面右侧）向前伸出发力。
手层裁剪**前伸手**拳头；staffCastFrames 轨迹为**设计插值**（非手部质心逐帧）：
f0 = idle 持械位（左手腰侧，rotation 105）→ f8 = 前伸手举杖位（rotation 20，用户拍板），
中间线性插值——idle↔cast 零跳变、全程不换手跳变。

用法：
    python tools/prep-staff-cast-hand.py [--out-dir assets/player]

输出：
    assets/player/staff_cast_body.png  （身体层：挖掉拳头窗口像素）
    assets/player/staff_cast_hand.png  （手层：仅拳头窗口像素，同网格）

拳头窗口（texture px，帧序号 0~8 与 staff_cast 帧序一致）：
    f0~f2 拳头在腰侧（贴近左腿上方），f3 摆到肩高，f4~f8 抬到胸口。
验证：body+hand 逐像素合成 = 原图（窗口内无损），并打印每帧手层 bbox。
"""

import os
import sys

from PIL import Image

FRAME_W = 512
FRAME_H = 512
COLS = 8
FRAMES = 9

# (x0, y0, x1, y1) —— 每帧**前伸手**拳头所在窗口（2026-08-03 数值列轮廓实测）：
#   f0~f4 在腰侧 (325~339, 260~262)，f5 抬举 (370,120)，f6~f8 前伸 (408~418, 100~104)
FIST_WINDOWS = [
    (310, 238, 342, 284),  # f0 前伸手拳头 (325,260)
    (314, 238, 346, 286),  # f1 (329,262)
    (318, 238, 352, 286),  # f2 (334,262)
    (320, 238, 356, 282),  # f3 (338,260)
    (322, 238, 356, 282),  # f4 (339,260)
    (352, 110, 392, 140),  # f5 (370,120) 抬举
    (388, 92, 432, 116),   # f6 (408,104) 前伸
    (402, 88, 436, 112),   # f7 (418,100)
    (402, 88, 436, 112),   # f8 (418,100)
]

# 每帧拳头中心（texture px，供 staffCastFrames 配置换算）：
# local = (px-256)*144/512 —— 握把直接对准拳头中心（法杖贴图中心=中段=握持点），
# 不做 idle 平移（平移会使杆身偏离拳头约 85px，失去贴手效果）
FIST_CENTERS = [
    (325, 260),
    (329, 262),
    (334, 262),
    (338, 260),
    (339, 260),
    (370, 120),
    (408, 104),
    (418, 100),
    (418, 100),
]

IDLE_ALIGN_SHIFT = (0.0, 0.0)  # 原始拳头轨迹（握把=拳头中心）

# 抬举帧握把微调：拳头质心偏下（窗口含手臂下缘 + 杖尾粗端视觉偏重），
# 实机反馈"最终位置略低于手" → 上移 3px（local）平衡，f3 过渡帧上移 2px 保持平滑
RAISED_Y_ADJUST = {}

# 法杖杆身角度：施法竖举（20° 近竖直，指向右上）——横杖(110°)被判定"不像举杖"
CAST_ROTATION = 20


def main():
    # 中文路径在部分终端下无法作为命令行参数传入；支持 STAFF_CAST_ROOT 环境变量
    root = os.environ.get("STAFF_CAST_ROOT")
    if not root:
        here = os.path.dirname(os.path.abspath(__file__))
        root = os.path.dirname(here)
    src = os.path.join(root, "assets", "player", "staff_cast.png")
    out_dir = os.path.join(root, "assets", "player")
    if len(sys.argv) > 1 and sys.argv[1] == "--out-dir" and len(sys.argv) > 2:
        out_dir = sys.argv[2]

    img = Image.open(src)
    if img.size != (FRAME_W * COLS, FRAME_H * 2):
        print(f"WARN: 预期尺寸 {(FRAME_W * COLS, FRAME_H * 2)}，实际 {img.size}")

    body = img.copy()
    hand = Image.new("RGBA", img.size, (0, 0, 0, 0))

    mismatches = 0
    for i, (x0, y0, x1, y1) in enumerate(FIST_WINDOWS):
        fx = (i % COLS) * FRAME_W
        fy = (i // COLS) * FRAME_H
        box = (fx + x0, fy + y0, fx + x1, fy + y1)
        patch = img.crop(box)
        hand.paste(patch, box)
        # 身体层挖掉窗口内所有 alpha>0 像素（保留透明）
        body_patch = body.crop(box)
        body_data = body_patch.getdata()
        cleared = []
        for px in body_data:
            if px[3] > 0:
                cleared.append((0, 0, 0, 0))
            else:
                cleared.append(px)
        body.paste(Image.new("RGBA", body_patch.size, (0, 0, 0, 0)), box)
        body_patch2 = body.crop(box)
        body_patch2.putdata(cleared)
        body.paste(body_patch2, box)

        # 验证合成无损
        comp = Image.alpha_composite(body, hand)
        diff = 0
        da = list(comp.getdata())
        oa = list(img.getdata())
        for j, (c, o) in enumerate(zip(da, oa)):
            if c != o:
                diff += 1
        mismatches += diff

        hb = hand.crop(box).getchannel("A").getbbox()
        print(f"frame {i}: window=({x0},{y0})-({x1},{y1}) hand bbox={hb} "
              f"(合成diff={diff})")

    # 手层内容质心（每帧拳头像素中心，供握把对齐核验）
    print("\n手层内容质心（texture px）：")
    ha = hand.getchannel("A")
    for i in range(FRAMES):
        fx = (i % COLS) * FRAME_W
        fy = (i // COLS) * FRAME_H
        xs = []
        ys = []
        for yy in range(fy, fy + FRAME_H):
            for xx in range(fx, fx + FRAME_W):
                if ha.getpixel((xx, yy)) > 60:
                    xs.append(xx - fx)
                    ys.append(yy - fy)
        if xs:
            print(f"f{i}: centroid=({sum(xs)/len(xs):.1f},{sum(ys)/len(ys):.1f}) "
                  f"count={len(xs)}")

    body.save(os.path.join(out_dir, "staff_cast_body.png"))
    hand.save(os.path.join(out_dir, "staff_cast_hand.png"))
    print(f"已生成: {os.path.join(out_dir, 'staff_cast_body.png')} / "
          f"staff_cast_hand.png；全帧合成不匹配像素={mismatches}")

    # staffCastFrames 现为设计插值轨迹（f0=idle 持械位 → f8=前伸手举杖位），
    # 由本脚本的 FIST_CENTERS 仅提供 f8 目标（前伸手），完整值见 weapon-anim-config.json
    print("\nstaffCastFrames 设计轨迹（f0=idle 左手腰侧 → f8=前伸手举杖）：")
    print("f0:", (-11.4, 0.6, 105))
    print("f8:", (45.6, -43.9, 20))


if __name__ == "__main__":
    main()
