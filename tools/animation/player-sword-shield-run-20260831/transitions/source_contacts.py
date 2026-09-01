"""Author source reference boards for transition cutouts; never writes runtime assets."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
FONT = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 15)
SOURCES = [('slash', 'dash_attack', 516, 17), ('thrust', 'dash_attack_thrust', 516, 15),
           ('slash-recover', 'dash_recover', 512, 14), ('thrust-recover', 'dash_recover_thrust', 512, 14)]
for name, stem, height, count in SOURCES:
    source = Image.open(ROOT / f'assets/player/{stem}.png').convert('RGBA')
    frames = [source.crop((i % 8 * 512, i // 8 * height, i % 8 * 512 + 512, i // 8 * height + height)) for i in range(count)]
    board = Image.new('RGB', (512 * 4, 380 * ((count + 3) // 4)), '#293039')
    draw = ImageDraw.Draw(board)
    for i, frame in enumerate(frames):
        # Source X unchanged; upper 350px, no image rescale.
        x, y = i % 4 * 512, i // 4 * 380 + 30
        crop = frame.crop((0, 0, 512, 350))
        board.paste(crop, (x, y), crop)
        draw.text((x + 8, y - 25), f'{name} / {i}', font=FONT, fill='#e5b15b')
        for v in range(50, 512, 50):
            draw.line((x + v, y, x + v, y + 350), fill='#46505b')
            draw.text((x + v, y + 330), str(v), font=FONT, fill='#9aabba')
        for v in range(50, 350, 50):
            draw.line((x, y + v, x + 512, y + v), fill='#46505b')
            draw.text((x, y + v), str(v), font=FONT, fill='#9aabba')
    board.save(HERE / f'{name}-source.png')
print('Authored four source contact boards.')
