"""Compare original01, B/C oil and A/B cannery with unchanged raw outputs."""
import html
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent
FONT = "C:/Windows/Fonts/msyh.ttc"
ASSETS = (("oil_power_plant", "燃油发电厂"), ("cannery", "罐头加工厂"))
sections = []
for asset_id, title in ASSETS:
    board = Image.new("RGB", (1664, 848), (27, 31, 35))
    draw = ImageDraw.Draw(board)

    def label(x, y, value, size=22, color=(220, 225, 226)):
        draw.text((x, y), value, font=ImageFont.truetype(FONT, size), fill=color)

    label(32, 24, title + " · 原01 → 12步局部修正", 32)
    label(32, 75, "Dev+Depth｜1024×1024｜A/B：denoise/Depth 0.65/0.75｜油C：0.95/0.95", 21, (153, 170, 176))
    source = OUT.parent / "candidates_dev_s12" / asset_id / f"{asset_id}_structure_v01_raw.png"
    items = [("原01 · 修正基准", source, f"../candidates_dev_s12/{asset_id}/{source.name}", "保留的直接编辑源")]
    for number, suffix in ((1, "A"), (2, "B")):
        stem = f"{asset_id}_refine_v{number:02d}"
        meta = json.loads((OUT / asset_id / f"{stem}_generation.json").read_text(encoding="utf-8"))
        raw = OUT / asset_id / f"{stem}_raw.png"
        items.append((suffix + " · 12步修正", raw, f"{asset_id}/{raw.name}", f"seed {meta['seed']}"))
    extra_links = ""
    if asset_id == "oil_power_plant":
        extra_links = f'<p><a href="{items[1][2]}">油A未选修正原图</a>（爬梯仍在右边缘）</p>'
        raw = OUT / "ladder_fix/oil_power_plant/oil_power_plant_refine_v01_raw.png"
        items = [items[0], items[2], ("C · 爬梯修正·推荐", raw, "ladder_fix/oil_power_plant/" + raw.name, "seed 133161 · 仅烟囱局部")]
    else:
        name, path, href, seed = items[2]
        items[2] = (name + "·推荐", path, href, seed)
    cards = []
    for index, (name, path, href, seed) in enumerate(items):
        x = 32 + index * 544
        label(x, 128, name, 28)
        label(x, 168, seed, 19, (153, 170, 176))
        with Image.open(path) as image:
            board.paste(image.convert("RGB").resize((512, 512), Image.Resampling.LANCZOS), (x, 210))
        cards.append(f'<a class="card" href="{href}" target="_blank"><strong>{title} · {name}</strong><span>{seed} · 点击看1024原图</span><img src="{href}" alt="{title} {name}"></a>')
    label(32, 752, "完整绿底原图等比排版：未抠图、未改色、未用Alpha或Depth裁掉偏差。", 21)
    label(32, 791, "局部修正候选待选；不代表48步精修或正式接入。", 21, (153, 170, 176))
    board.save(OUT / f"{asset_id}_comparison.png")
    sections.append(f'<section><h2>{title}</h2><div class="grid">{"".join(cards)}</div>{extra_links}</section>')

    if asset_id == "oil_power_plant":
        detail = Image.new("RGB", (944, 752), (27, 31, 35))
        dd = ImageDraw.Draw(detail)
        dd.text((24, 15), "爬梯局部原像素放大 · 原01 / 修正B / 修正C", font=ImageFont.truetype(FONT, 24), fill=(220, 225, 226))
        for index, (name, path, href, seed) in enumerate(items):
            with Image.open(path) as image:
                crop = image.convert("RGB").crop((168, 237, 306, 540))
                detail.paste(crop.resize((276, 606), Image.Resampling.NEAREST), (24 + 308 * index, 100))
            dd.text((24 + 308 * index, 61), name, font=ImageFont.truetype(FONT, 23), fill=(220, 225, 226))
        detail.save(OUT / "oil_ladder_detail.png")

review_path = OUT / "review.json"
review = json.loads(review_path.read_text(encoding="utf-8")) if review_path.exists() else {}
notes = "".join(f'<li>{html.escape(item)}</li>' for item in review.get("summary", []))
page = '''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>近代经济建筑 · 01局部修正</title>
<style>body{margin:0;padding:28px;background:#171c20;color:#e5e9ea;font:16px/1.6 "Microsoft YaHei",sans-serif}main{max-width:1700px;margin:auto}h1{font-size:27px}h2{margin-top:32px}span,p{color:#b5c3c9}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}.card{display:block;color:inherit;text-decoration:none;background:#242d32;border:1px solid #41525b;border-radius:8px;padding:12px}.card:focus-visible{outline:3px solid #9cdce6;outline-offset:4px}.card strong,.card span{display:block}.card img{display:block;width:100%;height:auto;margin-top:12px}a{color:#b7dfe7}.detail{max-width:944px;width:100%}@media(max-width:850px){.grid{grid-template-columns:1fr}}</style>
<main><h1>近代经济建筑 · 原01与12步局部修正</h1><p>用户同意以两栋01继续调整，新增“楼梯尽量不要与绿幕重叠”要求。燃油厂先将真实模型爬梯转到烟囱正面，再使用新完整Depth；罐头厂保持已确认v02模型。首轮各两张，油A/B仍保留旧爬梯位置，于是从B追加一张烟囱局部修正C；本轮合计5张，推荐油C、罐头B。</p><p>Dev+Depth · world122-building-v5 · 12步 · A/B denoise/Depth 0.65/0.75，油C 0.95/0.95 · CFG3.5 · Euler/simple。标准入口的refine文件名表示img2img路径，没有执行48步。所有原图均未后处理。</p>'''
page += "".join(sections)
page += '<h2>烟囱爬梯细节</h2><a href="oil_ladder_detail.png"><img class="detail" src="oil_ladder_detail.png" alt="原01与修正B/C爬梯原像素放大"></a>'
page += f'<h2>离线选稿记录</h2><ul>{notes}</ul><p><a href="correction-manifest.json">来源、蒙版及提示词清单</a> · <a href="README.md">说明与重建命令</a> · <a href="model/oil_power_plant/oil_power_plant_model_approval_preview.png">爬梯修正模型预览</a></p></main></html>'
(OUT / "comparison.html").write_text(page, encoding="utf-8")
print("Saved two full-raw comparison boards, ladder detail and HTML gallery")
