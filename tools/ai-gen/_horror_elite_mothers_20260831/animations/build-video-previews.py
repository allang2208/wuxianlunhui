"""Offline source GIF/contact export; no game, tests or source-video edits."""
from pathlib import Path
import argparse
import json
import math
import av
from PIL import Image,ImageDraw,ImageFont

ROOT=Path(__file__).resolve().parent
FONT=ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',18)

def read(video):
    with av.open(str(video)) as container:
        stream=container.streams.video[0]
        fps=float(stream.average_rate)
        frames=[f.to_image().convert('RGB') for f in container.decode(stream)]
    return frames,fps

def gif(frames,indices,fps,destination):
    bounds=[round(i/fps*100) for i in indices]+[round(len(frames)/fps*100)]
    durations=[max(1,bounds[i+1]-bounds[i])*10 for i in range(len(indices))]
    w,h=frames[0].size
    images=[frames[i].resize((640,round(h*640/w)),Image.Resampling.LANCZOS) for i in indices]
    images[0].save(destination,save_all=True,append_images=images[1:],duration=durations,loop=0,disposal=2,optimize=False)
    return sum(durations)

def build(video):
    frames,fps=read(video)
    output=video.parent.parent/'previews'
    output.mkdir(parents=True,exist_ok=True)
    w,h=frames[0].size
    indices=list(range(0,len(frames),max(1,round(fps/12))))
    duration=gif(frames,indices,fps,output/f'{video.stem}-source.gif')
    contacts=sorted(set(round(i*(len(frames)-1)/23) for i in range(24)))
    tw,th=320,round(h*320/w)
    board=Image.new('RGB',(tw*4,(th+22)*math.ceil(len(contacts)/4)),'#20242a')
    draw=ImageDraw.Draw(board)
    for pos,index in enumerate(contacts):
        x,y=pos%4*tw,pos//4*(th+22)
        board.paste(frames[index].resize((tw,th),Image.Resampling.LANCZOS),(x,y))
        draw.text((x+5,y+th+3),f'f{index} | {index/fps:.3f}s',fill='white')
    board.save(output/f'{video.stem}-contact.png')
    report={'video':str(video.relative_to(ROOT)),'size':[w,h],'frameCount':len(frames),'fps':fps,'durationSeconds':len(frames)/fps,'gifDurationMs':duration,'gifFrames':indices,'contactFrames':contacts,'note':'Full uncut source at original timing; preview sampled near 12 fps. Not a runtime animation or acceptance.'}
    (output/f'{video.stem}-preview.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps({k:report[k] for k in ['video','size','frameCount','fps','durationSeconds']}))

def overview(asset):
    states=[('idle','待机'),('walking','行走'),('attacking','攻击 · 单次'),('dying','死亡 · 单次')]
    index=json.loads((ROOT/'task-index.json').read_text(encoding='utf-8-sig'))
    jobs={job['state']:job for job in index['jobs'] if job['asset']==asset}
    sources=[(*read(ROOT/jobs[state]['video']),label) for state,label in states]
    total=max(len(frames)/fps for frames,fps,_ in sources)
    boards=[]
    count=math.ceil(total*12)
    for index in range(count):
        board=Image.new('RGB',(960,600),'#20242a')
        draw=ImageDraw.Draw(board)
        for pos,(frames,fps,label) in enumerate(sources):
            x,y=pos%2*480,pos//2*300
            frame=frames[min(len(frames)-1,round(index/12*fps))]
            board.paste(frame.resize((480,270),Image.Resampling.LANCZOS),(x,y+30))
            draw.text((x+12,y+2),label+' / 原片速度',font=FONT,fill='white')
        boards.append(board)
    bounds=[round(i/12*100) for i in range(count)]+[round(total*100)]
    durations=[max(1,bounds[i+1]-bounds[i])*10 for i in range(count)]
    boards[0].save(ROOT/asset/'previews/four-actions-overview.gif',save_all=True,append_images=boards[1:],duration=durations,loop=0,disposal=2,optimize=False)
    print(f'Overview exported: {asset}')

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--video',type=Path)
    parser.add_argument('--overview')
    args=parser.parse_args()
    if args.video: build(args.video.resolve())
    if args.overview: overview(args.overview)
