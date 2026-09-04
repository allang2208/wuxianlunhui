"""Pixel-preserving archive + shared uniform padding for the two approved-scope pose edits."""
import json
import shutil
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
TASK = ROOT.parent
GEN = Path('C:/Users/allan/.codex/generated_images/01a056cc-b3b8-7ea0-808b-05ffc9c09185')
SOURCES = {
    'walking': GEN / 'exec-03a1a0dc-53d9-482d-944f-97ae24ba4785.png',
    'carry-walking': GEN / 'exec-bb556fe4-73c7-4d27-9c60-edbf8c96e631.png',
}

records = []
for action, source in SOURCES.items():
    local = ROOT / 'references' / f'{action}-keyframe-v01.png'
    shutil.copyfile(source, local)
    im = Image.open(local).convert('RGB')
    if im.size != (1254, 1254):
        raise ValueError(f'Unexpected source size: {im.size}')
    square = Image.new('RGB', (1536, 1536), 'white')
    square.paste(im, (141, 141))
    canvas = Image.new('RGB', (1024, 576), 'white')
    canvas.paste(square.resize((576, 576), Image.Resampling.LANCZOS), (224, 0))
    output = ROOT / 'references' / f'{action}-h3-ref-v01.png'
    canvas.save(output)
    records.append({'action': action, 'generatedSource': str(source),
        'keyframe': local.relative_to(ROOT).as_posix(), 'copyUnmodified': True,
        'h3Reference': output.relative_to(ROOT).as_posix(),
        'sourceSize': list(im.size), 'paddedSquare': [1536, 1536],
        'sourcePasteOffset': [141, 141], 'uniformScale': 0.375,
        'outputSize': [1024, 576], 'pasteOffset': [224, 0],
        'filter': 'Lanczos', 'perFrameOrPerActionAutoFit': False})

(ROOT / 'reference-preparation.json').write_text(json.dumps(records, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')

# Inspection board only. Display crops/scales do not define runtime body scale.
font = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 23)
small = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 18)
board = Image.new('RGB', (1600, 510), '#eef1f5')
draw = ImageDraw.Draw(board)
draw.text((18, 12), '视频提交前朝向核对｜原展示母图 → 重机枪方向参考 → 新空载 / 负重动作帧', font=font, fill='#202d3c')
items = [
    ('原展示母图（非步态基准）', TASK/'mother/hamster-mining-expert-mother-v01.png', (150, 70, 1170, 1200)),
    ('重机枪兵 · 动作帧7', ROOT/'references/heavy-machine-gunner-direction-f07.png', (120, 175, 910, 820)),
    ('新空载 · 侧向迈步', ROOT/'references/walking-keyframe-v01.png', (145, 115, 1180, 1155)),
    ('新负重 · 同一相机/步轴', ROOT/'references/carry-walking-keyframe-v01.png', (145, 115, 1180, 1155)),
]
for i, (title, path, crop) in enumerate(items):
    draw.text((i*400+16, 60), title, font=small, fill='#202d3c')
    im = Image.open(path).convert('RGB').crop(crop)
    im.thumbnail((374, 366), Image.Resampling.LANCZOS)
    board.paste(im, (i*400+(400-im.width)//2, 100+(366-im.height)//2))
draw.text((18, 480), '仅离线方向对照，非游戏截图或体型标定；保留轻微俯视与少量正面可见。', font=small, fill='#4a596b')
board.save(ROOT/'previews/keyframe-direction-check.png')
print(json.dumps(records, ensure_ascii=False, indent=2))
