"""Display whole raw images and source references, without changing any source."""
import argparse
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

HERE=Path(__file__).resolve().parent
REPO=HERE.parents[2]
parser=argparse.ArgumentParser()
parser.add_argument('manifest',type=Path)
args=parser.parse_args()
path=args.manifest if args.manifest.is_absolute() else REPO/args.manifest
m=json.loads(path.read_text(encoding='utf-8'))
a=m['assets'][0]
stage=m['stage']
key=a['id']
folder=REPO/m['outputRoot']/key
items=[]
if stage=='structure':
    items.append(('已确认模型',REPO/a['modelPreview']))
    count=3
else:
    source_label='12步局部修正版（精修输入）' if m.get('selection',{}).get('usesDocumentedLocalCorrection') else '选中的12步原图'
    items.append((source_label,REPO/m['initImage']))
    count=2
for v in range(1,count+1):
    seed=m['structureSeedBase' if stage=='structure' else 'refineSeedBase']+v
    items.append((f'{12 if stage=="structure" else 48}步 {v:02d} · seed {seed}',
                  folder/f'{key}_{stage}_v{v:02d}_raw.png'))

cols=2 if stage=='structure' else 3
rows=2 if stage=='structure' else 1
card=620
board=Image.new('RGB',(cols*card+40,rows*690+110),'#e9ede7')
d=ImageDraw.Draw(board)
font=lambda size:ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',size)
d.text((24,16),a['label']+' · '+('12步候选' if stage=='structure' else '48步精修'),font=font(28),fill='#34443b')
for i,(label,source) in enumerate(items):
    x,y=20+(i%cols)*card,66+(i//cols)*690
    d.text((x+10,y+5),label,font=font(22),fill='#34443b')
    im=Image.open(source).convert('RGBA')
    bg=Image.new('RGBA',im.size,'#bcc1bb')
    bg.alpha_composite(im)
    thumb=bg.convert('RGB')
    thumb.thumbnail((600,600),Image.Resampling.LANCZOS)
    board.paste(thumb,(x+10,y+48))
    d.text((x+10,y+656),'完整源图；仅预览等比缩小',font=font(18),fill='#657369')
d.text((24,board.height-33),'候选查看不等于游戏运行时验收；来源与参数均保留。',font=font(19),fill='#657369')
out=path.parent/'whole_raw_comparison.png'
board.save(out)
print(out)
