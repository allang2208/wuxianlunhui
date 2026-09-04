"""Compose accepted recon-camp V03 and both full 48-step raw candidates."""
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


HERE = Path(__file__).resolve().parent
REPO = HERE.parents[4]
KEY = 'recon_camp_industrial'
manifest = json.loads((HERE / 'manifest.json').read_text(encoding='utf-8'))
canvas = Image.new('RGB', (1920, 1000), '#ECEFE9')
draw = ImageDraw.Draw(canvas)


def label(x, y, text, size=25, color='#35443D', bold=False):
    font = 'C:/Windows/Fonts/msyhbd.ttc' if bold else 'C:/Windows/Fonts/msyh.ttc'
    draw.text((x, y), text, fill=color, font=ImageFont.truetype(font, size))


label(54, 30, '近代侦察营地 · 03 → 48 步精修', 44, bold=True)
label(56, 100, 'FLUX.2 Dev + 同一 Depth　/　48 步 × 2 张　/　重绘 0.30　/　完整原图对照', 26, '#6F7D74')
panels = [(REPO / manifest['sourcePreparation']['source'], '12 步 · 已选 03', '精修直接来源 · 原图保留')]
for variant in (1, 2):
    raw = HERE / 'candidates' / KEY / f'{KEY}_refine_v{variant:02d}_raw.png'
    panels.append((raw, f'48 步 · {variant:02d}', f"seed {manifest['refineSeedBase'] + variant} · 完整 raw"))
for index, (path, title, caption) in enumerate(panels):
    x = 48 + index * 624
    draw.rounded_rectangle((x, 168, x + 600, 900), radius=18,
                           fill='#F8F9F5', outline='#D5DCD2', width=2)
    label(x + 22, 190, title, 31, bold=True)
    with Image.open(path) as source:
        panel = source.convert('RGB').resize((576, 576), Image.Resampling.LANCZOS)
    canvas.paste(panel, (x + 12, 250))
    label(x + 22, 848, caption, 25, '#6F7D74')
label(56, 932, '绿底仍是原始幕布，尚未抠图。两张均为待选候选，不会自动替换正式素材。', 25, '#6F7D74')
target = HERE / 'recon_camp_industrial_s48_comparison.png'
canvas.save(target)
print(target)

# Same coordinates and scale for all three sources; display only, never edits raw.
detail = Image.new('RGB', (1500, 470), '#ECEFE9')
detail_draw = ImageDraw.Draw(detail)
detail_font = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 22)
for index, (path, title, caption) in enumerate(panels):
    x = 24 + index * 492
    detail_draw.text((x, 16), title, fill='#35443D', font=detail_font)
    with Image.open(path) as source:
        crop = source.convert('RGB').crop((492, 332, 722, 508))
        crop = crop.resize((460, 352), Image.Resampling.NEAREST)
    detail.paste(crop, (x, 58))
detail_draw.text((24, 430), '同坐标 2 倍放大：罗盘未明显缩小，挂环仍在；仅01的橙锈有所减弱。',
                 fill='#6F7D74', font=detail_font)
detail_target = HERE / 'recon_camp_industrial_s48_detail.png'
detail.save(detail_target)
print(detail_target)
