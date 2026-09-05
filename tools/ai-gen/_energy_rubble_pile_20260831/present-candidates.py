"""Place complete, unretouched Dev outputs side by side for candidate review."""

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--batch", default="candidates_dev_s12")
parser.add_argument("--output", default="energy_rubble_pile_dev_s12_candidates.png")
parser.add_argument("--title", default="能量矿脉 · Dev 12步候选")
parser.add_argument("--compare-first-with", help="compare v01 against v01 from an earlier batch")
args = parser.parse_args()
CANDIDATES = ROOT / args.batch / "energy_rubble_pile"
sources = [(CANDIDATES, variant, f"{variant}号") for variant in range(1, 4)]
if args.compare_first_with:
    sources = [(ROOT / args.compare_first_with / "energy_rubble_pile", 1, "上一批1号"),
               (CANDIDATES, 1, "矮堆1号")]
BOARD = Image.new("RGB", (32 + 544 * len(sources), 800), (27, 31, 35))
DRAW = ImageDraw.Draw(BOARD)
FONT = "C:/Windows/Fonts/msyh.ttc"


def label(x, y, text, size=22, color=(220, 225, 226)):
    DRAW.text((x, y), text, font=ImageFont.truetype(FONT, size), fill=color)


label(32, 24, args.title, 32)
label(32, 75, "同一v2矿石堆Depth｜建筑v5画风｜1024×1024｜CFG 3.5｜Depth 0.78", 21,
      (153, 170, 176))
for column, (directory, variant, title) in enumerate(sources):
    stem = f"energy_rubble_pile_structure_v{variant:02d}"
    metadata = json.loads((directory / f"{stem}_generation.json").read_text(encoding="utf-8"))
    raw = Image.open(directory / f"{stem}_raw.png").convert("RGB")
    x = 32 + column * 544
    label(x, 128, title, 28)
    label(x + 160, 135, f"seed {metadata['seed']}", 19, (153, 170, 176))
    BOARD.paste(raw.resize((512, 512), Image.Resampling.LANCZOS), (x, 184))

label(32, 722, "完整绿底原图等比排版：未抠图、未裁主体、未改色，也未用Depth遮罩隐藏结构偏移。", 21)
label(32, 761, "候选尚未选定；未进入48步精修，未替换正式资产。", 20, (153, 170, 176))
output = ROOT / args.output
BOARD.save(output)
print(output)
