"""Arrange unchanged mother images in a labeled three-tier review sheet."""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
index = json.loads((ROOT / "task-index.json").read_text(encoding="utf-8"))
sheet = Image.new("RGB", (1800, 650), "white")
draw = ImageDraw.Draw(sheet)
font = lambda size: ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", size)
draw.text((32, 16), "仓鼠工程器械兵种  ·  LV1—LV3 母图候选", font=font(32), fill="#263535")
for number, task in enumerate(index["tasks"]):
    x = number * 600
    source = Image.open(ROOT / task["output"]).convert("RGB")
    source.thumbnail((596, 420), Image.Resampling.LANCZOS)
    sheet.paste(source, (x + (600 - source.width) // 2, 88 + (420 - source.height) // 2))
    draw.text((x + 28, 520), f"LV{task['level']}  {task['unitName']}", font=font(28), fill="#263535")
    draw.text((x + 28, 561), task["building"] + "  /  两只仓鼠 + 一台器械", font=font(20), fill="#667371")
draw.text((32, 611), "仅母图设计 · 尚未批准入库 · 未生成动画或实现战斗逻辑", font=font(20), fill="#667371")
output = ROOT / index["preview"]
output.parent.mkdir(parents=True, exist_ok=True)
sheet.save(output)
print(output)
