"""Arrange complete raw candidates for selection; never alter the source images."""
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


HERE = Path(__file__).resolve().parent
KEY = 'recon_camp_industrial'
manifest = json.loads((HERE / 'manifest.json').read_text(encoding='utf-8'))
canvas = Image.new('RGB', (1920, 1000), '#ECEFE9')
draw = ImageDraw.Draw(canvas)


def label(x, y, text, size=25, color='#35443D', bold=False):
    font = 'C:/Windows/Fonts/msyhbd.ttc' if bold else 'C:/Windows/Fonts/msyh.ttc'
    draw.text((x, y), text, fill=color, font=ImageFont.truetype(font, size))


label(54, 30, '近代侦察营地 · 首批 12 步候选', 44, bold=True)
label(56, 100, '同一模型 Depth　/　FLUX.2 Dev　/　12 步 × 3 张　/　完整原图选型', 26, '#6F7D74')
for index in range(3):
    x = 48 + index * 624
    variant = index + 1
    draw.rounded_rectangle((x, 168, x + 600, 900), radius=18,
                           fill='#F8F9F5', outline='#D5DCD2', width=2)
    label(x + 22, 188, f'{variant:02d}', 34, bold=True)
    label(x + 104, 197, f"seed {manifest['structureSeedBase'] + variant}", 23, '#6F7D74')
    raw = HERE / 'candidates' / KEY / f'{KEY}_structure_v{variant:02d}_raw.png'
    with Image.open(raw) as source:
        fitted = source.convert('RGB').resize((576, 576), Image.Resampling.LANCZOS)
        canvas.paste(fitted, (x + 12, 250))
    label(x + 22, 848, '完整 raw · 未抠图 · 未进入 48 步', 25, '#6F7D74')
label(56, 932, '绿色为生图原始幕布；先选结构，选中后再进入精修。候选不自动替换游戏素材。', 25, '#6F7D74')
target = HERE / 'recon_camp_industrial_s12_candidates.png'
canvas.save(target)
print(target)
