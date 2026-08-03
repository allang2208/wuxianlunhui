# -*- coding: utf-8 -*-
"""
普通攻击一段（attack_sword）跟手轨迹生成（2026-08-03）

从 attack_sword.png 8 帧的「挥剑手（远侧手）」位置生成 30 点 perFrame 轨迹，
替换手动调参的 sword.attack.offsetX/offsetY（rotation/scale/blur/stretch 保留）。

2026-08-03 修订：**握把（剑柄）贴手**——剑柄在贴图中心下方 55px（SKILL「复用武器动画独立
调参」记录），perFrame 偏移是贴图中心位置，需按每帧旋转角反推中心，使剑柄落点=手部：
    offsetX = 手X + 55·sin(rot)，offsetY = 手Y − 55·cos(rot)

用法：python tools/prep-sword-attack-hand.py
"""

import json
import os
import math

# 每帧挥剑手（远侧手）拳头中心（texture px，帧 0~7 与 attack_sword 动画帧一致）
# local = (px-256)*144/516
HAND_PX = [
    (200, 130),  # f0 高举在头后
    (200, 126),  # f1
    (192, 116),  # f2 继续上举
    (150, 110),  # f3 头顶最高点
    (267, 86),   # f4 挥到头顶前
    (312, 116),  # f5 前举
    (312, 112),  # f6
    (290, 244),  # f7 下劈到位（命中帧）
]

# 剑柄（握把）相对贴图中心的向下偏移（display px）。
# 2026-08-03 精测四把剑的柄质心：锈剑 39.2 / 骑士 41.6 / EX 36.1 / 夜火 44.1，
# 取 40 近似（旧值 55 偏大，握把落在柄下端→实机"还有错位"）。
GRIP_OFFSET_Y = 40


def local(px, py):
    return ((px - 256) * 144 / 516, (py - 256) * 144 / 516)


def build_points(rotations):
    anchors = [local(px, py) for (px, py) in HAND_PX]
    n = 30
    pts = []
    for i in range(n):
        p = i / (n - 1)
        # 帧权重 [1,1,1,1,1,1,1,3]（总 10）：帧 f 覆盖 p∈[f/10,(f+1)/10)，f7 覆盖 [0.7,1]
        if p >= 0.7:
            f = 6.0 + (p - 0.6) / 0.4  # 0.7→6.75... 直接用锚点 7 简化
            f = 7.0
        else:
            f = p * 10
        fi = int(f)
        t = f - fi
        nxt = min(fi + 1, 7)
        ax = anchors[fi][0] + (anchors[nxt][0] - anchors[fi][0]) * t
        ay = anchors[fi][1] + (anchors[nxt][1] - anchors[fi][1]) * t
        # 握把贴手：中心 = 手 + R(rot)·(0,-GRIP_OFFSET_Y) 的本地等价
        rot = rotations[i]
        th = math.radians(rot)
        gx = ax + GRIP_OFFSET_Y * math.sin(th)
        gy = ay - GRIP_OFFSET_Y * math.cos(th)
        pts.append((gx, gy))
    return pts


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.environ.get("STAFF_CAST_ROOT") or os.path.dirname(here)
    cfg_path = os.path.join(root, "public", "data", "weapon-anim-config.json")
    cfg = json.load(open(cfg_path, encoding="utf-8"))
    attack = cfg["sword"]["attack"]["frames"]
    if len(attack) != 30:
        raise SystemExit(f"attack frames 应为 30，实际 {len(attack)}")
    pts = build_points([f["rotation"] for f in attack])
    for i, f in enumerate(attack):
        f["offsetX"] = round(pts[i][0], 1)
        f["offsetY"] = round(pts[i][1], 1)
    open(cfg_path, "w", encoding="utf-8", newline="\n").write(
        json.dumps(cfg, ensure_ascii=False, indent=2) + "\n"
    )
    print("已写入 sword.attack 30 点跟手轨迹：")
    for i, f in enumerate(attack):
        print(f"  f{i}: ({f['offsetX']}, {f['offsetY']}, rot {f['rotation']}, blur {f.get('blurX')},{f.get('blurY')})")


if __name__ == "__main__":
    main()
