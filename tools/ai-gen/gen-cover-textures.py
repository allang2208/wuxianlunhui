#!/usr/bin/env python3
"""路线 B：批量生成墙段材质纹理（AI 只出材质，几何由 Blender 控制）。

尺寸 1024×668 = 墙段正面比例（230:150 ≈ 1.53:1），避免纹理贴到正面被横向拉伸。
产出：Y:\\工作\\无尽轮回\\scratch\\world122\\raw\\tex_<grade>_<theme>.png
"""
import argparse
import os
import subprocess

DIR = os.path.dirname(os.path.abspath(__file__))
GEN = os.path.join(DIR, "comfyui-gen.py")
OUT_DIR = r"Y:\工作\无尽轮回\scratch\world122\raw"

THEME = {
    "F": "seamless wooden plank wall texture, reinforced timber planks with wooden braces, weathered pale wood",
    "E": "seamless sandbag wall texture, stacked sand-filled canvas sandbags with a wooden frame, weathered canvas",
    "D": "seamless stone wall texture, stacked rough stones and boulders, mossy joints",
    "C": "seamless masonry brick and concrete wall texture, reinforced fortification blocks with steel corner plates",
    "B": "seamless steel armor plate texture, dark riveted metal armor plates with a horizontal firing slit",
    "A": "seamless dark runed metal wall texture, black steel plates with faint glowing energy runes, advanced magical fortification",
}
TAIL = (
    ", photorealistic PBR material texture, flat frontal view, even diffuse lighting, "
    "no shadows, no vignette, no perspective distortion, high detail, tileable, no text, no watermark"
)
NEG = (
    "blurry, low quality, watermark, text, signature, gradient, vignette, frame, border, "
    "people, hands, grass, ground, sky, perspective, isometric, 3D object, single object, "
    "shadows, drop shadow, hard lighting, directional light"
)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--grades", default="FEDCBA", help="要生成的级别")
    ap.add_argument("--seed", type=int, default=3001)
    args = ap.parse_args()
    os.makedirs(OUT_DIR, exist_ok=True)
    seed = args.seed
    for g in args.grades:
        out = os.path.join(OUT_DIR, f"tex_{g}.png")
        prompt = THEME[g] + TAIL
        cmd = [
            "python", GEN, "--host", "192.168.3.142", "--model", "flux2-dev-fp8",
            "--size", "1024x668", "--seed", str(seed), "--prompt", prompt, "--out", out,
        ]
        print(f"--- {g} (seed {seed}) ---", flush=True)
        r = subprocess.run(cmd)
        if r.returncode != 0:
            print(f"[{g}] FAILED rc={r.returncode}", flush=True)
        seed += 17


if __name__ == "__main__":
    main()
