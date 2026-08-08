#!/usr/bin/env python3
"""红狼人（两足）嚎叫动画生成（2026-08-08）。

旧 howl.png 是四足狼嚎叫，红狼人形态播它形态不匹配。本次用 H3 i2v
首帧锁定红狼人站立参考图，提示词强调 bipedal werewolf howling。

用法（ComfyUI venv python）：
  python rw-humanoid-howl-regen.py [--duration 4]
"""
import argparse
import os
import subprocess

PY = r"E:\无尽轮回\长期备份\2026-7-13-1\ComfyUI\.venv\Scripts\python.exe"
TOOL = os.path.join(os.path.dirname(os.path.abspath(__file__)), "minimax-h3-gen.py")
REF = os.path.join(os.environ["TEMP"], "rw-humanoid-ref-1024.png")
OUT_DIR = os.path.join(os.environ["TEMP"], "rw-humanoid-howl")
os.makedirs(OUT_DIR, exist_ok=True)
OUT = os.path.join(OUT_DIR, "rwk_thowl_v2.mp4")
LOG = OUT + ".log"

PROMPT = (
    "The same bulky crimson bipedal werewolf character as in the image stands "
    "upright and howls, tilts head back, mouth wide open, chest expands, arms "
    "raised with claws, powerful fierce howl, full body side view, plain pure "
    "white background, no shadow, no contact shadow, no ground shadow, no other "
    "objects, no text"
)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--duration", type=float, default=4.0)
    args = ap.parse_args()

    cmd = [
        PY, TOOL,
        "--first-frame", REF,
        "--last-frame", REF,
        "--prompt", PROMPT,
        "--size", "1024x576", "--steps", "16",
        "--duration", str(args.duration),
        "--out", OUT, "--timeout", "2400",
    ]
    print("start humanoid howl regen", flush=True)
    with open(LOG, "w", encoding="utf-8") as f:
        p = subprocess.Popen(cmd, stdout=f, stderr=subprocess.STDOUT)
        p.wait()
    print("exit", p.returncode, OUT, flush=True)


if __name__ == "__main__":
    main()
