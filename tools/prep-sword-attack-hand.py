# -*- coding: utf-8 -*-
"""
普通攻击一段（attack_sword）跟手轨迹生成（2026-08-03）

从 attack_sword.png 8 帧的「挥剑手（远侧手）」位置生成 30 点 perFrame 轨迹，
替换手动调参的 sword.attack.offsetX/offsetY（rotation/scale/blur/stretch 保留）。

2026-08-03 修订：**握把（剑柄）贴手**——剑柄在贴图中心下方（精测锈剑 39.2 / 骑士 41.6 /
EX 36.1 / 夜火 44.1，取 40；2026-08-03 改为从配置 sword.gripOffset 读取，缺省 40）。
perFrame 偏移是贴图中心位置，需按每帧旋转角反推中心，使剑柄落点=手部：
    offsetX = 手X + G·sin(rot)，offsetY = 手Y − G·cos(rot)

2026-08-03 再修订：**帧边界从 player-anim-config.json 推导（单一数据源）**——
attack_sword 的 frameWeights 决定精灵帧边界，30 点阶梯映射按真实边界取帧
（不再硬编码 f/10 网格，改权重/帧数/帧率不再静默脱手）。

用法：python tools/prep-sword-attack-hand.py

2026-08-03 追加：dash（冲刺攻击）跟手——dash_attack 17 帧远侧手轨迹，
30 点配置按 帧=progress×16 映射后线性插值手位（rotation/blur 保留）。
**注意：dash 轨迹当前是手调/已回退版本（用户实机验收"大体正确"），与脚本生成结果
（含无 G 的原始手位）最大相差 130+px——main_dash 默认拒绝运行，必须显式
`python tools/prep-sword-attack-hand.py dash --force` 才会覆盖，且不套用 G（--grip 可选）。**
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

# 剑柄（握把）相对贴图中心的向下偏移（display px）——缺省值，优先读 sword.gripOffset。
# 2026-08-03 精测四把剑的柄质心：锈剑 39.2 / 骑士 41.6 / EX 36.1 / 夜火 44.1，
# 取 40 近似（旧值 55 偏大，握把落在柄下端→实机"还有错位"）。
DEFAULT_GRIP_OFFSET_Y = 40


def local(px, py):
    return ((px - 256) * 144 / 516, (py - 256) * 144 / 516)


def frame_at(bounds, p):
    """progress p ∈ [0,1] → 精灵帧索引；末帧含 p==1"""
    for fi, b in enumerate(bounds):
        if p < b:
            return fi
    return len(bounds) - 1


def load_frame_bounds(player_cfg_path, anim_key):
    """从 player-anim-config.json 推导精灵帧边界占比（与 BootScene 注册动画同口径）：
    frameWeights 按权重分配总时长 / frameDurations 按 ms 分配 / 缺省等分。"""
    with open(player_cfg_path, encoding="utf-8") as f:
        pcfg = json.load(f)
    defn = pcfg.get(anim_key)
    if not defn or defn.get("type") != "sheet":
        raise SystemExit(f"player-anim-config.json 缺少 {anim_key} 动画定义")
    start, end = defn.get("frames") or [0, (defn.get("frameCount") or 1) - 1]
    n = end - start + 1
    weights = defn.get("frameWeights")
    durations = defn.get("frameDurations")
    if weights:
        wsum = float(sum(weights[:n])) or 1.0
        per = [(weights[i] if i < len(weights) else 1) / wsum for i in range(n)]
    elif durations:
        dsum = float(sum(durations[:n])) or 1.0
        per = [(durations[i] if i < len(durations) else 1) / dsum for i in range(n)]
    else:
        per = [1.0 / n] * n
    bounds, acc = [], 0.0
    for w in per:
        acc += w
        bounds.append(acc)
    return bounds


def build_points(rotations, bounds, grip):
    anchors = [local(px, py) for (px, py) in HAND_PX]
    n = 30
    pts = []
    for i in range(n):
        p = i / (n - 1)
        # 2026-08-03 二轮修复：手部只有 8 个定格姿势，30 帧之间按精灵帧边界阶梯映射（不插值）——
        # 平滑插值会让握把在帧间漂移（f3→f4 跨度 154px 时帧 11 脱手 122px），
        # 阶梯映射使 30 帧握把全部钉在当前精灵帧的拳头上。
        fi = frame_at(bounds, p)
        ax, ay = anchors[fi]
        # 握把贴手：中心 = 手 + R(rot)·(0,-grip) 的本地等价
        rot = rotations[i]
        th = math.radians(rot)
        gx = ax + grip * math.sin(th)
        gy = ay - grip * math.cos(th)
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
    grip = cfg["sword"].get("gripOffset", DEFAULT_GRIP_OFFSET_Y)
    bounds = load_frame_bounds(
        os.path.join(root, "data", "player-anim-config.json"), "attack_sword"
    )
    pts = build_points([f["rotation"] for f in attack], bounds, grip)
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


def main_dash(apply_grip=False, force=False):
    """dash（冲刺攻击）跟手：17 帧远侧手 → 30 点配置。
    当前 dash 配置是手调/已回退版本（与脚本生成结果最大差 130+px），
    默认拒绝运行；--force 才覆盖（仍不套 G，--grip 才套用 sword.gripOffset）。"""
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.environ.get("STAFF_CAST_ROOT") or os.path.dirname(here)
    cfg_path = os.path.join(root, "public", "data", "weapon-anim-config.json")
    cfg = json.load(open(cfg_path, encoding="utf-8"))
    frames = cfg["sword"]["dash"]["frames"]
    if len(frames) != 30:
        raise SystemExit(f"dash frames 应为 30，实际 {len(frames)}")
    if not force:
        raise SystemExit(
            "拒绝覆盖：dash 轨迹是手调/已回退版本（用户实机验收），脚本生成结果与其不一致。"
            "确要重新生成请加 --force（仍默认不套 G，需要 G 再加 --grip）。"
        )
    anchors = [local(px, py) for (px, py) in DASH_HAND_PX]
    grip = cfg["sword"].get("gripOffset", DEFAULT_GRIP_OFFSET_Y) if apply_grip else 0
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
        f["offsetX"] = round(hx + grip * math.sin(th), 1)
        f["offsetY"] = round(hy - grip * math.cos(th), 1)
    open(cfg_path, "w", encoding="utf-8", newline="\n").write(
        json.dumps(cfg, ensure_ascii=False, indent=2) + "\n"
    )
    print(f"已写入 sword.dash 30 点跟手轨迹（握把=远侧手，G={'套用(' + str(grip) + ')' if apply_grip else '未套用（已回退）'}）：")
    for i, f in enumerate(frames):
        print(f"  f{i}: 中心=({f['offsetX']},{f['offsetY']}) rot={f['rotation']}")


if __name__ == "__main__":
    import sys

    if len(sys.argv) > 1 and sys.argv[1] == "dash":
        main_dash(apply_grip="--grip" in sys.argv[2:], force="--force" in sys.argv[2:])
    else:
        main()
