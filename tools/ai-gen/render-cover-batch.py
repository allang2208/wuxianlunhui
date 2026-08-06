#!/usr/bin/env python3
"""路线 B：批量渲染 6 级 × N 变体墙段（Blender 几何 + AI 材质纹理）。

注意：Blender 的 bpy.data.images.load 在 Windows 不支持非 ASCII 路径
（项目/NAS 路径含中文会直接 "No such file or directory"），
纹理/SPEC/输出统一先复制到 ASCII 临时目录（%TEMP%/world122-cover）再渲染，
完成后复制回 RAW（2026-08-05 修复）。

变体：tex_<g>_v<n>.png → cover_<g>_v<n>.png（v1 = 定稿主题，v2+ = 微调变体）。
"""
import os
import shutil
import subprocess
import tempfile
import sys

BLENDER = r"E:/Program Files/Blender Foundation/Blender 5.1/blender.exe"
DIR = os.path.dirname(os.path.abspath(__file__))
SPEC = os.path.join(DIR, "_depth_templates", "cover_wall_spec.json")
PY = os.path.join(DIR, "render-cover-real.py")
RAW = r"Y:\工作\无尽轮回\scratch\world122\raw"


def main():
    tmp = os.path.join(tempfile.gettempdir(), "world122-cover")
    os.makedirs(tmp, exist_ok=True)
    grades = sys.argv[1] if len(sys.argv) > 1 else "FEDCBA"
    variants = int(sys.argv[2]) if len(sys.argv) > 2 else 5
    for g in grades:
        for v in range(1, variants + 1):
            tex = os.path.join(RAW, f"tex_{g}_v{v}.png")
            if not os.path.exists(tex):
                print(f"[{g}] v{v} tex missing, skip", flush=True)
                continue
            tex_tmp = os.path.join(tmp, f"tex_{g}_v{v}.png")
            spec_tmp = os.path.join(tmp, "cover_wall_spec.json")
            out_tmp = os.path.join(tmp, f"cover_{g}_v{v}.png")
            out = os.path.join(RAW, f"cover_{g}_v{v}.png")
            shutil.copy2(tex, tex_tmp)
            shutil.copy2(SPEC, spec_tmp)
            cmd = [
                BLENDER, "--background", "--factory-startup", "--python", PY,
                "--", spec_tmp, tex_tmp, out_tmp,
            ]
            print(f"--- {g} v{v} ---", flush=True)
            r = subprocess.run(cmd, capture_output=True, text=True, errors="ignore")
            ok = os.path.exists(out_tmp) and os.path.getsize(out_tmp) > 10000
            print(f"[{g}] v{v} rendered={ok}", flush=True)
            if ok:
                shutil.copy2(out_tmp, out)
            else:
                print(f"[{g}] v{v} FAILED stderr tail: {r.stderr[-300:]}", flush=True)


if __name__ == "__main__":
    main()
