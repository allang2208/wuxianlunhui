"""Present the new near-modern tent beside its existing modern model reference."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
board = Image.new('RGB', (1840, 1260), '#EDEFEA')
draw = ImageDraw.Draw(board)


def text(x, y, message, size=28, bold=False, color='#3D4B41'):
    font = ImageFont.truetype('C:/Windows/Fonts/msyhbd.ttc' if bold else 'C:/Windows/Fonts/msyh.ttc', size)
    draw.text((x, y), message, font=font, fill=color)


text(48, 34, '近现代军营 · 帐篷与瞭望塔改型', 43, True)
text(48, 96, '本次只调整军营；侦察营地、靶场和现有现代军营素材均保持不动。', 25, color='#758074')
for x, filename, title, note in [
    (40, 'industrial_barracks_model_approval_preview.png', '本次方案：近代中间态', '卡其帐篷 / 木钢混合塔 / 更低、更宽的观测平台'),
    (940, 'modern_reference_model_preview.png', '设计参考：现有现代军营白模', '橄榄帐篷 / 高钢架瞭望塔 / 现代装备组合'),
]:
    draw.rounded_rectangle((x, 160, x + 860, 1120), radius=22, fill='#F9FAF7', outline='#D8DED4', width=2)
    text(x + 26, 181, title, 31, True)
    im = Image.open(HERE / filename).convert('RGBA').resize((848, 848), Image.Resampling.LANCZOS)
    board.paste(im, (x + 6, 226), im)
    text(x + 26, 1070, note, 24)
text(50, 1150, '帐篷：下垂布面、绑带、拉绳、系束门帘　　塔楼：钢脚座、交叉撑、梯口与落地连接步道', 26)
text(50, 1204, 'Blender 模型设计稿 · 原占地与标准正交视角 · 尚未 AI 精修或接入游戏', 24, color='#788171')
target = HERE / 'industrial_barracks_design_board.png'
board.save(target)
print(target)
