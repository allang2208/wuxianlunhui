"""Offline presentation of the three selected transparent candidates."""
from pathlib import Path
import json
from PIL import Image, ImageDraw, ImageFont
import numpy as np

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
font = lambda size: ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', size)
assets = [
    ('cavalry_academy_industrial', '近代骑兵学院', '三座开放猫窝 · 三组障碍 · 六支骑枪'),
    ('artillery_workshop_industrial', '近代炮兵工坊', '双采光窗 · 开放装配门 · 吊架与工具台'),
    ('steam_arsenal_industrial', '蒸汽军工厂', '打开装卸门 · 材料箱与机械 · 飞轮锻锤'),
]
board = Image.new('RGB', (2160, 1060), '#e7ece7')
d = ImageDraw.Draw(board)
d.text((28, 22), '近代过渡建筑 · 三栋48步透明候选', font=font(38), fill='#30453b')
d.text((28, 83), '沿用现有模型设计；选稿与修正来源均保留。未替换游戏资源。', font=font(23), fill='#62766b')
for i, (key, title, description) in enumerate(assets):
    folder = ROOT/key/'refine_s48_b01'
    record = json.loads((folder/'selection.json').read_text(encoding='utf-8'))
    im = Image.open(folder/'cutout/transparent.png').convert('RGBA')
    x = i*720
    d.rounded_rectangle((x+16, 142, x+704, 978), radius=12, fill='#f5f6f1')
    d.text((x+40, 163), title, font=font(32), fill='#34483d')
    d.text((x+40, 212), f'48步 {record["selectedCandidate"]:02d} · RGBA {im.width}×{im.height}', font=font(21), fill='#617369')
    p = im.copy()
    p.thumbnail((648, 610), Image.Resampling.LANCZOS)
    board.paste(p, (x+36+(648-p.width)//2, 272+(610-p.height)//2), p)
    d.text((x+40, 909), description, font=font(22), fill='#455e50')
d.text((28, 1007), '此图为单栋展示，不代表游戏内相对大小；未运行测试或运行时验证。', font=font(24), fill='#617369')
board.save(ROOT/'industrial_support_delivery_preview.png')

# Refresh the academy close-up from the final RGB-cleaned source.
folder = ROOT/'cavalry_academy_industrial/refine_s48_b01/cutout'
im = Image.open(folder/'body_full.png').convert('RGBA')
board = Image.new('RGB', (1380, 540), '#bec4c4')
d = ImageDraw.Draw(board)
for i, (title, rect) in enumerate([
    ('敞开的门扇与入口', (588, 713, 798, 852)),
    ('后侧栏杆透明间隙', (620, 425, 956, 640)),
]):
    p = im.crop(rect)
    yy, xx = np.indices((p.height, p.width))
    pixels = np.where((((xx//12)+(yy//12))%2)[..., None], [82,86,90], [198,202,202]).astype('uint8')
    b = Image.fromarray(pixels).convert('RGBA')
    b.alpha_composite(p)
    b = b.resize((p.width*2, p.height*2), Image.Resampling.NEAREST)
    board.paste(b, (i*680+12, 50))
    d.text((i*680+12, 14), title, fill='#263d34', font=font(22))
board.save(folder/'open_structure_detail.png')
print(ROOT/'industrial_support_delivery_preview.png')
