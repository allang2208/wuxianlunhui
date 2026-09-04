"""Display all three complete Dev raw images, without cutout or retouching."""
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
BATCH = ROOT / "candidates_dev_s12/mining_guild"
BOARD = Image.new("RGB", (1664, 800), (27, 31, 35))
DRAW = ImageDraw.Draw(BOARD)
FONT = "C:/Windows/Fonts/msyh.ttc"


def label(x, y, text, size=22, color=(220, 225, 226)):
    DRAW.text((x, y), text, font=ImageFont.truetype(FONT, size), fill=color)


label(32, 24, "矿业工会 · Dev 12步结构候选", 32)
label(32, 75, "已确认模型完整Depth｜建筑v5画风｜1024×1024｜CFG 3.5｜Depth 0.78", 21,
      (153, 170, 176))
for column in range(3):
    number = column + 1
    stem = f"mining_guild_structure_v{number:02d}"
    meta = json.loads((BATCH / f"{stem}_generation.json").read_text(encoding="utf-8"))
    with Image.open(BATCH / f"{stem}_raw.png") as source:
        raw = source.convert("RGB")
    x = 32 + column * 544
    label(x, 128, f"{number}号", 28)
    label(x + 160, 135, f"seed {meta['seed']}", 19, (153, 170, 176))
    BOARD.paste(raw.resize((512, 512), Image.Resampling.LANCZOS), (x, 184))

label(32, 722, "完整绿底原图等比排版：未抠图、未裁主体、未改色，未用Depth遮罩隐藏结构偏移。", 21)
label(32, 761, "仅供结构与画风选稿；尚未进入48步精修，未接入游戏。", 20, (153, 170, 176))
target = ROOT / "mining_guild_dev_s12_candidates.png"
BOARD.save(target)
print(target)
