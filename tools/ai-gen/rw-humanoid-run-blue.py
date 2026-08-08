#!/usr/bin/env python3
"""红狼人两足奔跑（纯蓝底）视频生成——治本方案验证 H3 对非白背景的表现。
首末帧 = 蓝底站立参考图；背景纯蓝 #0000FF，抠图时用蓝键分离。
"""
import os
import subprocess

PY = r"E:\无尽轮回\长期备份\2026-7-13-1\ComfyUI\.venv\Scripts\python.exe"
TOOL = os.path.join(os.path.dirname(os.path.abspath(__file__)), "minimax-h3-gen.py")
REF = os.path.join(os.environ["TEMP"], "rw-humanoid-ref-blue.png")
PROMPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "prompts", "rwk-humanoid-run-blue.txt")
OUT = os.path.join(os.environ["TEMP"], "rw-humanoid-blue", "rwk_trun_blue.mp4")
LOG = OUT + ".log"
os.makedirs(os.path.dirname(OUT), exist_ok=True)

cmd = [
    PY, TOOL,
    "--first-frame", REF, "--last-frame", REF,
    "--prompt-file", PROMPT,
    "--size", "1024x576", "--steps", "16",
    "--duration", "5.17", "--out", OUT, "--timeout", "2400",
]
print("start run-blue", flush=True)
with open(LOG, "w", encoding="utf-8") as f:
    p = subprocess.Popen(cmd, stdout=f, stderr=subprocess.STDOUT)
    p.wait()
print("exit", p.returncode, OUT, flush=True)
