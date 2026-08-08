#!/usr/bin/env python3
"""红狼人两足奔跑 v2 视频生成（方案：统一参考图 + first=last=ref 锁体型/透视）。
提示词强调 bipedal running / side view / consistent size / 无地面阴影，
解决上一版"脚部自带接触阴影"与透视不稳问题。
"""
import os
import subprocess

PY = r"E:\无尽轮回\长期备份\2026-7-13-1\ComfyUI\.venv\Scripts\python.exe"
TOOL = os.path.join(os.path.dirname(os.path.abspath(__file__)), "minimax-h3-gen.py")
REF = os.path.join(os.environ["TEMP"], "rw-humanoid-ref-1024.png")
PROMPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "prompts", "rwk-humanoid-run-v2.txt")
OUT = os.path.join(os.environ["TEMP"], "rw-humanoid-v2", "rwk_trun_v3.mp4")
LOG = OUT + ".log"

cmd = [
    PY, TOOL,
    "--first-frame", REF, "--last-frame", REF,
    "--prompt-file", PROMPT,
    "--size", "1024x576", "--steps", "16",
    "--duration", "5.17", "--out", OUT, "--timeout", "2400",
]
print("start run-v2", flush=True)
with open(LOG, "w", encoding="utf-8") as f:
    p = subprocess.Popen(cmd, stdout=f, stderr=subprocess.STDOUT)
    p.wait()
print("exit", p.returncode, OUT, flush=True)
