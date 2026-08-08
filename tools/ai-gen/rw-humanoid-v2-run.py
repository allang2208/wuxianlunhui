#!/usr/bin/env python3
"""红狼人 v2 视频批量生成（方案 A：统一参考图 + 首末帧锁体型）。
参考图：rwk_tatk_f10（最壮站立帧，1024×576 白底）。
生成：run 循环 + attack 弧线（first=last=ref），顺序执行并写日志。
用法：后台运行，输出 %TEMP%/rw-humanoid-v2/。
"""
import os
import sys
import subprocess

PY = r"E:\无尽轮回\长期备份\2026-7-13-1\ComfyUI\.venv\Scripts\python.exe"
TOOL = os.path.join(os.path.dirname(os.path.abspath(__file__)), "minimax-h3-gen.py")
PROMPT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "prompts")
REF = os.path.join(os.environ["TEMP"], "rw-humanoid-ref-1024.png")
OUT = os.path.join(os.environ["TEMP"], "rw-humanoid-v2")
os.makedirs(OUT, exist_ok=True)

JOBS = [
    ("run", "rwk_trun_v2.mp4", "rwk-humanoid-run.txt"),
    ("attack", "rwk_tatk_v2.mp4", "rwk-humanoid-attack.txt"),
]

for key, fname, prompt_file in JOBS:
    if len(sys.argv) > 1 and key not in sys.argv[1:]:
        continue
    out = os.path.join(OUT, fname)
    log = out + ".log"
    cmd = [
        PY, TOOL,
        "--first-frame", REF, "--last-frame", REF,
        "--prompt-file", os.path.join(PROMPT_DIR, prompt_file),
        "--size", "1024x576", "--steps", "16",
        "--duration", "5.17", "--out", out, "--timeout", "2400",
    ]
    print(f"[{key}] start {out}", flush=True)
    with open(log, "w", encoding="utf-8") as f:
        p = subprocess.Popen(cmd, stdout=f, stderr=subprocess.STDOUT, cwd=OUT)
        p.wait()
    print(f"[{key}] exit {p.returncode} -> {out}", flush=True)

print("ALL DONE", flush=True)
