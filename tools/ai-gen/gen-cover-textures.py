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
    "F": "weathered pale gray brick wall, regular square brick grid pattern with rectangular bricks aligned in neat rows, old cracked and chipped bricks, crumbling mortar joints, aged worn surface",
    "E": "sand-colored limestone brick wall reinforced with stacked olive canvas sandbags, tan and ochre brick grid pattern, precise brickwork, heavy canvas sandbags with tight stitching, military fortification, higher strength than simple brick",
    "D": "regular square brick wall, neat grid of rectangular bricks in warm gray and reddish tones, uniform mortar joints, chipped edges and weathered surface, slight moss in joints",
    "C": "cold gray-blue concrete brick fortification wall, steel-gray concrete blocks in regular square grid, rusted steel corner plates and rivets, precise industrial construction, reinforced heavy fortification, massive thick blocks",
    "B": "deep gunmetal armored brick wall, dark steel-blue and charcoal brick grid plated with riveted steel armor plates, heavy riveted armor with bolts, scratched worn gunmetal, high-strength industrial armor plating, imposing defense",
    "A": "obsidian black runed arcane brick wall, black brick grid with glowing blue energy runes, intricate engraved rune patterns, luminous cyan-blue rune glow, high-tier magical fortification, black and blue color scheme, legendary tier",
}
TAIL = (
    ", photorealistic PBR material texture, flat frontal view, extremely detailed, "
    "regular square brick grid pattern, rectangular bricks aligned in neat rows like a standard brick wall, "
    "bricks vary slightly in color tone with chipped uneven edges and wear marks, "
    "uniform thin mortar joints, refined precise construction, crisp clean brickwork, "
    "intricate surface detail, imposing heavy fortification, subtle wear marks, "
    "no perspective distortion, "
    "flat diffuse even lighting, absolutely no shadows, no drop shadow, no ambient occlusion, "
    "no dark shading, no gradient lighting, no vignette, no text, no watermark"
)
NEG = (
    "blurry, low quality, watermark, text, signature, gradient, vignette, frame, border, "
    "people, hands, grass, ground, sky, perspective, isometric, 3D object, single object, "
    "shadows, drop shadow, cast shadow, ambient occlusion, dark shading, hard lighting, "
    "directional light, gradient lighting, repetitive pattern, repeating texture"
)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--grades", default="FEDCBA", help="要生成的级别")
    ap.add_argument("--seed", type=int, default=4001)
    ap.add_argument("--steps", type=int, default=36, help="生成步数（多步=细节更饱满）")
    args = ap.parse_args()
    os.makedirs(OUT_DIR, exist_ok=True)
    seed = args.seed
    for g in args.grades:
        out = os.path.join(OUT_DIR, f"tex_{g}.png")
        prompt = THEME[g] + TAIL
        cmd = [
            "python", GEN, "--host", "192.168.3.142", "--model", "flux2-dev-fp8",
            "--size", "1024x668", "--seed", str(seed), "--steps", str(args.steps),
            "--prompt", prompt, "--out", out,
        ]
        print(f"--- {g} (seed {seed}) ---", flush=True)
        r = subprocess.run(cmd)
        if r.returncode != 0:
            print(f"[{g}] FAILED rc={r.returncode}", flush=True)
        seed += 17


if __name__ == "__main__":
    main()
