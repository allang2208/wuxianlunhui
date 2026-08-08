#!/usr/bin/env python3
"""红狼王变身动画重新生成（2026-08-08 三十二版）。

旧变身动画 rwk_change.mp4 实际是"狼咆哮"（首末帧都是四足狼），没有
狼→红狼人的形态转换。本次用 H3 i2v 首末帧锁定：
  --first-frame 狼站立参考图
  --last-frame  红狼人站立参考图
提示词强调 transformation from wolf to bipedal werewolf。

用法（ComfyUI venv python）：
  python rw-transform-regen.py [--duration 5.17]
"""
import argparse
import os
import subprocess

PY = r"E:\无尽轮回\长期备份\2026-7-13-1\ComfyUI\.venv\Scripts\python.exe"
TOOL = os.path.join(os.path.dirname(os.path.abspath(__file__)), "minimax-h3-gen.py")
REF_WOLF = os.path.join(os.environ["TEMP"], "rw-wolf-ref-1024.png")
REF_HUMANOID = os.path.join(os.environ["TEMP"], "rw-humanoid-ref-1024.png")
OUT_DIR = os.path.join(os.environ["TEMP"], "rw-transform-v2")
os.makedirs(OUT_DIR, exist_ok=True)
OUT = os.path.join(OUT_DIR, "rwk_transform_v2.mp4")
LOG = OUT + ".log"

PROMPT = (
    "The crimson wolf in <Picture 1> transforms into the bulky bipedal crimson "
    "werewolf in <Picture 2>, full body side view, the four-legged wolf rises up, "
    "body expands, grows taller, front legs lift off the ground and become arms, "
    "hind legs become thick upright legs, fur flashes red, powerful transformation "
    "sequence, plain pure white background, no shadow, no contact shadow, no ground "
    "shadow, no other objects, no text"
)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--duration", type=float, default=5.17)
    args = ap.parse_args()

    cmd = [
        PY, TOOL,
        "--first-frame", REF_WOLF,
        "--last-frame", REF_HUMANOID,
        "--prompt", PROMPT,
        "--size", "1024x576", "--steps", "16",
        "--duration", str(args.duration),
        "--out", OUT, "--timeout", "2400",
    ]
    print("start transform regen", flush=True)
    with open(LOG, "w", encoding="utf-8") as f:
        p = subprocess.Popen(cmd, stdout=f, stderr=subprocess.STDOUT)
        p.wait()
    print("exit", p.returncode, OUT, flush=True)


if __name__ == "__main__":
    main()
