"""Read accepted sprites and export editable hand/paw anchor references; never change sprite pixels."""
from pathlib import Path
import json
import sys
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
CONFIG = json.loads((REPO / "data/animation-config.json").read_text(encoding="utf-8"))["redWolfKing"]

# Source-cell pixels on the accepted sprites: near paw/hand, far paw/hand.
# None means the far hand is occluded; do not emit through the torso.
KEYS = {
    "pounce": [
        [373,290,409,290], [373,290,409,290], [334,285,410,292],
        [287,291,412,294], [280,289,379,281], [278,290,348,290],
        [257,291,324,291], [238,291,302,291], [334,275,307,266],
        [402,223,448,219], [488,201,535,194], [568,189,608,172],
        [627,177,663,166], [674,172,711,154], [709,166,742,155],
        [715,199,753,184], [719,287,770,252], [681,291,767,291],
        [617,292,702,294], [575,292,661,292], [534,292,619,291],
        [500,292,584,292], [474,292,556,292], [442,292,530,292], [430,292,516,292],
    ],
    "werewolfPounce": [
        [76,201,198,214], [24,155,162,177], [29,132,None,None],
        [41,129,None,None], [72,147,None,None], [329,210,242,219],
        [471,113,402,124], [487,80,441,98], [508,56,None,None],
        [516,56,None,None], [466,108,None,None], [384,233,None,None],
        [265,229,None,None], [63,196,210,213],
    ],
}
OVERRIDES = {
    "pounce": {15: [305,280,274,276], 33: [694,290,769,291]},
    "werewolfPounce": {1: [76,200,194,209], 9: [106,200,None,None],
                       11: [384,188,309,195], 21: [442,188,318,220],
                       25: [222,210,76,200], 26: [210,213,63,196]},
}


def cells(state):
    layout = CONFIG["animation"]["frameLayouts"][state]
    image = Image.open(REPO / CONFIG["sprites"][state]).convert("RGBA")
    w, h, cols = layout["frameWidth"], layout["frameHeight"], layout["cols"]
    return [image.crop((i % cols*w, i // cols*h, i % cols*w+w, i // cols*h+h))
            for i in range(layout["frames"])], w, h


def references():
    for state in ("pounce", "werewolfPounce"):
        frames, w, h = cells(state)
        indices = list(range(0,len(frames),2))
        for batch in range(0,len(indices),6):
            selected = indices[batch:batch+6]
            out = Image.new("RGB", (w*2, (h+30)*3), "#78828d")
            draw = ImageDraw.Draw(out)
            for j,index in enumerate(selected):
                ox, oy = j%2*w, j//2*(h+30)
                out.paste(frames[index], (ox,oy), frames[index])
                for x in range(0,w,50):
                    draw.line((ox+x,oy,ox+x,oy+h), fill="#8a949f")
                    draw.text((ox+x+2,oy+2),str(x),fill="white")
                for y in range(0,h,50):
                    draw.line((ox,oy+y,ox+w,oy+y),fill="#8a949f")
                    draw.text((ox+2,oy+y+12),str(y),fill="white")
                draw.text((ox+8,oy+h+7),f"{state} frame {index}",fill="white")
            out.save(ROOT / f"{state}-reference-{batch//6}.png")


def author():
    manifest = json.loads((ROOT.parent / "_red_wolf_king_motion_fix_20260830/manifest.json").read_text(encoding="utf-8"))
    anchors = {"comment": "Accepted pounce frame-local pixels: [nearX,nearY,farX,farY]; null hides an occluded hand. Sprite origin/scale/flip are applied after visual sync."}
    for state, keys in KEYS.items():
        sprites, w, h = cells(state)
        source = manifest["actions"][state]
        source_indices = source["sourceIndices"]
        frames = []
        for i in range(len(sprites)):
            if i%2 == 0:
                frames.append(keys[i//2].copy())
                continue
            a, b = source_indices[i//2:i//2+2]
            source_index = source["nativeMiddleFrames"][str(i)]
            t = (source_index-a)/(b-a)
            first, last = keys[i//2:i//2+2]
            frames.append([None if x is None or y is None else round(x+(y-x)*t) for x,y in zip(first,last)])
        for index, points in OVERRIDES.get(state, {}).items(): frames[index] = points
        anchors[state] = {"frameWidth": w, "frameHeight": h, "frames": frames}
        # Authoring reference only; sprites and runtime timing are untouched.
        for batch in range(0,len(sprites),12):
            shown = sprites[batch:batch+12]
            canvas = Image.new("RGB", (w*3, (h+24)*4), "#78828d")
            draw = ImageDraw.Draw(canvas)
            for j, sprite in enumerate(shown):
                ox, oy = j%3*w, j//3*(h+24)
                canvas.paste(sprite,(ox,oy),sprite)
                points = frames[batch+j]
                for k,color in ((0,"#ffdd33"),(2,"#39edff")):
                    if points[k] is None: continue
                    x,y = ox+points[k],oy+points[k+1]
                    draw.ellipse((x-6,y-6,x+6,y+6),outline=color,width=3)
                draw.text((ox+8,oy+h+5),str(batch+j),fill="white")
            canvas.save(ROOT / f"{state}-anchors-{batch//12}.png")
    (ROOT / "anchors.json").write_text(json.dumps(anchors,ensure_ascii=False,indent=2),encoding="utf-8")


def install():
    anchors = json.loads((ROOT / "anchors.json").read_text(encoding="utf-8"))
    for path in (REPO / "data/animation-config.json", REPO / "public/data/animation-config.json"):
        text = path.read_bytes().decode("utf-8")
        key = text.index('"redWolfKing":')
        start = text.index("{",key)
        value, length = json.JSONDecoder().raw_decode(text[start:])
        value["animation"]["pounceSmokeAnchors"] = anchors
        newline = "\r\n" if "\r\n" in text else "\n"
        rendered = json.dumps(value,ensure_ascii=False,indent=1).replace("\n",newline+" ")
        path.write_bytes((text[:start]+rendered+text[start+length:]).encode("utf-8"))


if __name__ == "__main__":
    if "--install" in sys.argv: install()
    elif "--author" in sys.argv: author()
    else: references()
