#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""黑狼绿幕重生成一条龙（2026-08-11，白边/脏底救治失败后改治本管线）。

步骤：
  1) MiniMax H3 I2V：绿幕首帧（firstframe_green_idle.png）+ --bg-color 00FF00
     自动注入纯色底/无阴影条款，生成动作循环视频（远程 5080）。
  2) rebuild-h3-birefnet.py：抽帧 + BiRefNet + 背景色距离双通道抠图（绿幕下
     bg_dist 80 = 确定性硬切）；--edge-dark -1 + --no-auto-clean（SKILL 二十七版：
     固定色压暗 = 人工描边根因；auto-clean 内嵌 18 不接 CLI）。
  3) blackwolf-post.py 后处理：硬二值化 + 最大连通域 + 边缘污染按该格深色毛
     中位数还原（欧氏距离>35）+ 透明区颜色外渗（防线性过滤黑边）。

动作参数（黑狼惯例 + 绿幕实测）：
  run ：3s/73 帧，取 28 连续帧（step 1，完整步态周期），4x7
  walk：5s/124 帧，步态周期 P≈48，step 3 抽 16 帧，4x4

用法（game-dev 仓库根目录，venv-sprites python）：
  python tools/ai-gen/blackwolf-green-run.py --action run
  python tools/ai-gen/blackwolf-green-run.py --action walk --skip-gen   # 只重建
  python tools/ai-gen/blackwolf-green-run.py --action walk --frames 30,33,...
