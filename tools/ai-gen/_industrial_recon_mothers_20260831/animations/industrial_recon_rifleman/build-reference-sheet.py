"""Extract accepted long-rifle gait phases used for direction review."""

from pathlib import Path

from PIL import Image, ImageDraw, ImageOps


ROOT = Path(__file__).resolve().parent
PROJECT = ROOT.parents[4]
ATLAS = PROJECT / "assets" / "companions" / "hamster_sniper" / "running.png"
OUTPUT = ROOT / "references" / "hamster-sniper-running-f00-f11-f22-f33.png"
FRAME_SIZE = 512
COLS = 8
INDICES = [0, 11, 22, 33]
CELL = (512, 560)


atlas = Image.open(ATLAS).convert("RGBA")
sheet = Image.new("RGB", (len(INDICES) * CELL[0], CELL[1]), "#d8d8d8")
draw = ImageDraw.Draw(sheet)
for cell, index in enumerate(INDICES):
    left = (index % COLS) * FRAME_SIZE
    top = (index // COLS) * FRAME_SIZE
    frame = atlas.crop((left, top, left + FRAME_SIZE, top + FRAME_SIZE))
    checker = Image.new("RGB", (FRAME_SIZE, FRAME_SIZE), "#ededed")
    checker.paste(frame.convert("RGB"), mask=frame.getchannel("A"))
    sheet.paste(ImageOps.contain(checker, (CELL[0], 512)), (cell * CELL[0], 0))
    draw.text((cell * CELL[0] + 12, 524), f"0-based frame {index}", fill="#111111")

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
sheet.save(OUTPUT)
print(OUTPUT)
