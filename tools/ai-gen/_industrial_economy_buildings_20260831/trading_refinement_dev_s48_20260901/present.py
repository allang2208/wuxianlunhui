"""Preview sign-preserved candidates and untouched raws in separate labelled boards."""
from pathlib import Path
from html import escape
import json

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
FONT = "C:/Windows/Fonts/msyh.ttc"


def present(raw_only=False):
    suffix = "raw" if raw_only else "sign_preserved"
    prefix = "raw-" if raw_only else ""
    subtitle = "AI原图（字形有漂移）" if raw_only else "已恢复确认的原招牌字形"
    entries = [("已确认输入：02异形招牌", "../trading_sign_alien_20260901/trading_company_alien_sign_raw.png")]
    for variant in (1, 2):
        stem = f"trading_company/trading_company_refine_v{variant:02d}"
        rel = f"{stem}_{suffix}.png"
        meta = json.loads((HERE / f"{stem}_generation.json").read_text(encoding="utf-8"))
        entries.append((f"精修{variant:02d} · seed {meta['seed']}", rel))
    board = Image.new("RGB", (1584, 1100), (239, 242, 246))
    draw = ImageDraw.Draw(board)
    draw.text((24, 14), "贸易公司 · 48步精修候选", font=ImageFont.truetype(FONT, 30), fill=(26, 35, 48))
    draw.text((24, 59), f"Dev＋Depth 0.75 · denoise 0.30 · {subtitle} · 完整绿底候选，尚未抠图/接入",
              font=ImageFont.truetype(FONT, 20), fill=(79, 89, 103))
    cards = []
    for index, (label, rel) in enumerate(entries):
        raw = Image.open(HERE / rel).convert("RGB")
        x = 12 + index * 528
        board.paste(raw.resize((512, 512), Image.Resampling.LANCZOS), (x, 96))
        draw.text((x + 10, 622), label, font=ImageFont.truetype(FONT, 22), fill=(26, 35, 48))
        detail = raw.crop((684, 563, 820, 680)).resize((408, 351), Image.Resampling.NEAREST)
        board.paste(detail, (x + 52, 674))
        draw.text((x + 52, 1037), "招牌局部 · 3倍最近邻放大", font=ImageFont.truetype(FONT, 20), fill=(79, 89, 103))
        detail_name = f"{prefix}sign-detail-{index:02d}.png"
        detail.save(HERE / detail_name)
        cards.append(f'<a class="card" href="{rel}" target="_blank"><strong>{escape(label)}</strong><img src="{rel}" alt="{escape(label)}"><span>完整1024画布；点击放大</span><img src="{detail_name}" alt="招牌局部3倍放大"></a>')
    board.save(HERE / f"{prefix}comparison.png")
    review_path = HERE / "review.json"
    review = json.loads(review_path.read_text(encoding="utf-8")) if review_path.exists() else {}
    findings = "".join(f"<li>{escape(item)}</li>" for item in review.get("summary", []))
    disclosure = ("中、右是未经修补的完整AI精修raw，招牌字形发生漂移。" if raw_only else
                  "中、右是48步精修后，通过原牌面蒙版恢复已确认异形字的合成候选；蒙版外完全保留各自AI raw。未经修改的raw另行归档。")
    html = '''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>贸易公司 · 48步精修候选</title>
<style>body{background:#101925;color:#e1e8f0;font:16px/1.65 system-ui;margin:0}main{max-width:1560px;margin:auto;padding:32px}h1{margin-bottom:8px}p{color:#b9c7d8}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}.card{background:#1c2a3b;border-radius:12px;padding:14px;color:inherit;text-decoration:none}.card img{width:100%;display:block;margin:12px 0}.card span{color:#b9c7d8}a{color:#90c8ff}@media(max-width:850px){.grid{grid-template-columns:1fr}}</style>
<main><h1>贸易公司 · 48步精修候选</h1><p>2026-09-01 · Dev＋Depth 0.75 · 48步 · denoise0.30 · CFG3.5 · Euler/simple · world122-building-v5。</p>
<p>左侧是用户确认的02异形招牌版。''' + disclosure + ''' 每张下方单独展示招牌局部。没有裁切主体或抠透明。</p><div class="grid">''' + "".join(cards) + '''</div><ul>''' + findings + '''</ul>
<p><a href="comparison.html">保留原招牌的精修候选</a> · <a href="raw-comparison.html">未修改AI原图</a> · <a href="sign-preservation-provenance.json">牌面恢复记录</a></p>
<p><a href="README.md">说明与来源</a> · <a href="manifest.json">参数与授权</a> · <a href="review.json">逐张说明</a></p>
<p>两张48步候选待用户选定；未透明定稿、未接入游戏。未运行测试或运行时验证，按约定由用户测试。</p></main></html>'''
    (HERE / f"{prefix}comparison.html").write_text(html, encoding="utf-8")


if __name__ == "__main__":
    present()
    present(raw_only=True)
