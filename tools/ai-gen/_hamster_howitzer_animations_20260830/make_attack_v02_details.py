"""Magnify the rear-breech region for review; leave the source video unchanged."""
from pathlib import Path
import cv2
import numpy as np
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parent
video = cv2.VideoCapture(str(root/'videos/attack-v02.mp4'))
fps = video.get(cv2.CAP_PROP_FPS)
frames = []
while True:
    ok, bgr = video.read()
    if not ok:
        break
    frames.append(Image.fromarray(cv2.cvtColor(bgr,cv2.COLOR_BGR2RGB)))
video.release()
if not frames or fps <= 0:
    raise RuntimeError('Source video unavailable')
crop = (120,120,648,450)
details = [frame.crop(crop).resize((640,400),Image.Resampling.LANCZOS) for frame in frames]
palette_source = Image.new('RGB',(128,80*len(details)))
for i,frame in enumerate(details):
    palette_source.paste(frame.resize((128,80)),(0,80*i))
palette = palette_source.quantize(colors=255)
indexed = [frame.quantize(palette=palette) for frame in details]
ends = np.rint(np.arange(1,len(frames)+1)/fps*100).astype(int)
durations = (np.diff(np.r_[0,ends])*10).tolist()
indexed[0].save(root/'previews/attack-breech-detail-v02.gif',save_all=True,append_images=indexed[1:],
                duration=durations,loop=0,disposal=2,optimize=False)
selected = [72,84,96,124,140,164,180,191]
contact = Image.new('RGB',(1600,540),'#242830')
draw = ImageDraw.Draw(contact)
for j,frame_id in enumerate(selected):
    x,y = j%4*400,j//4*270
    contact.paste(details[frame_id].resize((400,250)),(x,y+20))
    draw.text((x+6,y+4),f'f{frame_id} / {frame_id/fps:.2f}s',fill='white')
contact.save(root/'previews/attack-breech-contact-v02.jpg',quality=95)
print('Saved breech-detail GIF and contact sheet, original 8s timing.')
