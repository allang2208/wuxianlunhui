"""Present six complete raw candidates without retouching or alpha processing."""
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
BATCH = ROOT / "candidates_dev_s12"
FONT = "C:/Windows/Fonts/msyh.ttc"
ASSETS = (("oil_power_plant", "燃油发电厂"), ("cannery", "罐头加工厂"))
sections = []
for asset_id, title in ASSETS:
    board = Image.new("RGB", (1664, 798), (27, 31, 35))
    draw = ImageDraw.Draw(board)

    def label(x, y, text, size=22, color=(220, 225, 226)):
        draw.text((x, y), text, font=ImageFont.truetype(FONT, size), fill=color)

    label(32, 24, title + " · Dev 12步结构候选", 32)
    label(32, 75, "已确认v02模型｜完整Depth｜建筑v5画风｜1024×1024｜CFG 3.5｜Depth 0.78", 21, (153, 170, 176))
    cards = []
    for number in range(1, 4):
        stem = f"{asset_id}_structure_v{number:02d}"
        meta = json.loads((BATCH / asset_id / f"{stem}_generation.json").read_text(encoding="utf-8"))
        raw_path = BATCH / asset_id / f"{stem}_raw.png"
        with Image.open(raw_path) as source:
            raw = source.convert("RGB")
        x = 32 + (number - 1) * 544
        label(x, 128, f"{number:02d}号", 28)
        label(x + 160, 135, f"seed {meta['seed']}", 19, (153, 170, 176))
        board.paste(raw.resize((512, 512), Image.Resampling.LANCZOS), (x, 184))
        href = f"{asset_id}/{stem}_raw.png"
        cards.append(f'<a class="card" href="{href}" target="_blank"><strong>{title} {number:02d}</strong><span>seed {meta["seed"]} · 点击看1024原图</span><img src="{href}" alt="{title} {number:02d} 完整绿底原图"></a>')
    label(32, 720, "完整原图等比排版：未抠图、未裁主体、未改色，未用Depth遮罩隐藏结构偏移。", 21)
    label(32, 756, "仅供结构与画风选稿；尚未进入48步精修，未接入游戏。", 20, (153, 170, 176))
    target = BATCH / f"{asset_id}_contact_sheet.png"
    board.save(target)
    sections.append(f'<section><h2>{title}</h2><div class="grid">{"".join(cards)}</div></section>')
    print(target)

html = '''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>近代经济建筑 · 12步选稿</title>
<style>body{margin:0;padding:28px;background:#171c20;color:#e5e9ea;font:16px/1.6 "Microsoft YaHei",sans-serif}main{max-width:1700px;margin:auto}h1{font-size:26px}h2{font-size:22px;margin-top:32px}p,span{color:#a9b8bf}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}.card{display:block;color:inherit;text-decoration:none;background:#242d32;border:1px solid #41525b;border-radius:8px;padding:12px}.card:focus-visible{outline:3px solid #9cdce6;outline-offset:4px}.card strong,.card span{display:block}.card img{display:block;width:100%;height:auto;margin-top:12px}a{color:#b7dfe7}@media(max-width:850px){.grid{grid-template-columns:1fr}}</style>
<main><h1>近代经济建筑 · Dev 12步结构候选</h1><p>两栋各3张，使用已确认v02模型的完整Depth。以下均为完整绿底原图；点击图片打开1024原图，便于查看排放口、门洞与设备。没有抠图、改色或局部修图。</p><p>12步 · Depth 0.78 · CFG 3.5 · Euler/simple · FLUX.2 Dev · world122-building-v5。贸易公司保持不变，未进入48步精修或正式接入。</p>'''
html += "".join(sections) + '<p><a href="../candidate-manifest.json">提示词与参数清单</a> · <a href="README.md">本批说明与选稿记录</a></p></main></html>'
(BATCH / "comparison.html").write_text(html, encoding="utf-8")
print(BATCH / "comparison.html")
