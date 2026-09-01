"""Offline source-pixel contact sheet for native recovery palm authoring."""
import importlib.util
import json
from pathlib import Path
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('author', HERE/'build_transitions.py')
a = importlib.util.module_from_spec(spec)
spec.loader.exec_module(a)
poses = json.loads((a.ROOT/'data/player-thrust-recover-poses.json').read_text(encoding='utf-8'))
board = Image.new('RGB',(1536,960),'#293039')
draw = ImageDraw.Draw(board)
for index, pose in enumerate(poses['frames']):
    frame = a.source_frame('dash_recover_thrust',index)
    # True source coordinates, no shape or scale changes. Each crop centers on
    # the main hand and shows both neighboring palms where they are visible.
    mx,my = pose['main']
    left,top = round(mx-96),round(my-92)
    crop = frame.crop((left,top,left+288,top+184)).resize((312,200),Image.Resampling.NEAREST)
    x,y=index%4*384,index//4*240
    board.paste(crop,(x+68,y+24),crop)
    draw.text((x+5,y+6),f'f{index:02d}',font=a.SMALL,fill='#e5b15b')
    for name,color in [('main','#e5b15b'),('off','#65c9c4')]:
        px=x+68+(pose[name][0]-left)*312/288
        py=y+24+(pose[name][1]-top)*200/184
        draw.line((px-9,py,px+9,py),fill=color,width=2)
        draw.line((px,py-9,px,py+9),fill=color,width=2)
        draw.text((x+5,y+(32 if name=='main' else 55)),name,font=a.SMALL,fill=color)
out=HERE/'power-v3'
out.mkdir(exist_ok=True)
board.save(out/'native-recover-palm-source.png')
print('Authored native recovery palm source board; no game run.')
