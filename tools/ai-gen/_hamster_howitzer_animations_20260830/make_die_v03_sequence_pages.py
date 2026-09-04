"""Render every source pose into contact pages; do not change animation frames."""
from pathlib import Path
import cv2
from PIL import Image, ImageDraw
import argparse

parser = argparse.ArgumentParser()
parser.add_argument('--revision', choices=['v03','v04'], default='v03')
revision = parser.parse_args().revision

root = Path(__file__).resolve().parent
capture = cv2.VideoCapture(str(root/f'videos/die-{revision}.mp4'))
frames = []
while True:
    ok, frame = capture.read()
    if not ok:
        break
    frames.append(Image.fromarray(cv2.cvtColor(frame,cv2.COLOR_BGR2RGB)))
capture.release()
if not frames:
    raise RuntimeError('No source frames')
for start in range(0,len(frames),40):
    page = Image.new('RGB',(1280,1312),'#252932')
    draw = ImageDraw.Draw(page)
    for slot,frame in enumerate(frames[start:start+40]):
        x,y = slot%5*256,slot//5*164
        page.paste(frame.resize((256,144),Image.Resampling.LANCZOS),(x,y+20))
        draw.text((x+4,y+3),f'f{start+slot:03}',fill='white')
    output = root/f'previews/die-{revision}-sequence-{start//40+1}.jpg'
    page.save(output,quality=93)
    print(output)
