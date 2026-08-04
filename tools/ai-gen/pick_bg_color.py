#!/usr/bin/env python3
"""AI 背景色选择器：为「纯色底出图 → 阈值抠图」管线挑选与主体冲突最小的底色。

方案一（透明主体）要求背景必须是主体里绝对没有的纯色：这样白/浅色主体也能靠
颜色距离一刀切干净，不需要 AI 猜边缘（BiRefNet 只做边缘精修）。

本模块扫描提示词里的颜色词（中文/英文/hex），估算主体色板，再从候选纯色里挑
与主体色距离最远的一个。确定性逻辑、可复现；也可用 --bg-color #RRGGBB 人工覆盖。

用法：
    python pick_bg_color.py --prompt "a white knight armor with gold trim"
    python pick_bg_color.py --prompt "green slime monster" --debug
"""

import argparse
import re

# (正则, RGB, 权重) —— 权重越高表示该颜色在提示词里越明确/越重要，越要避开
COLOR_PATTERNS = [
    (r"white|pure white|银白|雪白|白", (255, 255, 255), 2.0),
    (r"black|纯黑|漆黑|黑", (20, 20, 20), 2.0),
    (r"gray|grey|silver|银色|银灰|灰", (170, 170, 170), 1.5),
    (r"red|crimson|scarlet|猩红|红", (215, 45, 45), 2.0),
    (r"orange|amber|琥珀|橙", (240, 140, 20), 2.0),
    (r"yellow|gold|golden|金黄|金|黄", (225, 185, 40), 2.0),
    (r"green|emerald|翠绿|绿", (45, 175, 70), 2.0),
    (r"cyan|teal|turquoise|青绿|青", (0, 175, 175), 2.0),
    (r"blue|azure|navy|海蓝|深蓝|蓝", (45, 85, 220), 2.0),
    (r"purple|violet|紫罗兰|紫", (150, 60, 220), 2.0),
    (r"pink|rose|粉", (230, 120, 180), 1.5),
    (r"brown|bronze|copper|古铜|棕褐|棕", (150, 100, 55), 1.5),
    (r"dark|midnight|暗|夜", (25, 25, 40), 1.0),
    (r"bright|light|浅色|亮", (255, 255, 255), 0.5),
]

# 候选纯色背景（高饱和；FLUX/SDXL 对 hex 颜色指令跟随稳定）
CANDIDATES = [
    ("vivid magenta", "FF00FF", (255, 0, 255)),
    ("pure green", "00FF00", (0, 255, 0)),
    ("pure blue", "0000FF", (0, 0, 255)),
    ("vivid cyan", "00FFFF", (0, 255, 255)),
    ("bright yellow", "FFFF00", (255, 255, 0)),
    ("pure red", "FF0000", (255, 0, 0)),
    ("bright orange", "FF8000", (255, 128, 0)),
    ("vivid purple", "8000FF", (128, 0, 255)),
    ("deep teal", "008080", (0, 128, 128)),
    ("bright lime", "80FF00", (128, 255, 0)),
]

HEX_RE = re.compile(r"#([0-9a-fA-F]{6})")


def parse_hex(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def _hex(rgb):
    return "".join(f"{int(x):02X}" for x in rgb)


def _dist(a, b):
    return sum((x - y) ** 2 for x, y in zip(a, b)) ** 0.5


def detect_subject_colors(prompt):
    """返回 [(rgb, weight)]；同一颜色词出现多次按次数加权（上限 3 次）。"""
    found = []
    for pat, rgb, w in COLOR_PATTERNS:
        n = len(re.findall(pat, prompt, flags=re.IGNORECASE))
        if n:
            found.append((rgb, w * min(n, 3)))
    for m in HEX_RE.finditer(prompt):
        found.append((parse_hex(m.group(1)), 3.0))
    return found


def pick_bg_color(prompt):
    """选底色。返回 {name, hex, rgb, reason}。"""
    palette = detect_subject_colors(prompt)
    if not palette:
        name, h, rgb = CANDIDATES[0]
        return {"name": name, "hex": h, "rgb": rgb,
                "reason": "提示词未检测到颜色信息，默认品红（与常见主体色冲突概率最低）"}

    avg_lum = sum(c[0] * 0.3 + c[1] * 0.6 + c[2] * 0.1 for c, _ in palette) / len(palette)
    best, best_score = None, -1.0
    for name, h, rgb in CANDIDATES:
        min_d = min(_dist(rgb, c) / (w ** 0.5) for c, w in palette)
        lum = rgb[0] * 0.3 + rgb[1] * 0.6 + rgb[2] * 0.1
        score = min_d + abs(lum - avg_lum) / 255.0 * 60.0  # 距离优先，亮度对比平局判定
        if score > best_score:
            best_score, best = score, (name, h, rgb)

    name, h, rgb = best
    colors = "、".join(f"#{_hex(c)}" for c, _ in palette)
    min_d = min(_dist(rgb, c) / (w ** 0.5) for c, w in palette)
    return {"name": name, "hex": h, "rgb": rgb,
            "reason": f"主体色板 {colors}；{name} #{h} 与最近主体色距离≈{int(min_d)}，冲突概率最低"}


def name_for_hex(hexcode):
    """把用户指定的 #RRGGBB 归一到最近的候选色名（用于提示词）。"""
    rgb = parse_hex(hexcode)
    return min(CANDIDATES, key=lambda c: _dist(c[2], rgb))[0]


def background_clause(name, hexcode):
    return (f"isolated on a perfectly uniform solid {name} background (#{hexcode}), "
            "flat solid color backdrop, no gradient, no texture, no shadow, "
            "no reflection, no other objects")


def inject_background(prompt, name, hexcode):
    """把纯色底写进提示词：已有纯色底描述则保留；white background 则替换；否则追加。"""
    if re.search(r"solid\s+[a-z]+\s+background\s*\(?#[0-9A-Fa-f]{6}\)?", prompt, re.I):
        return prompt
    clause = background_clause(name, hexcode)
    if re.search(r"\bbackground\b", prompt, re.I) and not re.search(
            r"(?:pure|plain|clean)?\s*white\s+background", prompt, re.I):
        return prompt.rstrip(" .,") + ", " + clause
    replaced = re.sub(r"(?:pure|plain|clean)?\s*white\s+background",
                      f"solid {name} background (#{hexcode})", prompt, flags=re.I)
    if replaced != prompt:
        return replaced
    return prompt.rstrip(" .,") + ", " + clause


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--prompt", required=True, help="生成提示词/主体描述（中英文均可）")
    ap.add_argument("--debug", action="store_true", help="打印检测到的主体色板")
    args = ap.parse_args()

    palette = detect_subject_colors(args.prompt)
    if args.debug:
        for c, w in palette:
            print(f"  subject color #{_hex(c)} weight={w:.1f}")
    pick = pick_bg_color(args.prompt)
    print(f"selected: {pick['name']} #{pick['hex']}")
    print(f"reason: {pick['reason']}")


if __name__ == "__main__":
    main()
