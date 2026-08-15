#!/usr/bin/env python3
"""世界-122 能源水晶簇变体规格生成器（2026-08-15 用户要求：随机多种形态，不统一格式）。

参考：真实晶簇（多根晶体高低错落/不同倾角，从岩石底座长出）+ 掩体与地板衔接
（墙脚接触阴影 40% 黑渐变，贴图烘焙）。
每个变体 = 随机数量的倾斜棱柱晶体（3~8 根，含倒伏/倾斜怪形）+ 随机岩石土堆底座
（宽/深/高/圆角随机，偶有副土堆），材质从 3 张水晶纹理/2 张土堆纹理随机抽取。
输出 6 份 spec JSON（v1..v6）到 out 目录；--depleted 输出指向去饱和材质的版本。
"""
import json
import math
import os
import random
import sys

TEX_CRYSTALS = ["tex_crystal_c1.png", "tex_crystal_c2.png", "tex_crystal_c3.png"]
TEX_MOUNDS = ["tex_mound_m1.png", "tex_mound_m2.png"]


def gen_spec(seed, depleted):
    rng = random.Random(seed)
    prims = []
    # 底座：随机宽/深/高/圆角；25% 概率加一个小副土堆（不规则轮廓）
    mw = rng.uniform(80, 112)
    md = rng.uniform(60, 92)
    mh = rng.uniform(18, 30)
    mbevel = rng.uniform(7, 12)
    mound_tex = rng.choice(TEX_MOUNDS)
    if depleted:
        mound_tex = mound_tex.replace(".png", "_dep.png")
    prims.append({
        "type": "box", "size": [round(mw, 1), round(md, 1), round(mh, 1)],
        "pos": [0, 0, round(mh / 2, 1)], "bevel": round(mbevel, 1), "tex": mound_tex,
    })
    if rng.random() < 0.25:
        sw = rng.uniform(30, 48)
        sd = rng.uniform(24, 40)
        sh = rng.uniform(8, 14)
        sx = rng.choice([-1, 1]) * rng.uniform(40, 60)
        prims.append({
            "type": "box", "size": [round(sw, 1), round(sd, 1), round(sh, 1)],
            "pos": [round(sx, 1), 0, round(sh / 2, 1)], "bevel": round(rng.uniform(5, 8), 1), "tex": mound_tex,
        })

    # 晶体：3~8 根，高低错落、倾角随机，至少一根高主晶、允许倒伏短晶（倾斜 40°+）
    count = rng.randint(3, 8)
    heights = []
    main_idx = rng.randrange(count)
    for i in range(count):
        if i == main_idx:
            h = rng.uniform(70, 100)
        elif rng.random() < 0.3:
            h = rng.uniform(18, 34)      # 矮小/倒伏
        else:
            h = rng.uniform(34, 68)
        heights.append(h)
    # 按高度大致排布：主晶靠中，其余向外散
    for i, h in enumerate(heights):
        if i == main_idx:
            px, py = rng.uniform(-6, 6), rng.uniform(-4, 4)
            tilt = rng.uniform(-6, 6)
            l, w = rng.uniform(18, 24), rng.uniform(14, 18)
        elif h <= 34:
            # 倒伏/倾斜短晶：大倾角
            px = rng.choice([-1, 1]) * rng.uniform(26, 46)
            py = rng.uniform(-12, 12)
            tilt = rng.choice([-1, 1]) * rng.uniform(38, 62)
            l, w = rng.uniform(12, 18), rng.uniform(8, 12)
        else:
            px = rng.choice([-1, 1]) * rng.uniform(18, 44)
            py = rng.choice([-1, 1]) * rng.uniform(6, 14)
            tilt = rng.choice([-1, 1]) * rng.uniform(6, 20)
            l, w = rng.uniform(12, 20), rng.uniform(9, 14)
        tex = rng.choice(TEX_CRYSTALS)
        if depleted:
            tex = tex.replace(".png", "_dep.png")
        prims.append({
            "type": "prism", "size": [round(l, 1), round(w, 1), round(h, 1)],
            "pos": [round(px, 1), round(py, 1), 0], "rot": [0, 0, round(tilt, 1)], "tex": tex,
        })

    return {
        "elevation": 5,
        "bottom_y": 870,
        "max_width_frac": 0.72,
        "top_margin_px": 90,
        "primitives": prims,
    }


def main():
    out_dir = sys.argv[1]
    depleted = "--depleted" in sys.argv
    os.makedirs(out_dir, exist_ok=True)
    for v in range(1, 7):
        spec = gen_spec(seed=20260000 + v, depleted=depleted)
        name = f"energy_node_dep_v{v}.json" if depleted else f"energy_node_v{v}.json"
        with open(os.path.join(out_dir, name), "w", encoding="utf-8") as f:
            json.dump(spec, f, ensure_ascii=False, indent=2)
        print("wrote", name, "prims=", len(spec["primitives"]))


if __name__ == "__main__":
    main()
