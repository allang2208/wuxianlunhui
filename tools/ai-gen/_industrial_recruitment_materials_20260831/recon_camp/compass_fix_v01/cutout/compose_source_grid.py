"""Coordinate-labelled source details for the cutout's bounded repair regions."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
source = Image.open(HERE.parent / 'recon_camp_industrial_s48_v01_compass_fix.png').convert('RGB')
font = ImageFont.truetype('C:/Windows/Fonts/consola.ttf', 17)
parts = [
    ('flags', (330, 210, 430, 340), 3),
    ('tower', (175, 510, 430, 900), 2),
    ('left base', (50, 760, 250, 980), 2),
    ('front base', (420, 1010, 680, 1150), 2),
    ('right base', (1000, 750, 1210, 880), 2),
]
canvas = Image.new('RGB', (1820, 950), '#e8e9e6')
draw = ImageDraw.Draw(canvas)
placements = [(15,45), (340,45), (875,45), (875,555), (1395,45)]
for (title, box, factor), (left, top) in zip(parts, placements):
    crop = source.crop(box).resize(((box[2]-box[0])*factor, (box[3]-box[1])*factor), Image.Resampling.NEAREST)
    cd = ImageDraw.Draw(crop)
    for x in range(((box[0]+24)//25)*25, box[2], 25):
        px=(x-box[0])*factor
        cd.line((px,0,px,crop.height), fill='#b0b0b0', width=1)
        cd.text((px+2, 2), str(x), fill='#ffffff', stroke_width=1, stroke_fill='#222222', font=font)
    for y in range(((box[1]+24)//25)*25, box[3], 25):
        py=(y-box[1])*factor
        cd.line((0,py,crop.width,py), fill='#b0b0b0', width=1)
        cd.text((2,py+2), str(y), fill='#ffffff', stroke_width=1, stroke_fill='#222222', font=font)
    canvas.paste(crop, (left, top))
    draw.text((left,top-27), title, fill='#333333', font=font)
canvas.save(HERE / 'source_coordinate_details.png')
