#!/usr/bin/env python3
"""ithinkai 中转站 gpt-image-2 生图客户端（token.ithinkai.cn /v1/images/generations，2026-08-21）。

密钥来源（按序）：--key-file 指定的 json → 环境变量 ITHINKAI_API_KEY →
默认 %USERPROFILE%\\.ithinkai\\config.json（{"api_key": "sk-..."}）。
Key 不落仓库，勿把 sk- 明文写进脚本/文档。

用法：
    python tools/ai-gen/gptimage2-gen.py --prompt "..." --out out.png
    python tools/ai-gen/gptimage2-gen.py --prompt-file prompt.txt --size 1536x1024 --quality high --out out.png
    不传 --out 时默认落 NAS 候选目录：Y:\工作\无尽轮回\scratch\gptimage2_<时间戳>.png

注意：2026-08-21 实测该站对中文 prompt 不稳定（curl 直传乱码后图不对题），
英文 prompt 遵循良好；本脚本以 UTF-8 提交，中文可用但建议英文。
返回为图片 URL（webstatic.aiproxy.vip，可能有时效），脚本立即下载落盘。
"""
import argparse
import base64
import json
import os
import sys
import time
import urllib.request

ENDPOINT = "https://token.ithinkai.cn/v1/images/generations"
DEFAULT_KEY_PATH = os.path.join(os.path.expanduser("~"), ".ithinkai", "config.json")
SCRATCH_DIR = r"Y:\工作\无尽轮回\scratch"
SIZES = ["1024x1024", "1536x1024", "1024x1536", "auto"]


def load_key(explicit):
    if explicit:
        with open(explicit, "r", encoding="utf-8") as fh:
            return json.load(fh)["api_key"]
    env = os.environ.get("ITHINKAI_API_KEY")
    if env:
        return env
    with open(DEFAULT_KEY_PATH, "r", encoding="utf-8") as fh:
        return json.load(fh)["api_key"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--prompt", help="positive prompt（建议英文）")
    ap.add_argument("--prompt-file", help="read prompt from file")
    ap.add_argument("--model", default="gpt-image-2")
    ap.add_argument("--size", default="1024x1024", choices=SIZES)
    ap.add_argument("--quality", default="auto", choices=["low", "medium", "high", "auto"])
    ap.add_argument("--background", default="auto", choices=["transparent", "opaque", "auto"],
                    help="transparent=原生透明 RGBA（gpt-image 系列支持），建筑/图标资产首选")
    ap.add_argument("--out", default=None,
                    help="输出 PNG 路径；不传默认 Y:\\工作\\无尽轮回\\scratch\\gptimage2_<时间戳>.png")
    ap.add_argument("--key-file", default=None, help="自定义 key json 路径")
    ap.add_argument("--timeout", type=int, default=300)
    args = ap.parse_args()

    if args.prompt_file:
        with open(args.prompt_file, "r", encoding="utf-8") as fh:
            prompt = fh.read().strip()
    else:
        prompt = args.prompt
    if not prompt:
        ap.error("provide --prompt or --prompt-file")

    key = load_key(args.key_file)
    payload = {"model": args.model, "prompt": prompt, "size": args.size, "n": 1}
    if args.quality != "auto":
        payload["quality"] = args.quality
    if args.background != "auto":
        payload["background"] = args.background
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        ENDPOINT,
        data=body,
        headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"},
        method="POST",
    )
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=args.timeout) as resp:
            j = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code}: {e.read().decode('utf-8', 'replace')[:500]}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"请求失败: {e}", file=sys.stderr)
        sys.exit(1)

    if not j.get("data"):
        print("响应无 data:", json.dumps(j, ensure_ascii=False)[:500], file=sys.stderr)
        sys.exit(1)
    item = j["data"][0]
    if item.get("b64_json"):
        img = base64.b64decode(item["b64_json"])
    elif item.get("url"):
        # CDN（webstatic.aiproxy.vip）拒绝 urllib 默认 UA，需伪装浏览器
        dreq = urllib.request.Request(item["url"], headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(dreq, timeout=120) as resp:
            img = resp.read()
    else:
        print("响应无图片:", json.dumps(j, ensure_ascii=False)[:500], file=sys.stderr)
        sys.exit(1)

    out_path = args.out or os.path.join(
        SCRATCH_DIR, f"gptimage2_{time.strftime('%Y%m%d_%H%M%S')}.png")
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    with open(out_path, "wb") as fh:
        fh.write(img)
    usage = j.get("usage") or {}
    print(f"{out_path} ({len(img) / 1024:.0f} KB) in {time.time() - t0:.1f}s  "
          f"model={j.get('model', args.model)} tokens={usage.get('total_tokens', '?')}")


if __name__ == "__main__":
    main()
