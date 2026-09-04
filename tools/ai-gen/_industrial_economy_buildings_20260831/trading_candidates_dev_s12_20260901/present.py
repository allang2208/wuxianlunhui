"""Lay out full unmodified raw candidates for selection; never key or crop them."""
from pathlib import Path
from html import escape
import json

from PIL import Image, ImageDraw, ImageFont


HERE = Path(__file__).resolve().parent
FONT = "C:/Windows/Fonts/msyh.ttc"


def main():
    manifest = json.loads((HERE / "manifest.json").read_text(encoding="utf-8"))
    board = Image.new("RGB", (1584, 664), (239, 242, 246))
    draw = ImageDraw.Draw(board)
    draw.text((24, 14), "贸易公司 · 12步结构候选", font=ImageFont.truetype(FONT, 30), fill=(26, 35, 48))
    draw.text((24, 59), "首版模型与完整Depth · 三层办公楼＋单层货仓 · 完整原图，未抠透明、未接入游戏",
              font=ImageFont.truetype(FONT, 20), fill=(79, 89, 103))
    cards = []
    for variant in range(1, manifest["structureVariants"] + 1):
        rel = f"trading_company/trading_company_structure_v{variant:02d}_raw.png"
        metadata_rel = rel.replace("_raw.png", "_generation.json")
        metadata = json.loads((HERE / metadata_rel).read_text(encoding="utf-8"))
        source = Image.open(HERE / rel).convert("RGB")
        preview = source.resize((512, 512), Image.Resampling.LANCZOS)
        x = 12 + (variant - 1) * 528
        board.paste(preview, (x, 96))
        draw.text((x + 10, 620), f"{variant:02d}  /  seed {metadata['seed']}",
                  font=ImageFont.truetype(FONT, 23), fill=(26, 35, 48))
        cards.append(f'<a class="card" href="{rel}" target="_blank"><strong>候选{variant:02d} · seed {metadata["seed"]}</strong><img src="{rel}" alt="贸易公司候选{variant:02d}"><span>点击查看完整1024原图</span></a>')
    board.save(HERE / "comparison.png")
    review_path = HERE / "review.json"
    review = json.loads(review_path.read_text(encoding="utf-8")) if review_path.exists() else {}
    findings = "".join(f"<li>{escape(item)}</li>" for item in review.get("summary", []))
    html = '''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>贸易公司 · 12步结构候选</title>
<style>body{background:#101925;color:#e1e8f0;font:16px/1.65 system-ui;margin:0}main{max-width:1560px;margin:auto;padding:32px}h1{margin-bottom:8px}p{color:#b9c7d8}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}.card{background:#1c2a3b;border-radius:12px;padding:14px;color:inherit;text-decoration:none}.card img{width:100%;display:block;margin:12px 0}.card span{color:#b9c7d8}.source{display:flex;gap:20px;align-items:center;margin:28px 0}.source img{width:250px;max-width:100%}a{color:#90c8ff}@media(max-width:850px){.grid{grid-template-columns:1fr}.source{flex-wrap:wrap}}</style>
<main><h1>贸易公司 · 12步结构候选</h1><p>2026-09-01 · Dev＋Depth 0.78 · 12步 · CFG3.5 · Euler/simple · world122-building-v5。三张完整绿底raw均未抠图、改色或裁切主体。</p>
<div class="source"><a href="../trading_company/trading_company_model_approval_preview.png"><img src="../trading_company/trading_company_model_approval_preview.png" alt="首版模型"></a><p>首版参照：三层办公楼、单层货仓、双坡屋顶、两处开门、两只货箱、四柱门廊与货箱外运箭头徽记。<br>同一完整Depth，无新建模；燃油厂与罐头厂透明定稿不变。</p></div>
<div class="grid">''' + "".join(cards) + '''</div><ul>''' + findings + '''</ul>
<p><a href="README.md">说明与生成命令</a> · <a href="manifest.json">参数与授权</a> · <a href="review.json">逐张选稿说明</a></p><p>本批未获用户选定，未进行48步精修、透明定稿或游戏接入。未运行测试或运行时验证，按约定由用户测试。</p></main></html>'''
    (HERE / "comparison.html").write_text(html, encoding="utf-8")


if __name__ == "__main__":
    main()
