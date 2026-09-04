from pathlib import Path
import av
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent
for name in ('walking', 'carry-walking'):
    frames = [f.to_image() for f in av.open(str(ROOT / 'animations-v02-direction/videos' / f'{name}-h3-v01.mp4')).decode(video=0)]
    board = Image.new('RGB', (1200, 840), '#e1e4e8')
    draw = ImageDraw.Draw(board)
    for k, i in enumerate(range(16, 96, 2)):
        x, y = k % 8 * 150, k // 8 * 168
        crop = frames[i].crop((350, 330, 605, 480))
        crop.thumbnail((148, 140))
        board.paste(crop, (x, y))
        draw.text((x+4, y+142), f'{i} / {i/24:.3f}s', fill='black')
    board.save(ROOT / f'{name}-loop-poses.png')
