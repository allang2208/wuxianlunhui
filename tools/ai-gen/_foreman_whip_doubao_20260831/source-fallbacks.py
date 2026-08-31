from pathlib import Path
import importlib.util
import sys
import av
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parent
sys.path.insert(0, str(root.parent))
from rmbg_cutout import get_model
spec = importlib.util.spec_from_file_location('cutout', root / 'build-candidate.py')
cutout = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cutout)
model = get_model()
with av.open(str(root / 'videos/whip-v04.mp4')) as container:
    frames = [frame.to_ndarray(format='rgb24') for frame in container.decode(video=0)]
for index in [6, 41, 45]:
    target = root / f'source-inputs/whip-v04-optimized/{index:04d}.png'
    if not target.exists():
        Image.fromarray(cutout.cutout(frames[index], model)).save(target)
        print(f'Additional original pose {index}', flush=True)
indices = [4, 6, 14, 22, 30, 36, 40, 41, 43, 45, 46, 48, 51, 56, 62, 70, 76, 84]
contact = Image.new('RGB', (4 * 350, 5 * 320), '#454545')
draw = ImageDraw.Draw(contact)
for i, index in enumerate(indices):
    actor = Image.open(root / f'source-inputs/whip-v04-optimized/{index:04d}.png').convert('RGBA').crop((350,150,700,450))
    x, y = i % 4 * 350, i // 4 * 320
    contact.paste(actor, (x,y), actor)
    for sx in range(400, 700, 50):
        draw.line((x+sx-350,y,x+sx-350,y+300), fill='#686868')
        draw.text((x+sx-348,y+2), str(sx), fill='white')
    for sy in range(200,450,50):
        draw.line((x,y+sy-150,x+350,y+sy-150), fill='#686868')
        draw.text((x+2,y+sy-148), str(sy), fill='white')
    draw.text((x+4,y+304), f'source {index}', fill='white')
contact.save(root / 'previews/source-hand-reference.png')
