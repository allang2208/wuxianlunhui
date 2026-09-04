"""Offline animation-workflow plates, not screenshots or runtime validation."""
import json
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[3]
CONFIG = json.loads((REPO / 'data/enemy-config.json').read_text(encoding='utf-8'))


def frame(type_key, state, index):
    textures = CONFIG[type_key]['textures']
    layout = textures['frameLayouts'][state]
    image = Image.open(REPO / textures[state]).convert('RGBA')
    w, h = layout['frameWidth'], layout['frameHeight']
    columns = layout.get('columns', image.width // w)
    x, y = (index % columns) * w, (index // columns) * h
    return image.crop((x, y, x+w, y+h)), layout


def place(canvas, type_key, state, index, root, flip=False):
    sprite, layout = frame(type_key, state, index)
    scale = CONFIG[type_key]['render']['spriteSize'] / CONFIG[type_key]['textures']['referenceCell']
    if scale != 1:
        sprite = sprite.resize((round(sprite.width*scale), round(sprite.height*scale)), Image.Resampling.LANCZOS)
    fx = layout.get('footX', layout.get('anchorX', layout['frameWidth']/2))*scale
    fy = layout['footY']*scale
    if flip:
        sprite = sprite.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
        fx = sprite.width-fx
    canvas.alpha_composite(sprite, (round(root[0]-fx), round(root[1]-fy)))


def main():
    references = [('zombieDog', [0,9,18]), ('stitchfaceHeadsman',[0,19,38]), ('pleatDevourer',[0,17,34])]
    plate = Image.new('RGBA',(1350,690),(36,40,45,255))
    draw = ImageDraw.Draw(plate)
    for row,(type_key,indices) in enumerate(references):
        for col,index in enumerate(indices):
            root = (225+450*col,190+230*row)
            place(plate,type_key,'walk',index,root)
            draw.line((root[0]-15,root[1],root[0]+15,root[1]),fill='#d7b66e',width=1)
            draw.text((10+450*col,207+230*row),f'{type_key} walk f{index} | configured world scale',fill='#eeeeee')
    plate.convert('RGB').save(ROOT/'direction-reference-plate.png')
    plate = Image.new('RGBA',(1350,480),(36,40,45,255))
    draw = ImageDraw.Draw(plate)
    for row,flip in enumerate([False,True]):
        for col,index in enumerate([24,26,52]):
            root = (225+450*col,175+240*row)
            place(plate,'pleatDevourer','attack',index,root,flip)
            x0,x1=sorted([root[0],root[0]+(-200 if flip else 200)])
            draw.rectangle((x0,root[1]-24,x1,root[1]+24),outline='#e89069',width=1)
            draw.line((root[0],root[1]-140,root[0],root[1]+25),fill='#70c4bc',width=1)
            draw.text((10+450*col,215+240*row),f'attack f{index} | {index*62.5:.1f}ms | ground 200x96',fill='#eeeeee')
    plate.convert('RGB').save(ROOT/'attack-contact-plate.png')
    for index in range(24,29):
        sprite,layout=frame('pleatDevourer','attack',index)
        bbox=sprite.getchannel('A').point(lambda v:255 if v>=64 else 0).getbbox()
        print('attack',index,'front from root',bbox[2]-layout['footX'])
    print('Wrote two offline plates from actual runtime sheets and configured scales.')


if __name__=='__main__':
    main()
