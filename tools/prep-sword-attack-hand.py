# -*- coding: utf-8 -*-
"""
普通攻击一段（attack_sword）跟手轨迹生成（2026-08-03）

从 attack_sword.png 8 帧的「挥剑手（远侧手）」位置生成 30 点 perFrame 轨迹，
替换手动调参的 sword.attack.offsetX/offsetY（rotation/scale/blur/stretch 保留）。

2026-08-03 修订：**握把（剑柄）贴手**——剑柄在贴图中心下方 55px（SKILL「复用武器动画独立
调参」记录），perFrame 偏移是贴图中心位置，需按每帧旋转角反推中心，使剑柄落点=手部：
    offsetX = 手X + 55·sin(rot)，offsetY = 手Y − 55·cos(rot)

用法：python tools/prep-sword-attack-hand.py

2026-08-03 追加：dash（冲刺攻击）跟手——dash_attack 17 帧远侧手轨迹 + 握把校正 G=40，
30 点配置按 帧=progress×16 映射后线性插值手位，中心=手+G·(sinθ,−cosθ)（rotation/blur 保留）。
"""

import json
import os
import math

# 每帧挥剑手（远侧手）拳头中心（texture px，帧 0~7 与 attack_sword 动画帧一致）
# local = (px-256)*144/516
HAND_PX = [
    (213, 116),  # f0 高举在头后（贴图真值掩码复核：手臂带上端）
    (205, 116),  # f1
    (192, 116),  # f2 继续上举（原手调值，掩码复核贴臂带）
    (150, 110),  # f3 头顶最高点（原手调值，掩码复核贴臂带）
    (282, 115),  # f4 挥过头顶到前（掩码 100% 贴手）
    (310, 116),  # f5 前举
    (330, 120),  # f6
    (425, 278),  # f7 前伸手下劈到位（命中帧；f7 全身实测：手向前伸 x400-464，拳头中心约 x425）
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
        # 帧权重 [1,1,1,1,1,1,1,3]（总 10）：精灵帧 f 覆盖 p∈[f/10,(f+1)/10)，f7 覆盖 [0.7,1]。
        # 2026-08-03 二轮修复：手部只有 8 个定格姿势，30 帧之间阶梯映射（不插值）——
        # 平滑插值会让握把在帧间漂移（f3→f4 跨度 154px 时帧 11 脱手 122px），
        # 阶梯映射使 30 帧握把全部钉在当前精灵帧的拳头上。
        if p >= 0.7:
            fi = 7
        else:
            fi = min(6, int(p * 10))
        ax, ay = anchors[fi]
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


DASH_HAND_PX = [
    (160, 97), (120, 93), (120, 92), (110, 112), (118, 117), (125, 117),
    (180, 103), (198, 100), (210, 106), (220, 119), (230, 160), (215, 186),
    (225, 220), (170, 165), (185, 175), (180, 180), (185, 180),
]


def main_dash():
    """dash（冲刺攻击）跟手：17 帧远侧手 → 30 点配置，中心=手+G·(sinθ,−cosθ)"""
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.environ.get("STAFF_CAST_ROOT") or os.path.dirname(here)
    cfg_path = os.path.join(root, "public", "data", "weapon-anim-config.json")
    cfg = json.load(open(cfg_path, encoding="utf-8"))
    frames = cfg["sword"]["dash"]["frames"]
    if len(frames) != 30:
        raise SystemExit(f"dash frames 应为 30，实际 {len(frames)}")
    anchors = [local(px, py) for (px, py) in DASH_HAND_PX]
    n = len(frames)
    for i, f in enumerate(frames):
        p = i / (n - 1)
        af = p * 16  # 17 帧动画 → progress 0~1
        fi = int(af)
        t = af - fi
        nxt = min(fi + 1, 16)
        hx = anchors[fi][0] + (anchors[nxt][0] - anchors[fi][0]) * t
        hy = anchors[fi][1] + (anchors[nxt][1] - anchors[fi][1]) * t
        th = math.radians(f["rotation"])
        f["offsetX"] = round(hx + GRIP_OFFSET_Y * math.sin(th), 1)
        f["offsetY"] = round(hy - GRIP_OFFSET_Y * math.cos(th), 1)
    open(cfg_path, "w", encoding="utf-8", newline="\n").write(
        json.dumps(cfg, ensure_ascii=False, indent=2) + "\n"
    )
    print("已写入 sword.dash 30 点跟手轨迹（握把=远侧手）：")
    for i, f in enumerate(frames):
        th = math.radians(f["rotation"])
        gx = f["offsetX"] - GRIP_OFFSET_Y * math.sin(th)
        gy = f["offsetY"] + GRIP_OFFSET_Y * math.cos(th)
        print(f"  f{i}: 中心=({f['offsetX']},{f['offsetY']}) rot={f['rotation']} 握把=({gx:.1f},{gy:.1f})")


if __name__ == "__main__":
    import sys

    if len(sys.argv) > 1 and sys.argv[1] == "dash":
        main_dash()
    else:
        main()
