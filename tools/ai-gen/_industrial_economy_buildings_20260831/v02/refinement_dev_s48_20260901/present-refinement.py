"""Present accepted input and two standard48 raws without altering image content."""
import html
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent
REPO = OUT.parents[4]
FONT = "C:/Windows/Fonts/msyh.ttc"
manifest = json.loads((OUT / "manifest.json").read_text(encoding="utf-8"))
review_path = OUT / "review.json"
review = json.loads(review_path.read_text(encoding="utf-8")) if review_path.exists() else {}
sections = []
for asset in manifest["assets"]:
    asset_id = asset["id"]
    title = "燃油发电厂" if asset_id == "oil_power_plant" else "罐头加工厂"
    board = Image.new("RGB", (1664, 846), (27, 31, 35))
    draw = ImageDraw.Draw(board)

    def label(x, y, value, size=22, color=(220, 225, 226)):
        draw.text((x, y), value, font=ImageFont.truetype(FONT, size), fill=color)

    label(32, 24, title + " · 已确认原图 → 48步精修", 32)
    label(32, 75, "FLUX.2 Dev+Depth｜建筑v5｜48步｜denoise 0.30｜Depth 0.75｜1024×1024", 21, (153, 170, 176))
    source = REPO / asset["acceptedRefinementInput"]
    href = "../" + source.relative_to(OUT.parent).as_posix()
    items = [("已确认 · " + asset["acceptedCandidateLabel"], source, href, "本批唯一直接编辑源")]
    for number in (1, 2):
        stem = f"{asset_id}_refine_v{number:02d}"
        path = OUT / asset_id / f"{stem}_raw.png"
        meta = json.loads((OUT / asset_id / f"{stem}_generation.json").read_text(encoding="utf-8"))
        items.append((f"48步 · {number:02d}", path, f"{asset_id}/{path.name}", f"seed {meta['seed']}"))
    cards = []
    for index, (name, path, href, info) in enumerate(items):
        x = 32 + index * 544
        label(x, 126, name, 28)
        label(x, 170, info, 19, (153, 170, 176))
        with Image.open(path) as image:
            board.paste(image.convert("RGB").resize((512, 512), Image.Resampling.LANCZOS), (x, 210))
        cards.append(f'<a class="card" href="{href}" target="_blank"><strong>{title} · {name}</strong><span>{info} · 点击查看1024原图</span><img src="{href}" alt="{title} {name}"></a>')
    label(32, 751, "完整绿底原图等比排版：未抠图、未改色、未用Depth裁去结构偏差。", 21)
    label(32, 791, "48步候选待选定；模型与逻辑占格不改，未接入游戏。", 21, (153, 170, 176))
    board.save(OUT / f"{asset_id}_comparison.png")
    sections.append(f'<section><h2>{title}</h2><div class="grid">{"".join(cards)}</div></section>')

notes = "".join(f'<li>{html.escape(line)}</li>' for line in review.get("summary", []))
page = '''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>近代经济建筑 · 48步精修</title>
<style>body{margin:0;padding:28px;background:#171c20;color:#e5e9ea;font:16px/1.6 "Microsoft YaHei",sans-serif}main{max-width:1700px;margin:auto}h1{font-size:27px}h2{margin-top:32px}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}.card{display:block;color:inherit;text-decoration:none;background:#242d32;border:1px solid #41525b;border-radius:8px;padding:12px}.card strong,.card span{display:block}.card img{display:block;width:100%;height:auto;margin-top:12px}.card:focus-visible{outline:3px solid #9cdce6;outline-offset:4px}a{color:#b7dfe7}p,span{color:#b5c3c9}@media(max-width:850px){.grid{grid-template-columns:1fr}}</style>
<main><h1>近代经济建筑 · 标准48步精修</h1><p>2026-09-01用户“可用继续”确认燃油厂C、罐头厂B。以两张完整绿底raw为输入，沿用对应完整模型Depth，每栋生成两张标准48步精修。没有重建模型，没有继续12步结构试抽。</p><p>48步 · denoise0.30 · Depth0.75 · CFG3.5 · Euler/simple · Dev+Depth · world122-building-v5。保留烟囱正面爬梯的实体衬底及罐头立体门标；贸易公司不变，候选尚未正式入库。</p>'''
page += "".join(sections) + f'<h2>完整原图选稿记录</h2><ul>{notes}</ul><p><a href="manifest.json">输入与提示参数清单</a> · <a href="review.json">逐张说明</a> · <a href="README.md">本批来源与命令</a></p></main></html>'
(OUT / "comparison.html").write_text(page, encoding="utf-8")
print("Saved two complete-raw comparison boards and HTML gallery")
