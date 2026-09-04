"""Offline source contact sheets for authoring the three sword combo grips."""
import json
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]
STAGES={'attack':'attack_sword','attack2':'attack_sword_2','attack3':'attack_sword_3'}

def clean(image):
    pixels=np.array(image.convert('RGBA'))
    rgb=pixels[:,:,:3].astype('int16')
    green=(rgb[:,:,1]>70)&(rgb[:,:,1]-rgb[:,:,0]>32)&(rgb[:,:,1]-rgb[:,:,2]>32)
    pixels[green,3]=0
    return Image.fromarray(pixels)

def main():
    cfg=json.loads((ROOT/'data/weapon-anim-config.json').read_text(encoding='utf-8'))['sword']
    original=HERE/'original-visual-frames.json'
    if not original.exists():
        original.write_text(json.dumps({k:cfg[k]['frames'] for k in STAGES},indent=2)+'\n',encoding='utf-8')
    frames=json.loads(original.read_text(encoding='utf-8'))
    for key,anim in STAGES.items():
        source=clean(Image.open(ROOT/f'assets/player/{anim}.png'))
        contact=Image.new('RGB',(1024,((len(frames[key])+3)//4)*280),'#30343b')
        detail=Image.new('RGB',(1024,((len(frames[key])+3)//4)*230),'#ddd8cf')
        for i,frame in enumerate(frames[key]):
            cell=source.crop((i%4*512,i//4*512,i%4*512+512,i//4*512+512))
            x=256+frame['offsetX']/(144*1.0956)*512
            y=256+frame['offsetY']/(144*1.0956)*512
            thumb=cell.resize((256,256))
            contact.paste(thumb,(i%4*256,i//4*280+24),thumb)
            d=ImageDraw.Draw(contact)
            d.text((i%4*256+5,i//4*280+5),f'{key} {i}: old {x:.1f},{y:.1f}',fill='white')
            xx,yy=i%4*256+x/2,i//4*280+24+y/2
            d.ellipse((xx-3,yy-3,xx+3,yy+3),outline='red',width=1)
            left,top=round(x)-55,round(y)-55
            patch=cell.crop((left,top,left+110,top+110)).resize((220,220))
            detail.paste(patch,(i%4*256,i//4*230+10),patch)
            d=ImageDraw.Draw(detail); bx,by=i%4*256,i//4*230+10
            d.text((bx+2,by-10),f'{i} crop {left},{top}',fill='black')
            for px in range((left//20+1)*20,left+110,20):
                gx=bx+(px-left)*2; d.line((gx,by,gx,by+220),fill='#b0aaa0'); d.text((gx,by+4),str(px),fill='#452222')
            for py in range((top//20+1)*20,top+110,20):
                gy=by+(py-top)*2; d.line((bx,gy,bx+220,gy),fill='#b0aaa0'); d.text((bx+1,gy),str(py),fill='#452222')
        contact.save(HERE/f'{key}-source.png')
        detail.save(HERE/f'{key}-hands-source.png')
    jobs=[('attack_sword_3',i,4) for i in (13,14,15)]+[('recover_sheet',i,5) for i in range(13)]
    board=Image.new('RGB',(1200,760),'#ddd8cf')
    for slot,(name,i,cols) in enumerate(jobs):
        sheet=clean(Image.open(ROOT/f'assets/player/{name}.png'))
        frame=sheet.crop((i%cols*512,i//cols*512,i%cols*512+512,i//cols*512+512))
        patch=frame.crop((140,160,440,330))
        xx,yy=slot%4*300,slot//4*190+20
        board.paste(patch,(xx,yy),patch)
        d=ImageDraw.Draw(board)
        d.text((xx+2,yy-18),f'{name} {i} / crop 140,160',fill='black')
        for px in range(160,440,40):
            d.line((xx+px-140,yy,xx+px-140,yy+170),fill='#bbbbbb')
            d.text((xx+px-140+1,yy),str(px),fill='black')
        for py in (200,240,280,320):
            d.line((xx,yy+py-160,xx+300,yy+py-160),fill='#bbbbbb')
            d.text((xx,yy+py-160),str(py),fill='black')
    board.save(HERE/'terminal-recover-source.png')

if __name__=='__main__': main()
