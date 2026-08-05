#!/usr/bin/env python3
"""智谱图像生成客户端（open.bigmodel.cn /images/generations，2026-08-03）。

密钥来源（按序）：环境变量 ZHIPU_API_KEY → 默认读取 deepseek-vision-skill 的 config.json
（该项目 GLM-4.6V 识图与智谱生图共用同一智谱账号 key）。

用法：
    python tools/ai-gen/zhipu-gen.py --prompt "..." --out out.png
    python tools/ai-gen/zhipu-gen.py --prompt-file prompt.txt --model cogview-3-flash --size 1024x1024 --out out.png
"""
import argparse
import json
import os
import sys
import time
import urllib.request

ENDPOINT = "https://open.bigmodel.cn/api/paas/v4/images/generations"
DEFAULT_KEY_PATH = r"C:\Users\allan\.codex\skills\deepseek-vision-skill\config.json"


def load_key(explicit):
    if explicit:
        with open(explicit, "r", encoding="utf-8") as fh:
            return json.load(fh)["api_key"]
    env = os.environ.get("ZHIPU_API_KEY")
    if env:
        return env
    with open(DEFAULT_KEY_PATH, "r", encoding="utf-8") as fh:
        return json.load(fh)["api_key"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--prompt", help="positive prompt")
    ap.add_argument("--prompt-file", help="read prompt from file")
    ap.add_argument("--model", default="glm-image", choices=["glm-image", "cogview-4-250304", "cogview-4", "cogview-3-flash"])
    ap.add_argument("--size", default="1280x1280", help="glm-image 推荐 1280x1280；cogview 系列 1024x1024")
    ap.add_argument("--watermark", default="false", choices=["true", "false"])
    ap.add_argument("--out", required=True, help="输出 PNG 路径")
    ap.add_argument("--key-file", default=None, help="自定义智谱 key json 路径")
    ap.add_argument("--timeout", type=int, default=180)
    args = ap.parse_args()

    if args.prompt_file:
        with open(args.prompt_file, "r", encoding="utf-8") as fh:
            prompt = fh.read().strip()
    else:
        prompt = args.prompt
    if not prompt:
        ap.error("provide --prompt or --prompt-file")

    key = load_key(args.key_file)
    payload = {
        "model": args.model,
        "prompt": prompt,
        "size": args.size,
        "watermark": args.watermark == "true",
    }
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

    if not j.get("data") or not j["data"][0].get("url"):
        print("响应无图片 URL:", json.dumps(j, ensure_ascii=False)[:500], file=sys.stderr)
        sys.exit(1)
    url = j["data"][0]["url"]
    with urllib.request.urlopen(url, timeout=120) as resp:
        img = resp.read()
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "wb") as fh:
        fh.write(img)
    print(f"{args.out} ({len(img) / 1024:.0f} KB) in {time.time() - t0:.1f}s  model={args.model} filter={j.get('content_filter')}")


if __name__ == "__main__":
    main()
