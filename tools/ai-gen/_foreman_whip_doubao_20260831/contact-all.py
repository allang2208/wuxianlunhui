from pathlib import Path
import json
from PIL import Image, ImageDraw, ImageOps
from importlib.util import spec_from_file_location, module_from_spec

root = Path(__file__).resolve().parent
spec = spec_from_file_location('hybrid', root / 'build-hybrid.py')
hybrid = module_from_spec(spec)
spec.loader.exec_module(hybrid)
meta = json.loads((root / 'hybrid-manifest.json').read_text())
sheet = Image.open(root / 'sheets/foreman-whip-hybrid-candidate.png').convert('RGBA')
w, h = meta['frameWidth'], meta['frameHeight']
contact = Image.new('RGB', (6 * 336, 11 * 188), '#20262d')
draw = ImageDraw.Draw(contact)
for i in range(61):
    frame = sheet.crop((i % 6 * w, i // 6 * h, i % 6 * w + w, i // 6 * h + h))
    preview = ImageOps.contain(hybrid.checker(frame), (336, 168), Image.Resampling.LANCZOS)
    x, y = i % 6 * 336, i // 6 * 188
    contact.paste(preview, (x, y))
    draw.text((x + 4, y + 169), str(i), fill='white')
contact.save(root / 'previews/hybrid-all-frames.png')
