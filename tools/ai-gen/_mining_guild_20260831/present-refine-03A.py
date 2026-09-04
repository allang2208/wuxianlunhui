"""Present accepted 03A and both complete 48-step raw images without retouching."""
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
BATCH = ROOT / "candidates_03A_dev_s48/mining_guild"
BOARD = Image.new("RGB", (1664, 840), (27, 31, 35))
DRAW = ImageDraw.Draw(BOARD)
FONT = "C:/Windows/Fonts/msyh.ttc"


def label(x, y, text, size=22, color=(220, 225, 226)):
    DRAW.text((x, y), text, font=ImageFont.truetype(FONT, size), fill=color)


label(32, 24, "矿业工会 · 03A进入48步精修", 32)
label(32, 75, "DEV + 原模型完整Depth｜48步 × 2｜denoise 0.30｜Depth 0.75｜建筑v5公共画风", 21,
      (153, 170, 176))
sources = [("已确认03A", ROOT / "refine_03A_inputs/mining_guild_03A_refine_init_green.png", "补绿工作副本")]
for index in range(1, 3):
    stem = f"mining_guild_refine_v{index:02d}"
    metadata = json.loads((BATCH / f"{stem}_generation.json").read_text(encoding="utf-8"))
    sources.append((f"精修{index:02d}", BATCH / f"{stem}_raw.png", f"seed {metadata['seed']}"))

for column, (title, path, detail) in enumerate(sources):
    raw = Image.open(path).convert("RGB")
    x = 32 + column * 544
    label(x, 128, title, 27)
    label(x + 225, 135, detail, 18, (153, 170, 176))
    BOARD.paste(raw.resize((512, 512), Image.Resampling.LANCZOS), (x, 184))

label(32, 722, "完整画布等比展示；精修原图未抠图、未调色、未局部修补或裁剪主体。", 21)
label(32, 763, "03A与原始输入全部保留。新候选尚未选定，未接入游戏或变更建筑占格。", 21,
      (153, 170, 176))
target = ROOT / "mining_guild_03A_dev_s48_comparison.png"
BOARD.save(target)
print(target)
