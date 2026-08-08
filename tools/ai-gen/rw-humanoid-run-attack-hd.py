#!/usr/bin/env python3
"""红狼人 run + attack 高清重生成（2026-08-08）。

H3 原生精细参数：1344×768 + 20 步（1024×576+16 步是粗糙根因）。
统一参考图升级为 rw-humanoid-ref-1344.png，first=last=ref 锁体型/透视。
串行生成 run → attack，每段约 17 分钟。

用法（ComfyUI venv python）：
  python rw-humanoid-run-attack-hd.py [run|attack]
"""
import os
import subprocess

PY = r"E:\无尽轮回\长期备份\2026-7-13-1\ComfyUI\.venv\Scripts\python.exe"
TOOL = os.path.join(os.path.dirname(os.path.abspath(__file__)), "minimax-h3-gen.py")
PROMPT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "prompts")
REF = os.path.join(os.environ["TEMP"], "rw-humanoid-ref-real-hd.png")
OUT_DIR = os.path.join(os.environ["TEMP"], "rw-humanoid-real-v2")
os.makedirs(OUT_DIR, exist_ok=True)

JOBS = [
    ("run", "rwk_trun_hd.mp4", "rwk-humanoid-run-v2.txt"),
    ("attack", "rwk_tatk_hd.mp4", "rwk-humanoid-attack.txt"),
]


def main():
    import sys
    only = set(sys.argv[1:])
    for key, fname, prompt_file in JOBS:
        if only and key not in only:
            continue
        out = os.path.join(OUT_DIR, fname)
        log = out + ".log"
        cmd = [
            PY, TOOL,
            "--first-frame", REF, "--last-frame", REF,
            "--prompt-file", os.path.join(PROMPT_DIR, prompt_file),
            "--size", "1344x768", "--steps", "20",
            "--duration", "5.17", "--out", out, "--timeout", "2400",
        ]
        print(f"[{key}] start {out}", flush=True)
        with open(log, "w", encoding="utf-8") as f:
            p = subprocess.Popen(cmd, stdout=f, stderr=subprocess.STDOUT)
            p.wait()
        print(f"[{key}] exit {p.returncode} -> {out}", flush=True)


if __name__ == "__main__":
    main()
