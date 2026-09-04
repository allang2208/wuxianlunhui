"""Offline fixed-crop direction evidence; no frame motion corrections or runtime changes."""
import json
import importlib.util
import sys
from pathlib import Path
import av
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[3]
FONT = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 20)
SMALL = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 16)
SOURCE_CROP = (285, 50, 760, 530)

def read_video(action):
    path = ROOT/'videos'/f'{action}-h3-v01.mp4'
    with av.open(str(path)) as container:
        stream = container.streams.video[0]
        fps = float(stream.average_rate)
        frames = [frame.to_image().convert('RGB') for frame in container.decode(stream)]
    return frames, fps

walk, rate = read_video('walking')
carry, carry_rate = read_video('carry-walking')
if len(walk) != len(carry) or rate != carry_rate:
    raise ValueError('Different source clocks; choose explicit time mapping before composing')

clean_carry = '--clean-carry-tail' in sys.argv
if clean_carry:
    spec = importlib.util.spec_from_file_location('task_tail_cleanup', ROOT/'prune-carry-tail.py')
    cleanup = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(cleanup)
    carry = [Image.fromarray(cleanup.clean_tail(np.asarray(im))[0]) for im in carry]

for action, frames in ([] if clean_carry else [('walking',walk),('carry-walking',carry)]):
    indices = [round(i*(len(frames)-1)/11) for i in range(12)]
    board = Image.new('RGB', (1280, 1125), '#eef1f5')
    d = ImageDraw.Draw(board)
    d.text((15,12), f'{action} | 12-point enlarged source poses | fixed crop', font=FONT, fill='#233343')
    for n, index in enumerate(indices):
        im=frames[index].crop(SOURCE_CROP)
        im.thumbnail((310,318),Image.Resampling.LANCZOS)
        x=(n%4)*320+(320-im.width)//2; y=50+(n//4)*355
        board.paste(im,(x,y))
        d.text(((n%4)*320+12,y+321),f'f{index} / {index/rate:.3f}s',font=SMALL,fill='#233343')
    board.save(ROOT/'previews'/f'{action}-h3-v01-detail-contact.png')

sheet=Image.open(REPO/'assets/companions/hamster_heavy_machine_gunner/running.png').convert('RGBA')
military=[]
for n in range(22):
    tile=sheet.crop(((n%8)*512,(n//8)*512,(n%8+1)*512,(n//8+1)*512)).crop((185,200,376,362))
    rgb=Image.new('RGB',tile.size,'white');rgb.paste(tile,(0,0),tile)
    military.append(rgb)

out=[]
for n in range(len(walk)):
    canvas=Image.new('RGB',(1152,452),'#eef1f5')
    d=ImageDraw.Draw(canvas)
    for col,(label,im) in enumerate([
        ('重机枪兵 · 方向参考（原跑步）',military[n%22]),
        ('矿业专家 · 新空载移动',walk[n].crop(SOURCE_CROP)),
        ('矿业专家 · 背矿（局部去尾）' if clean_carry else '矿业专家 · 新背矿移动',carry[n].crop(SOURCE_CROP)),
    ]):
        d.text((col*384+10,12),label,font=FONT,fill='#243547')
        ratio=min(360/im.width,354/im.height)
        im=im.resize((round(im.width*ratio),round(im.height*ratio)),Image.Resampling.LANCZOS)
        canvas.paste(im,(col*384+(384-im.width)//2,52+(354-im.height)//2))
    d.text((12,426),'离线固定裁框方向对照；保留源时钟和全部帧。非实机体型或播放验收。',font=SMALL,fill='#4a596b')
    out.append(canvas)
ticks=[round(n/rate*100) for n in range(len(out)+1)]
durations=[(ticks[n+1]-ticks[n])*10 for n in range(len(out))]
stem = 'direction-motion-comparison-tail-clean' if clean_carry else 'direction-motion-comparison'
out[0].save(ROOT/'previews'/f'{stem}.gif',save_all=True,append_images=out[1:],duration=durations,loop=0,disposal=2,optimize=False)
report={'frameCount':len(out),'fps':rate,'durationMs':sum(durations),'sourceCrop':list(SOURCE_CROP),
 'militarySource':'assets/companions/hamster_heavy_machine_gunner/running.png','militaryFrameCount':22,
 'militaryCrop':[185,200,376,362],'timing':'Military repeats its existing 22-frame loop at 24fps; each miner uses all its own original source frames',
 'bodyMotionEdited':False,'perFrameFit':False,'runtimeScaleEvidence':False,
 'carryTailCleanup': 'carry-tail-cleanup.json' if clean_carry else None}
(ROOT/'previews'/f'{stem}.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(report,ensure_ascii=False))