"""
import argparse
import os
import subprocess
import sys

import cv2
import numpy as np

ROOT = r"E:\无尽轮回\长期备份\2026-7-13-1\game-dev"
COMFY_PY = r"E:\无尽轮回\长期备份\2026-7-13-1\ComfyUI\.venv\Scripts\python.exe"
SCRATCH = r"Y:\工作\无尽轮回\scratch\black_wolf"
FIRST_FRAME = os.path.join(SCRATCH, "firstframe_green_v2.png")  # v2：保狼爪（v1 开运算过度吃掉爪尖，SKILL 2026-08-11）
BG_HEX = "00FF00"

ACTIONS = {
    # run 用"疾跑伸展姿态"首帧（firstframe_green_runpose.png，老白底视频 BiRefNet 抠图），
    # 站立首帧会被 I2V 退化成走路（2026-08-11 实测）；prompt 加腾空期关键词
    "run": dict(duration=3, video="run_loop_green.mp4", prompt="run_green_prompt.txt",
                out="black_wolf_run_green.png", mode="consecutive", n=28,
                cols=4, cell=512, center_x=256, feet_y=410, uniform=True,
                firstframe="firstframe_green_runpose.png"),
    "walk": dict(duration=5, video="walk_loop_green.mp4", prompt="walk_green_prompt.txt",
                 out="black_wolf_walk_green.png", mode="step3", n=16,
                 cols=4, cell=512, center_x=256, feet_y=410, uniform=True),
    "bite": dict(duration=2, video="attack_bite_green.mp4", prompt="bite_green_prompt.txt",
                 out="black_wolf_bite_regular_green.png", mode="even", n=12,
                 cols=4, cell=512, center_x=256, feet_y=410, uniform=False),
    "pounce": dict(duration=5, video="attack_pounce_green.mp4", prompt="pounce_green_prompt.txt",
                   out="black_wolf_pounce_green.png", mode="even", n=20,
                   cols=4, cell=640, center_x=320, feet_y=513, uniform=False),
}

# 攻击动作用固定缩放（不用 uniform-h）：与站立帧同比例，体型跨动作统一
# （首帧站立 bbox 高 507px → cell 内 228，与 run/walk 的 uniform-h 228 一致）
# 2026-08-11 尺寸统一修正：游戏按"帧最长边 → spriteSize"等比显示（GameScene:1199），
# 512 格和 640 格的显示比例不同（×0.295 vs ×0.236）——pounce 的 640 格必须按
# 640/512 放大内容，否则游戏里飞扑狼比走路狼小 20%（老资产就有这个不一致）。
ATTACK_SCALE_512 = 228.0 / 507.0
ATTACK_SCALE_640 = 228.0 * (640.0 / 512.0) / 507.0


def motion_diff(video):
    cap = cv2.VideoCapture(video)
    frames = []
    while True:
        ok, f = cap.read()
        if not ok:
            break
        frames.append(cv2.resize(cv2.cvtColor(f, cv2.COLOR_BGR2GRAY), (64, 64)).astype(float))
    cap.release()
    g0 = frames[0]
    return np.array([np.abs(g - g0).mean() for g in frames]), len(frames)


def pick_frames(video, mode, n):
    diff, total = motion_diff(video)
    peak = int(diff.argmax())
    if mode == "consecutive":
        start = max(0, min(peak - n // 2, total - n))
        return list(range(start, start + n))
    # step3：动作启动点（diff 首超 0.5*peak）+ 5 帧预热，隔 3 抽 n 帧覆盖完整步态
    started = int(np.argmax(diff > 0.5 * diff[peak])) if diff[peak] > 0 else 0
    start = min(started + 5, total - 1 - 3 * (n - 1))
    return [start + 3 * k for k in range(n)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--action", choices=sorted(ACTIONS), default="run")
    ap.add_argument("--skip-gen", action="store_true")
    ap.add_argument("--frames", default=None, help="逗号分隔帧号，覆盖自动选窗")
    ap.add_argument("--seed", type=int, default=None)
    ap.add_argument("--host", default="192.168.3.142")
    args = ap.parse_args()
    act = ACTIONS[args.action]
    video = os.path.join(SCRATCH, "videos", act["video"])
    prompt = os.path.join(SCRATCH, act["prompt"])
    out = os.path.join(ROOT, "tools", "ai-gen", "blackwolf-rebuild-out", act["out"])

    if not args.skip_gen:
        cmd = [sys.executable, os.path.join(ROOT, "tools", "ai-gen", "minimax-h3-gen.py"),
               "--host", args.host,
               "--first-frame", os.path.join(SCRATCH, act.get("firstframe", FIRST_FRAME)),
               "--bg-color", BG_HEX,
               "--prompt-file", prompt,
               "--duration", str(act["duration"]), "--size", "1344x768",
               "--out", video]
        if args.seed is not None:
            cmd += ["--seed", str(args.seed)]
        print(f"[green-{args.action}] gen:", " ".join(cmd), flush=True)
        subprocess.run(cmd, check=True)

    frames = args.frames
    if not frames and act["mode"] != "even":
        frames = ",".join(str(i) for i in pick_frames(video, act["mode"], act["n"]))
    cmd = [COMFY_PY, os.path.join(ROOT, "tools", "ai-gen", "rebuild-h3-birefnet.py"),
           "--video", video, "--out", out,
           "--cols", str(act["cols"]), "--cell", str(act["cell"]),
           "--center-x", str(act["center_x"]), "--feet-y", str(act["feet_y"]),
           "--hard-edge", "245", "--edge-dark", "-1",
           "--bg-color", f"#{BG_HEX}", "--bg-dist", "80",
           "--no-auto-clean"]
    if act["uniform"]:
        cmd += ["--target-h", "228", "--uniform-h"]
    else:
        cmd += ["--scale", f"{(ATTACK_SCALE_640 if act['cell'] >= 640 else ATTACK_SCALE_512):.4f}"]
    if frames:
        cmd += ["--frames", frames]
    else:
        cmd += ["--frames-count", str(act["n"])]
    print(f"[green-{args.action}] rebuild:", " ".join(cmd), flush=True)
    subprocess.run(cmd, check=True)
    subprocess.run([sys.executable, os.path.join(ROOT, "tools", "ai-gen", "blackwolf-post.py"), out,
                    "--cell", str(act["cell"])],
                   check=True)
    print(f"[green-{args.action}] done -> {out}", flush=True)


if __name__ == "__main__":
    main()
