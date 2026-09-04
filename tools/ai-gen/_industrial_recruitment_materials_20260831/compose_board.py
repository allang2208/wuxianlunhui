"""Lay out the original Blender previews and new material renders for review."""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
entries = json.loads((HERE / 'design.json').read_text(encoding='utf-8'))['buildings']
FONT = 'C:/Windows/Fonts/msyh.ttc'
BOLD = 'C:/Windows/Fonts/msyhbd.ttc'
canvas = Image.new('RGB', (1920, 1640), '#ECEEEA')
draw = ImageDraw.Draw(canvas)


def text(x, y, value, size=25, color='#39453E', bold=False):
    draw.text((x, y), value, fill=color,
              font=ImageFont.truetype(BOLD if bold else FONT, size))


text(56, 34, '近代出兵建筑 · 材质模型方案', 44, bold=True)
text(56, 98, '原白模结构 / 相机 / 灯光保持不变　·　仅更换材质　·　未接入游戏', 25, '#69746B')
names = ['侦察营地', '军营', '靶场']
notes = ['灰米砖 · 灰绿金属顶 · 暗钢塔架', '棕灰砖 · 灰石压顶 · 卡其军旗', '灰砖 · 灰蓝金属顶 · 米白黑环靶']
swatches = [
    [('灰米砖', '#ABA596'), ('屋面', '#82908B'), ('钢架', '#646E68'), ('卡其', '#A59E81')],
    [('棕灰砖', '#AC9383'), ('灰石', '#B4B6AF'), ('钢件', '#646E68'), ('卡其', '#A59E81')],
    [('灰砖', '#9FA29C'), ('屋面', '#829299'), ('木台', '#897660'), ('靶面', '#D0CBBA')],
]
for index, entry in enumerate(entries):
    x = 48 + index * 624
    draw.rounded_rectangle((x, 170, x + 600, 1515), radius=20, fill='#F8F9F5', outline='#D8DDD4', width=2)
    text(x + 26, 190, f'0{index + 1}  {names[index]}', 34, bold=True)
    text(x + 26, 246, '现有白模材质', 24, '#7C8279')
    for suffix, top in [('_source_model_preview.png', 280), ('_material_approval_preview.png', 902)]:
        im = Image.open(HERE / entry['id'] / (entry['id'] + suffix)).convert('RGBA')
        im = im.resize((570, 570), Image.Resampling.LANCZOS)
        canvas.paste(im, (x + 15, top), im)
    draw.line((x + 25, 864, x + 575, 864), fill='#DCE0D7', width=2)
    text(x + 26, 872, '近代材质方案', 24, '#425C50', bold=True)
    for swatch_index, (label, color) in enumerate(swatches[index]):
        sx = x + 28 + swatch_index * 142
        draw.rounded_rectangle((sx, 1470, sx + 28, 1498), radius=5, fill=color, outline='#B7BDB5')
        text(sx + 36, 1470, label, 20)
    text(x + 20, 1530, notes[index], 24)
text(56, 1590, '说明：对照对象为归档可编辑白模，并非 AI 精修后的正式贴图；这批仍是待确认的模型材质稿。', 23, '#6B736A')
target = HERE / 'industrial_recruitment_material_board.png'
canvas.save(target)
print(target)
