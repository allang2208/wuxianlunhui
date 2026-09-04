"""Compose review sheets from Blender renders without altering model artwork."""
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


HERE = Path(__file__).resolve().parent
ENTRIES = json.loads((HERE / 'design.json').read_text(encoding='utf-8'))['buildings']
FONT = 'C:/Windows/Fonts/msyh.ttc'
BOLD = 'C:/Windows/Fonts/msyhbd.ttc'
INK = '#33433D'
MUTED = '#6F7D74'
PAPER = '#ECEFE9'
CARD = '#F8F9F5'
OUTLINE = '#D5DCD2'


def label(draw, position, value, size=26, color=INK, bold=False):
    draw.text(position, value, fill=color,
              font=ImageFont.truetype(BOLD if bold else FONT, size))


def model(canvas, key, suffix, box):
    source = Image.open(HERE / key / (key + suffix)).convert('RGBA')
    source = source.crop(source.getchannel('A').getbbox())
    left, top, right, bottom = box
    source.thumbnail((right - left, bottom - top), Image.Resampling.LANCZOS)
    canvas.paste(source, (left + (right - left - source.width) // 2, bottom - source.height), source)


def hero():
    canvas = Image.new('RGB', (1920, 1060), PAPER)
    draw = ImageDraw.Draw(canvas)
    label(draw, (54, 32), '近代过渡建筑 · 第二批模型', 44, bold=True)
    label(draw, (56, 104), '沿用现有系列结构与底座尺寸　/　工业材质与局部机械改造　/　未接入游戏', 26, MUTED)
    families = ['骑兵学院系列', '工程营地系列', '铁匠铺系列']
    notes = [
        ['金属单坡顶 · 三座猫窝 · 骑枪架', '保留开放训练场和三组障碍'],
        ['砖钢厂房 · 钢吊架 · 屋面采光窗', '短装配导轨，不烘入火炮单位'],
        ['砖烟囱 · 蒸汽飞轮 · 机械锻锤', '材料箱、工具与小型加工机械'],
    ]
    for index, entry in enumerate(ENTRIES):
        x = 48 + index * 624
        draw.rounded_rectangle((x, 175, x + 600, 986), radius=20, fill=CARD, outline=OUTLINE, width=2)
        label(draw, (x + 26, 196), f'0{index + 1}  {families[index]}', 24, MUTED)
        label(draw, (x + 26, 244), entry['name'], 35, bold=True)
        model(canvas, entry['id'], '_model_approval_preview.png', (x + 24, 326, x + 576, 820))
        draw.line((x + 26, 855, x + 574, 855), fill=OUTLINE, width=2)
        label(draw, (x + 26, 882), notes[index][0], 25)
        label(draw, (x + 26, 926), notes[index][1], 24, MUTED)
    label(draw, (56, 1010), '模型阶段：可编辑 Blender / 透明预览 / Depth 已导出；保留既有中世纪与现代版本。', 24, MUTED)
    target = HERE / 'industrial_support_model_approval_preview.png'
    canvas.save(target)
    print(target)


def evolution():
    canvas = Image.new('RGB', (1920, 2070), PAPER)
    draw = ImageDraw.Draw(canvas)
    label(draw, (54, 30), '同系列时代演进 · 模型对照', 44, bold=True)
    label(draw, (56, 101), '中列为本轮新增方案；左右列均为既有 Blender 模型。各图按版面缩放，不代表游戏内尺寸。', 25, MUTED)
    columns = [('既有中世纪基型', '_previous_model_preview.png'),
               ('本轮近代过渡态', '_model_approval_preview.png'),
               ('既有现代形态', '_modern_model_preview.png')]
    families = ['01  骑兵学院系列', '02  工程营地系列', '03  铁匠铺系列']
    for col, (title, _) in enumerate(columns):
        label(draw, (78 + 624 * col, 162), title, 30, '#426052' if col == 1 else MUTED, True)
    for row, entry in enumerate(ENTRIES):
        y = 228 + row * 587
        for col, (_, suffix) in enumerate(columns):
            x = 48 + col * 624
            draw.rounded_rectangle((x, y, x + 600, y + 562), radius=18,
                                   fill='#F0F5ED' if col == 1 else CARD,
                                   outline='#A8BAA5' if col == 1 else OUTLINE, width=2)
            label(draw, (x + 24, y + 17), entry['name'] if col == 1 else families[row], 25,
                  '#426052' if col == 1 else MUTED, col == 1)
            model(canvas, entry['id'], suffix, (x + 24, y + 74, x + 576, y + 539))
    label(draw, (56, 2010), '本轮仅建模：不修改科技树、兵种配置、正式贴图、逻辑占格、碰撞或寻路。', 24, MUTED)
    target = HERE / 'industrial_support_evolution_board.png'
    canvas.save(target)
    print(target)


if __name__ == '__main__':
    hero()
    evolution()
