#!/usr/bin/env python3
"""路线 B：批量渲染 6 级墙段（Blender 几何 + AI 材质纹理）。"""
import os
import subprocess

BLENDER = r"E:/Program Files/Blender Foundation/Blender 5.1/blender.exe"
DIR = os.path.dirname(os.path.abspath(__file__))
SPEC = os.path.join(DIR, "_depth_templates", "cover_wall_spec.json")
PY = os.path.join(DIR, "render-cover-real.py")
RAW = r"Y:\工作\无尽轮回\scratch\world122\raw"


def main():
    for g in "FEDCBA":
        tex = os.path.join(RAW, f"tex_{g}.png")
        out = os.path.join(RAW, f"cover_{g}_v.png")
        cmd = [
            BLENDER, "--background", "--factory-startup", "--python", PY,
            "--", SPEC, tex, out,
        ]
        print(f"--- {g} ---", flush=True)
        r = subprocess.run(cmd, capture_output=True, text=True, errors="ignore")
        ok = os.path.exists(out) and os.path.getsize(out) > 10000
        print(f"[{g}] rendered={ok}", flush=True)


if __name__ == "__main__":
    main()
