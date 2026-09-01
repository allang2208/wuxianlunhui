"""Export native dash palm reference grids for offline authoring only."""
import json
from pathlib import Path
from PIL import Image, ImageDraw

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]
PALMS={
 'dash_attack':[[82,89],[91,68],[104,55],[129,58],[124,48],[154,48],[180,32],[174,20],[139,22],[139,29],[233,14],[395,56],[453,301],[407,456],[406,470],[406,472],[403,472]],
 'dash_recover':[[403,472],[397,457],[391,430],[380,399],[365,374],[344,351],[330,333],[310,319],[286,298],[269,284],[254,277],[245,274],[240,272],[239,270]]}

def main():
    config=json.loads((ROOT/'data/player-anim-config.json').read_text(encoding='utf-8'))
    for anim,palms in PALMS.items():
        definition=config[anim]; sheet=Image.open(ROOT/definition['src']).convert('RGBA')
        h=definition['frameHeight']; n=len(palms)
        full=Image.new('RGB',(1280,((n+4)//5)*282),'#343940')
        detail=Image.new('RGB',(1200,((n+3)//4)*280),'#c9c8c4')
        for i,(x,y) in enumerate(palms):
            frame=sheet.crop((i%8*512,i//8*h,i%8*512+512,i//8*h+h))
            thumb=frame.resize((256,258)); bx,by=i%5*256,i//5*282+22
            full.paste(thumb,(bx,by),thumb); d=ImageDraw.Draw(full)
            d.text((bx+4,by-18),f'{anim}:{i}',fill='white')
            d.ellipse((bx+x/2-3,by+y/h*258-3,bx+x/2+3,by+y/h*258+3),outline='red')
            left,top=x-60,y-60
            crop=frame.crop((left,top,left+120,top+120)).resize((240,240))
            bx,by=i%4*300,i//4*280+24; detail.paste(crop,(bx,by),crop); d=ImageDraw.Draw(detail)
            d.text((bx+3,by-18),f'{i} / {x},{y}',fill='black')
            for xx in range((left//20+1)*20,left+120,20):
                at=bx+(xx-left)*2; d.line((at,by,at,by+240),fill='#a9aaa7'); d.text((at+1,by),str(xx),fill='black')
            for yy in range((top//20+1)*20,top+120,20):
                at=by+(yy-top)*2; d.line((bx,at,bx+240,at),fill='#a9aaa7'); d.text((bx,at),str(yy),fill='black')
        full.save(HERE/f'{anim}-source.png'); detail.save(HERE/f'{anim}-palms.png')
        if anim=='dash_recover':
            rig=json.loads((HERE/'rig.json').read_text(encoding='utf-8'))
            for i in range(1,13):
                wx,wy=rig['recoverWrists'][i]; left,top=wx-35,wy-20
                frame=sheet.crop((i%8*512,i//8*h,i%8*512+512,i//8*h+h))
                patch=frame.crop((left,top,left+90,top+90)).resize((450,450),Image.Resampling.NEAREST)
                bg=Image.new('RGB',(450,480),'#dad8d1'); bg.paste(patch,(0,30),patch); draw=ImageDraw.Draw(bg)
                draw.text((4,4),f'Recover {i} wrist candidate {wx},{wy}',fill='black')
                for xx in range((left//10+1)*10,left+90,10):
                    at=(xx-left)*5; draw.line((at,30,at,480),fill='#9faaa5'); draw.text((at,32),str(xx),fill='red')
                for yy in range((top//10+1)*10,top+90,10):
                    at=30+(yy-top)*5; draw.line((0,at,450,at),fill='#9faaa5'); draw.text((0,at),str(yy),fill='red')
                bg.save(HERE/f'recover-wrist-{i}.png')

if __name__=='__main__': main()
